package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func waitFor(t *testing.T, what string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestCompileQueueSetLimitGrowsAndShrinks(t *testing.T) {
	queue := newCompileQueue(1, 4)
	ctx := context.Background()
	if err := queue.acquire(ctx); err != nil {
		t.Fatal(err)
	}
	granted := make(chan int, 3)
	for i := range 3 {
		go func() {
			if err := queue.acquire(ctx); err == nil {
				granted <- i
			}
		}()
		waitFor(t, "waiter queued", func() bool { return queue.stats()["queued"] == i+1 })
	}
	queue.setLimit(3)
	// Growing to 3 admits the two oldest waiters (FIFO); they run together.
	if first, second := <-granted, <-granted; first+second != 1 {
		t.Fatalf("granted waiters %d,%d; want 0 and 1", first, second)
	}
	queue.setLimit(1)
	queue.release()
	queue.release()
	select {
	case <-granted:
		t.Fatal("waiter started while active was not below the lowered limit")
	case <-time.After(20 * time.Millisecond):
	}
	queue.release()
	if last := <-granted; last != 2 {
		t.Fatalf("last grant %d, want 2", last)
	}
	queue.release()
	if stats := queue.stats(); stats["active"] != 0 || stats["queued"] != 0 || stats["completed"] != 4 || stats["concurrency"] != 1 {
		t.Fatalf("unexpected stats %v", stats)
	}
	if wait := queue.waitTimes.snapshot(); wait["count"] != 4 {
		t.Fatalf("wait samples %v, want 4", wait["count"])
	}
}

func TestCompileQueueCancelledWaiterDoesNotLeakSlot(t *testing.T) {
	queue := newCompileQueue(1, 4)
	if err := queue.acquire(context.Background()); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for range 20 {
		ctx, cancel := context.WithCancel(context.Background())
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := queue.acquire(ctx); err == nil {
				queue.release()
			} else if !errors.Is(err, errClientCancelled) && statusOf(t, err) != http.StatusServiceUnavailable {
				t.Error(err)
			}
		}()
		go func() {
			queue.setLimit(2)
			cancel()
			queue.setLimit(1)
		}()
	}
	wg.Wait()
	queue.release()
	if stats := queue.stats(); stats["active"] != 0 || stats["queued"] != 0 {
		t.Fatalf("slot leaked: %v", stats)
	}
	if err := queue.acquire(context.Background()); err != nil {
		t.Fatalf("queue unusable after races: %v", err)
	}
}

func TestAdmissionFollowsWorkerLimit(t *testing.T) {
	queue := newCompileQueue(1, 1)
	if !queue.admit() || !queue.admit() {
		t.Fatal("limit+maxQueue requests must be admitted")
	}
	if queue.admit() {
		t.Fatal("third request admitted above limit+maxQueue")
	}
	queue.setLimit(2)
	if !queue.admit() {
		t.Fatal("raised limit must admit one more request")
	}
	for range 3 {
		queue.leave()
	}
	stats := queue.stats()
	if stats["admitted"] != 0 || stats["rejectedAdmission"] != 1 || stats["rejected"] != 1 {
		t.Fatalf("unexpected stats %v", stats)
	}
}

func TestWorkerControllerHysteresis(t *testing.T) {
	const mib = uint64(1 << 20)
	c := &workerController{cpus: 16, initial: 8, adaptive: true}
	limit := 8
	step := func(active int, available uint64) {
		t.Helper()
		limit, _ = c.observe(limit, active, available)
	}
	step(0, 900*mib)
	if limit != 8 {
		t.Fatalf("one low sample shrank to %d", limit)
	}
	step(0, 900*mib)
	if limit != 1 {
		t.Fatalf("two low samples gave %d, want 1", limit)
	}
	// Memory held by our own active worker counts as available.
	step(1, 800*mib)
	step(1, 800*mib)
	if limit != 1 {
		t.Fatalf("growth must wait for 3 samples; limit %d", limit)
	}
	step(1, 800*mib)
	if limit != 2 {
		t.Fatalf("third sample should grow to 2; limit %d", limit)
	}
	for range 3 {
		step(0, 8000*mib)
	}
	if limit != 3 {
		t.Fatalf("growth must move one worker at a time; limit %d", limit)
	}
	// A flapping signal never changes the limit.
	for range 6 {
		step(0, 900*mib)
		step(0, 8000*mib)
	}
	if limit != 3 {
		t.Fatalf("flapping memory changed limit to %d", limit)
	}
	if next, changed := c.observe(3, 0, 0); changed || next != 3 {
		t.Fatal("unknown memory must not change the limit")
	}
	fixed := &workerController{cpus: 16, initial: 4}
	for range 5 {
		if _, changed := fixed.observe(4, 0, 100*mib); changed {
			t.Fatal("fixed worker count must not adapt")
		}
	}
}

func TestWorkerOverrideDisablesAdaptation(t *testing.T) {
	t.Setenv("VIETLATEX_COMPILE_WORKERS", "3")
	if c := newWorkerController(); c.adaptive || c.initial != 3 {
		t.Fatalf("override: adaptive=%v initial=%d", c.adaptive, c.initial)
	}
	t.Setenv("VIETLATEX_COMPILE_WORKERS", "")
	t.Setenv("VIETLATEX_ADAPTIVE_WORKERS", "0")
	if c := newWorkerController(); c.adaptive {
		t.Fatal("VIETLATEX_ADAPTIVE_WORKERS=0 must disable adaptation")
	}
}

func TestCurrentWarmConfig(t *testing.T) {
	cases := map[string]warmConfig{
		"":      {mode: "auto", size: 2},
		"auto":  {mode: "auto", size: 2},
		"2":     {mode: "auto", size: 2},
		"1":     {mode: "auto", size: 1},
		"0":     {mode: "off"},
		"OFF":   {mode: "off"},
		"eager": {mode: "eager", size: 2},
	}
	for value, want := range cases {
		t.Setenv("VIETLATEX_WARM_TEX", value)
		if got := currentWarmConfig(); got != want {
			t.Errorf("VIETLATEX_WARM_TEX=%q gave %+v, want %+v", value, got, want)
		}
	}
	t.Setenv("VIETLATEX_WARM_TEX", "eager")
	t.Setenv("VIETLATEX_SANDBOX", "docker")
	if got := currentWarmConfig(); got.mode != "off" {
		t.Fatalf("docker sandbox must disable warm processes, got %+v", got)
	}
}

func fakeWarmPool(config warmConfig) (*warmPool, func() int) {
	pool := newWarmPool(config)
	var mu sync.Mutex
	alive := 0
	pool.spawn = func() (*warmTeX, string) {
		exited := make(chan struct{})
		var once sync.Once
		mu.Lock()
		alive++
		mu.Unlock()
		return &warmTeX{started: time.Now(), exited: exited, kill: func() {
			once.Do(func() {
				mu.Lock()
				alive--
				mu.Unlock()
				close(exited)
			})
		}}, ""
	}
	return pool, func() int { mu.Lock(); defer mu.Unlock(); return alive }
}

func settledIdle(t *testing.T, pool *warmPool, want int) {
	t.Helper()
	waitFor(t, "warm pool to settle", func() bool {
		stats := pool.stats()
		return stats.spawning == 0 && stats.idle == want
	})
}

func TestWarmPoolAutoModeStartsOnDemandAndReleasesWhenIdle(t *testing.T) {
	pool, alive := fakeWarmPool(warmConfig{mode: "auto", size: 2})
	pool.setWorkerLimit(4)
	pool.startup()
	pool.maintain(time.Now(), 8<<30)
	if stats := pool.stats(); stats.spawning != 0 || stats.idle != 0 || alive() != 0 {
		t.Fatalf("auto mode spawned before the first compile: %+v", stats)
	}
	if pool.take() != nil {
		t.Fatal("first take must miss")
	}
	settledIdle(t, pool, 2)
	if warm := pool.take(); warm == nil {
		t.Fatal("second take must hit")
	} else {
		warm.discard()
	}
	settledIdle(t, pool, 2)
	pool.maintain(time.Now().Add(warmReleaseAfter+time.Second), 8<<30)
	settledIdle(t, pool, 0)
	if stats := pool.stats(); stats.active || stats.released != 1 || alive() != 0 {
		t.Fatalf("idle pool not released: %+v alive=%d", stats, alive())
	}
}

func TestWarmPoolFollowsWorkerLimitAndMemory(t *testing.T) {
	pool, alive := fakeWarmPool(warmConfig{mode: "eager", size: 2})
	pool.setWorkerLimit(4)
	pool.startup()
	settledIdle(t, pool, 2)
	pool.setWorkerLimit(1)
	settledIdle(t, pool, 1)
	pool.maintain(time.Now(), 512<<20)
	settledIdle(t, pool, 0)
	if alive() != 0 {
		t.Fatalf("low memory left %d warm processes alive", alive())
	}
	pool.maintain(time.Now(), 8<<30)
	settledIdle(t, pool, 1)
	pool.close()
	if alive() != 0 {
		t.Fatalf("close left %d warm processes alive", alive())
	}
}

func TestHealthReportsOperationalMetrics(t *testing.T) {
	service := New("0123456789abcdef0123456789abcdef")
	recorder := httptest.NewRecorder()
	service.health(recorder, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	var body struct {
		Compiler map[string]any `json:"compiler"`
		Word     map[string]any `json:"word"`
		System   map[string]any `json:"system"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"concurrency", "maxQueue", "rejectedAdmission", "rejectedQueue", "waitMs", "compileMs", "workers", "warm", "warmIdle"} {
		if _, ok := body.Compiler[key]; !ok {
			t.Errorf("compiler stats missing %q", key)
		}
	}
	for _, key := range []string{"active", "queued", "waitMs", "runMs", "rejectedAdmission"} {
		if _, ok := body.Word[key]; !ok {
			t.Errorf("word stats missing %q", key)
		}
	}
	for _, key := range []string{"availableMemoryBytes", "cpus", "uptimeSec", "backendHeapBytes", "requestBodyBytesInFlight", "requestBodyBudgetBytes"} {
		if _, ok := body.System[key]; !ok {
			t.Errorf("system stats missing %q", key)
		}
	}
}

func TestCompileRecordsDuration(t *testing.T) {
	s, _, started, release := blockingLatexService(t)
	done := make(chan error, 1)
	go func() {
		_, err := s.compile(context.Background(), compileRequest{Latex: "timed"})
		done <- err
	}()
	<-started
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if count := s.compileTimes.snapshot()["count"]; count != 1 {
		t.Fatalf("compile samples %v, want 1", count)
	}
}
