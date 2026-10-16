// Checks the unpacked Windows app before an installer is published.
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { extractFile } = require('@electron/asar')
const pkg = require('../package.json'), config = require('./electron-builder.config.cjs')
const app = join(config.directories.output, 'win-unpacked')
const asar = join(app, 'resources', 'app.asar')
for (const file of [`${pkg.build.productName}.exe`, 'resources/backend/vietlatex-backend.exe', 'resources/pandoc/pandoc.exe', 'resources/app.asar']) await access(join(app, file))
const packaged = JSON.parse(extractFile(asar, 'package.json').toString('utf8'))
for (const file of ['electron/spellcheck-store.cjs', 'electron/gemini.cjs', 'src/services/SpellcheckSettings.js', 'dist/spellcheck/en-US.aff', 'dist/spellcheck/en-US.dic', 'dist/spellcheck/en-GB.aff', 'dist/spellcheck/en-GB.dic', 'dist/spellcheck/en-US.LICENSE.txt', 'dist/spellcheck/en-GB.LICENSE.txt', 'dist/spellcheck/nspell.LICENSE.txt', 'dist/spellcheck/manifest.json']) assert.ok(extractFile(asar, join(...file.split('/'))).length > 0, `${file} missing from app.asar`)
assert.equal(packaged.version, pkg.version, 'packaged app version must match package.json')
for (const file of ['electron/main.cjs', 'electron/updater.cjs', 'electron/win/environment.cjs', 'electron/win/firewall.cjs', 'electron/lan-discovery.cjs', 'dist/index.html']) assert.ok(extractFile(asar, join(...file.split('/'))), `${file} missing from app.asar`)
const backend = await readFile(join(app, 'resources', 'backend', 'vietlatex-backend.exe'))
assert.equal(backend.subarray(0, 2).toString('latin1'), 'MZ', 'backend must be a Windows executable')
console.log(`Windows package verified: ${app}`)
