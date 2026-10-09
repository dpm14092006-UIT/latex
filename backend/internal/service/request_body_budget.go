package service

import (
	"sync"
)

// requestBodyBudget limits the combined serialized bodies retained by heavy
// request handlers. The reservation covers body parsing and downstream work
// because decoded request values can continue to reference that data.
type requestBodyBudget struct {
	mu    sync.Mutex
	limit int64
	used  int64
}

func newRequestBodyBudget(limit int64) *requestBodyBudget {
	return &requestBodyBudget{limit: max(int64(0), limit)}
}

func (b *requestBodyBudget) reserve(amount int64) (func(), bool) {
	if amount < 0 {
		return nil, false
	}
	b.mu.Lock()
	if amount > b.limit-b.used {
		b.mu.Unlock()
		return nil, false
	}
	b.used += amount
	b.mu.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			b.mu.Lock()
			b.used -= amount
			b.mu.Unlock()
		})
	}, true
}

func (b *requestBodyBudget) stats() (used, limit int64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.used, b.limit
}
