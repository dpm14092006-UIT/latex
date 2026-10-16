import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

export function prepareSpellcheckAssets(root = process.cwd()) {
  const target = resolve(root, 'public/spellcheck')
  mkdirSync(target, { recursive: true })
  const manifest = { dictionaries: [] }
  for (const [locale, name] of [['en-US', 'dictionary-en'], ['en-GB', 'dictionary-en-gb']]) {
    const source = resolve(root, 'node_modules', name)
    const { version } = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8'))
    const files = {}
    for (const extension of ['aff', 'dic']) {
      const bytes = readFileSync(resolve(source, `index.${extension}`))
      writeFileSync(resolve(target, `${locale}.${extension}`), bytes)
      files[extension] = createHash('sha256').update(bytes).digest('hex')
    }
    copyFileSync(resolve(source, 'license'), resolve(target, `${locale}.LICENSE.txt`))
    manifest.dictionaries.push({ locale, package: name, version, sha256: files })
  }
  copyFileSync(resolve(root, 'node_modules/nspell/license'), resolve(target, 'nspell.LICENSE.txt'))
  writeFileSync(resolve(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}
