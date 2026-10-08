import { useEffect } from 'react'
import { ZOOM_LEVELS } from '../components/ZoomControls.jsx'

const DELTA_PER_STEP = 40
const RESET_AFTER_MS = 160

// Chromium reports a two-finger pinch as a ctrl/meta + wheel event. Keep regular
// two-finger scrolling untouched and consume only those pinch gestures.
export function useTrackpadZoom(stageRef, setZoom) {
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined

    let accumulatedDelta = 0
    let resetTimer

    const handleWheel = event => {
      if (!event.ctrlKey && !event.metaKey) {
        accumulatedDelta = 0
        return
      }

      event.preventDefault()
      const deltaMultiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 40
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? stage.clientHeight
          : 1
      accumulatedDelta += event.deltaY * deltaMultiplier

      const steps = Math.trunc(accumulatedDelta / DELTA_PER_STEP)
      if (steps) {
        accumulatedDelta -= steps * DELTA_PER_STEP
        setZoom(value => {
          const currentIndex = ZOOM_LEVELS.reduce((closest, level, index) => (
            Math.abs(level - value) < Math.abs(ZOOM_LEVELS[closest] - value) ? index : closest
          ), 0)
          const nextIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, currentIndex - steps))
          return ZOOM_LEVELS[nextIndex]
        })
      }

      window.clearTimeout(resetTimer)
      resetTimer = window.setTimeout(() => { accumulatedDelta = 0 }, RESET_AFTER_MS)
    }

    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      stage.removeEventListener('wheel', handleWheel)
      window.clearTimeout(resetTimer)
    }
  }, [stageRef, setZoom])
}
