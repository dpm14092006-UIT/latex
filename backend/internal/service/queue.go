package service

import (
	"context"
	"net/http"
	"slices"
	"sync"
	"time"
)

// compileQueue is a FIFO semaphore whose worker limit can change while
// requests are running. Lowering the limit never interrupts active work; it
// only stops new work from starting until active drops below the new limit.
type compileQueue struct {
	mu                sync.Mutex
	limit             int
	maxQueue          int
	active            int
	closed            bool
	waiters           []*queueWaiter
	admitted          int
	completed         int
	rejectedQueue     int
	rejectedAdmission int
	waitTimes         *durationStats
}

type queueWaiter struct {
	ready   chan struct{}
	granted bool
}

func newCompileQueue(concurrency, maxQueue int) *compileQueue {
	return &compileQueue{limit: max(1, concurrency), maxQueue: maxQueue, waitTimes: newDurationStats()}
}

func (q *compileQueue) acquire(ctx context.Context) error {
	if ctx.Err() != nil {
		return errClientCancelled
	}
	start := time.Now()
	q.mu.Lock()
	if q.closed {
		q.mu.Unlock()
		return backendStoppingError()
	}
	if q.active < q.limit && len(q.waiters) == 0 {
		q.active++
		q.mu.Unlock()
		q.waitTimes.add(0)
		return nil
	}
	if len(q.waiters) >= q.maxQueue {
		q.rejectedQueue++
		q.mu.Unlock()
		return appError(http.StatusServiceUnavailable, "Máy biên dịch đang bận. Vui lòng thử lại sau vài giây.")
	}
	waiter := &queueWaiter{ready: make(chan struct{})}
	q.waiters = append(q.waiters, waiter)
	q.mu.Unlock()

	select {
	case <-waiter.ready:
		if !waiter.granted {
			return backendStoppingError()
		}
		if ctx.Err() != nil {
			q.giveBack()
			return errClientCancelled
		}
		q.waitTimes.add(time.Since(start))
		return nil
	case <-ctx.Done():
		q.mu.Lock()
		if waiter.granted {
			q.active--
			q.dispatchLocked()
		} else if index := slices.Index(q.waiters, waiter); index >= 0 {
			q.waiters = slices.Delete(q.waiters, index, index+1)
		}
		q.mu.Unlock()
		return errClientCancelled
	}
}

// giveBack returns a slot that was granted but never used.
func (q *compileQueue) giveBack() {
	q.mu.Lock()
	q.active--
	q.dispatchLocked()
	q.mu.Unlock()
}

func (q *compileQueue) release() {
	q.mu.Lock()
	q.active--
	q.completed++
	q.dispatchLocked()
	q.mu.Unlock()
}

func (q *compileQueue) dispatchLocked() {
	if q.closed {
		return
	}
	for q.active < q.limit && len(q.waiters) > 0 {
		waiter := q.waiters[0]
		q.waiters = q.waiters[1:]
		waiter.granted = true
		q.active++
		close(waiter.ready)
	}
}

func (q *compileQueue) setLimit(limit int) {
	q.mu.Lock()
	q.limit = max(1, limit)
	q.dispatchLocked()
	q.mu.Unlock()
}

func (q *compileQueue) currentLimit() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.limit
}

// admit bounds how many heavy HTTP requests may be in flight (reading their
// body, waiting, or running) before the body is read. The bound follows the
// current worker limit.
func (q *compileQueue) admit() bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed || q.admitted >= q.limit+q.maxQueue {
		q.rejectedAdmission++
		return false
	}
	q.admitted++
	return true
}

// close refuses new work and wakes queued requests without interrupting
// active owners. Their contexts are cancelled by the owning service.
func (q *compileQueue) close() {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return
	}
	q.closed = true
	for _, waiter := range q.waiters {
		close(waiter.ready)
	}
	q.waiters = nil
}

func backendStoppingError() error {
	return appError(http.StatusServiceUnavailable, "Backend đang dừng. Vui lòng mở lại ứng dụng rồi thử lại.")
}

func (q *compileQueue) leave() {
	q.mu.Lock()
	q.admitted--
	q.mu.Unlock()
}

func (q *compileQueue) stats() map[string]int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return map[string]int{
		"active":            q.active,
		"queued":            len(q.waiters),
		"concurrency":       q.limit,
		"maxQueue":          q.maxQueue,
		"admitted":          q.admitted,
		"completed":         q.completed,
		"rejected":          q.rejectedQueue + q.rejectedAdmission,
		"rejectedQueue":     q.rejectedQueue,
		"rejectedAdmission": q.rejectedAdmission,
	}
}

// durationStats keeps the most recent samples so percentiles describe the
// current workload rather than the whole session.
const durationWindow = 256

type durationStats struct {
	mu      sync.Mutex
	samples []time.Duration
	next    int
	count   int
	last    time.Duration
}

func newDurationStats() *durationStats {
	return &durationStats{samples: make([]time.Duration, 0, durationWindow)}
}

func (d *durationStats) add(value time.Duration) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.samples) < durationWindow {
		d.samples = append(d.samples, value)
	} else {
		d.samples[d.next] = value
	}
	d.next = (d.next + 1) % durationWindow
	d.count++
	d.last = value
}

// since records the time elapsed from start; use as defer d.since(time.Now()).
func (d *durationStats) since(start time.Time) { d.add(time.Since(start)) }

func (d *durationStats) snapshot() map[string]any {
	d.mu.Lock()
	sorted := slices.Clone(d.samples)
	count, last := d.count, d.last
	d.mu.Unlock()
	result := map[string]any{"count": count, "lastMs": milliseconds(last), "avgMs": 0.0, "p50Ms": 0.0, "p95Ms": 0.0, "maxMs": 0.0}
	if len(sorted) == 0 {
		return result
	}
	slices.Sort(sorted)
	var total time.Duration
	for _, value := range sorted {
		total += value
	}
	result["avgMs"] = milliseconds(total / time.Duration(len(sorted)))
	result["p50Ms"] = milliseconds(sorted[(len(sorted)-1)*50/100])
	result["p95Ms"] = milliseconds(sorted[(len(sorted)-1)*95/100])
	result["maxMs"] = milliseconds(sorted[len(sorted)-1])
	return result
}

func milliseconds(value time.Duration) float64 {
	return float64(value.Microseconds()) / 1000
}
