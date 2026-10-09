import { useCallback, useEffect, useState } from 'react'

// Mirrors the main-process updater state; null in the browser build.
export default function useAppUpdates() {
  const api = typeof window !== 'undefined' ? window.desktopAPI?.updates : undefined
  const [status, setStatus] = useState(null)
  useEffect(() => {
    if (!api) return undefined
    let active = true
    const unsubscribe = api.onStatus(next => { if (active) setStatus(next) })
    void api.status().then(next => { if (active) setStatus(current => current ?? next) }).catch(() => {})
    return () => { active = false; unsubscribe() }
  }, [api])
  const call = useCallback(async (action, ...args) => {
    if (!api?.[action]) return null
    const next = await api[action](...args)
    if (next && typeof next === 'object' && 'status' in next) setStatus(next)
    return next
  }, [api])
  return { supported: Boolean(api), status, call }
}
