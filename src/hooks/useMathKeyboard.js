import { useLayoutEffect, useState } from 'react'

const hidden = { visible: false, height: 0 }

export function useMathKeyboard(ready, active) {
  const [geometry, setGeometry] = useState(hidden)

  useLayoutEffect(() => {
    if (!ready) return
    const keyboard = window.mathVirtualKeyboard
    if (!keyboard) return

    const update = () => {
      const next = keyboard.visible
        ? { visible: true, height: Math.ceil(keyboard.boundingRect.height) }
        : hidden
      setGeometry(previous => previous.visible === next.visible && previous.height === next.height ? previous : next)
    }
    const beforeToggle = event => {
      // The field uses manual policy: MathLive does not hide on blur. Do not
      // let a late keyboard message reopen it after the dialog/mode changes.
      if (event.detail?.visible && !active) event.preventDefault()
    }
    const escape = event => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || !keyboard.visible) return
      event.preventDefault()
      event.stopImmediatePropagation()
      keyboard.hide()
    }
    keyboard.addEventListener('before-virtual-keyboard-toggle', beforeToggle)
    keyboard.addEventListener('virtual-keyboard-toggle', update)
    keyboard.addEventListener('geometrychange', update)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('resize', update)
    if (!active) keyboard.hide()
    update()
    return () => {
      keyboard.removeEventListener('before-virtual-keyboard-toggle', beforeToggle)
      keyboard.removeEventListener('virtual-keyboard-toggle', update)
      keyboard.removeEventListener('geometrychange', update)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', update)
      keyboard.hide()
    }
  }, [ready, active])

  return geometry
}
