import assert from 'node:assert/strict'
import test from 'node:test'
import { formatShortcut, KEYBOARD_SHORTCUTS, matchesShortcut } from '../src/services/KeyboardShortcuts.js'

test('primary modifier and labels follow Windows and macOS', () => {
  assert.equal(matchesShortcut({ key: 's', ctrlKey: true }, 'save', 'win32'), true)
  assert.equal(matchesShortcut({ key: 's', metaKey: true }, 'save', 'darwin'), true)
  assert.equal(matchesShortcut({ key: 's', ctrlKey: true }, 'save', 'darwin'), false)
  assert.equal(matchesShortcut({ key: 's', metaKey: true }, 'save', 'win32'), false)
  assert.equal(formatShortcut('Ctrl+B / Ctrl+Shift+K', 'darwin'), '⌘+B / ⌘+Shift+K')
  assert.equal(formatShortcut('Ctrl+B', 'win32'), 'Ctrl+B')
})

test('save, strike and shifted link commands do not collide', () => {
  assert.equal(matchesShortcut({ key: 'S', ctrlKey: true, shiftKey: true }, 'save', 'win32'), false)
  assert.equal(matchesShortcut({ key: 'S', ctrlKey: true, shiftKey: true }, 'strike', 'win32'), true)
  assert.equal(matchesShortcut({ key: 'K', ctrlKey: true, shiftKey: true }, 'commands', 'win32'), false)
  assert.equal(matchesShortcut({ key: 'K', ctrlKey: true, shiftKey: true }, 'link', 'win32'), true)
  assert.equal(matchesShortcut({ key: 'k', ctrlKey: true, altKey: true }, 'commands', 'win32'), false)
})

test('IME, AltGr and composition key codes never trigger application actions', () => {
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { getModifierState: key => key === 'AltGraph' }]) {
    assert.equal(matchesShortcut({ key: 's', ctrlKey: true, ...extra }, 'save', 'win32'), false)
    assert.equal(matchesShortcut({ key: 'F1', ...extra }, 'help', 'win32'), false)
  }
})

test('help needs no modifier and rejects modified F1', () => {
  assert.equal(matchesShortcut({ key: 'F1' }, 'help', 'win32'), true)
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) assert.equal(matchesShortcut({ key: 'F1', [modifier]: true }, 'help', 'win32'), false)
  assert.equal(matchesShortcut({ key: 'F1' }, 'unknown', 'win32'), false)
})

test('macOS replace avoids the native hide-application shortcut', () => {
  assert.equal(matchesShortcut({ key: 'h', metaKey: true }, 'replace', 'darwin'), false)
  assert.equal(matchesShortcut({ key: 'f', metaKey: true, altKey: true }, 'replace', 'darwin'), true)
  assert.equal(matchesShortcut({ key: 'h', ctrlKey: true }, 'replace', 'win32'), true)
})

test('catalogue has no duplicate ids or ambiguous key bindings', () => {
  assert.equal(new Set(KEYBOARD_SHORTCUTS.map(item => item.id)).size, KEYBOARD_SHORTCUTS.length)
  const keys = KEYBOARD_SHORTCUTS.flatMap(item => item.keys)
  assert.equal(new Set(keys).size, keys.length)
})
