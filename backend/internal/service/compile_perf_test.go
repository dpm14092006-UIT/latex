package service

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// Repeated previews commonly resend the same assets after a cached compile.
func BenchmarkCompileCachedAssets(b *testing.B) {
	for _, size := range []int{0, 4 << 20, 20 << 20} {
		b.Run(map[int]string{0: "text", 4 << 20: "4MiB", 20 << 20: "20MiB"}[size], func(b *testing.B) {
			s := newLatexService()
			defer s.cancelAll()
			s.compileFn = func(context.Context, string, []fileAsset) ([]byte, error) { return []byte("%PDF-test"), nil }
			input := compileRequest{Latex: strings.Repeat("preview ", 1000)}
			for remaining := size; remaining > 0; {
				n := min(remaining, maxOneAssetBytes)
				input.Assets = append(input.Assets, encoded(string(rune('a'+len(input.Assets)))+".txt", []byte(strings.Repeat("x", n))))
				remaining -= n
			}
			if _, err := s.compile(context.Background(), input); err != nil {
				b.Fatal(err)
			}
			b.ReportAllocs()
			b.SetBytes(int64(size))
			b.ResetTimer()
			for b.Loop() {
				if _, err := s.compile(context.Background(), input); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func TestCompileEncodedCachePreservesValidationAndFresh(t *testing.T) {
	s := newLatexService()
	defer s.cancelAll()
	runs := 0
	s.compileFn = func(_ context.Context, _ string, files []fileAsset) ([]byte, error) {
		runs++
		if len(files) != 1 || string(files[0].data) != "x" {
			t.Errorf("compiler received wrong assets: %v", files)
		}
		return []byte("%PDF-test"), nil
	}
	input := compileRequest{Latex: "cached assets", Assets: []encodedAsset{encoded("data.txt", []byte("x"))}}
	for range 2 {
		if _, err := s.compile(context.Background(), input); err != nil {
			t.Fatal(err)
		}
	}
	if runs != 1 {
		t.Fatalf("repeated preview compiled %d times", runs)
	}
	// Noncanonical pad bits decode to the same byte with a lenient decoder,
	// but must still fail strict validation instead of reaching the cache.
	input.Assets[0].Data = "eB=="
	if _, err := s.compile(context.Background(), input); err == nil {
		t.Fatal("cache accepted noncanonical base64")
	}
	input.Assets[0] = encoded("data.txt", []byte("x"))
	input.Fresh = true
	if _, err := s.compile(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	if runs != 2 {
		t.Fatalf("fresh preview reused cache: %d runs", runs)
	}
}

func TestCompileHashFramesEveryEncodedField(t *testing.T) {
	requests := []compileRequest{
		{Latex: "a", Images: []encodedAsset{{Filename: "b", Data: "c"}}},
		{Latex: "ab", Images: []encodedAsset{{Filename: "", Data: "c"}}},
		{Latex: "a", Images: []encodedAsset{{Filename: "bc", Data: ""}}},
		{Latex: "a", Assets: []encodedAsset{{Filename: "b", Data: "c"}}},
		{Latex: "a", Assets: []encodedAsset{{Filename: "b", Data: "c"}, {Filename: "d", Data: "e"}}},
		{Latex: "a", Assets: []encodedAsset{{Filename: "d", Data: "e"}, {Filename: "b", Data: "c"}}},
	}
	seen := map[string]bool{}
	for _, input := range requests {
		key := compileHash(input.Latex, input.Images, input.Assets)
		if seen[key] {
			t.Fatalf("field-boundary collision: %+v", input)
		}
		seen[key] = true
	}
}

func TestCompileDiscardedFlightCannotPopulateCache(t *testing.T) {
	s := newLatexService()
	defer s.cancelAll()
	started := make(chan struct{})
	s.compileFn = func(ctx context.Context, _ string, _ []fileAsset) ([]byte, error) {
		close(started)
		<-ctx.Done()
		// The external process can finish successfully while cancellation is
		// delivered during the final PDF read/cleanup.
		return []byte("%PDF-abandoned"), nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := s.compile(ctx, compileRequest{Latex: "abandoned"}); done <- err }()
	<-started
	cancel()
	if err := <-done; !errors.Is(err, errClientCancelled) {
		t.Fatalf("abandoned request returned %v", err)
	}
	s.flightWG.Wait()
	if _, entries, _ := s.cache.stats(); entries != 0 {
		t.Fatalf("abandoned compile populated %d cache entries", entries)
	}
}
