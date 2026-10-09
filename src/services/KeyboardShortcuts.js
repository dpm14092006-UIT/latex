// The native bridge is authoritative; browser previews use the browser platform.
export function formatShortcut(text, platform = globalThis.window?.desktopAPI?.platform
  || globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '') {
  return /darwin|mac/i.test(platform) ? text.replace(/\bCtrl\b/g, '⌘') : text
}
