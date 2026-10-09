const { readdir, open } = require('node:fs/promises')
const { join, extname } = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const exec = promisify(execFile)

// The default signer opens every binary resource concurrently. A bundled TeX
// tree exceeds macOS's per-process file limit; inspect and sign code sequentially.
module.exports = async function signMac(options) {
  if (options.platform !== 'darwin') throw new Error('Signer này dành cho app macOS ngoài App Store.')
  if (!options.identity) throw new Error('Thiếu danh tính ký macOS.')
  const code = []
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await collect(path)
        if (['.app', '.framework'].includes(extname(path))) code.push(path)
      } else if (entry.isFile()) {
        const file = await open(path, 'r')
        const header = Buffer.alloc(4)
        try { await file.read(header, 0, 4, 0) } finally { await file.close() }
        if ([0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcafebabf].includes(header.readUInt32BE()) || [0xfeedface, 0xfeedfacf].includes(header.readUInt32LE())) code.push(path)
      }
    }
  }
  await collect(join(options.app, 'Contents'))
  code.sort((a, b) => b.split('/').length - a.split('/').length)
  for (const path of [...new Set(code), options.app]) {
    const settings = await options.optionsForFile(path)
    const args = ['--force', '--sign', options.identity]
    if (options.keychain) args.push('--keychain', options.keychain)
    if (settings.hardenedRuntime !== false) args.push('--options', 'runtime')
    if (settings.entitlements) args.push('--entitlements', settings.entitlements)
    if (options.identity === '-') args.push('--timestamp=none')
    else args.push(settings.timestamp ? `--timestamp=${settings.timestamp}` : '--timestamp')
    args.push(...(settings.additionalArguments || []), path)
    await exec('/usr/bin/codesign', args, { maxBuffer: 1024 * 1024 })
  }
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', options.app])
  console.log(`Signed ${code.length} native binaries/bundles and sealed the complete app resources.`)
}
