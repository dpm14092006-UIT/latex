import { spawn } from 'node:child_process'
import { access, chmod, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const moduleDir = join(root, 'backend')
const outputDir = join(root, 'build', 'backend')
const windowsX64 = process.argv.includes('--windows-x64')
const universalMac = process.argv.includes('--universal')
const go = await findGo()

function run(executable, args, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { cwd: moduleDir, env, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${executable} exited with ${code ?? signal}`))
    })
  })
}

function goEnvironment(goos, goarch) {
  return { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' }
}

async function findGo() {
  if (process.env.GO_BINARY) return process.env.GO_BINARY
  if (process.platform === 'win32') {
    const candidates = [join(process.env.ProgramFiles || 'C:\\Program Files', 'Go', 'bin', 'go.exe')]
    if (process.env.LOCALAPPDATA) {
      const programs = join(process.env.LOCALAPPDATA, 'Programs')
      try {
        for (const entry of await readdir(programs, { withFileTypes: true })) {
          if (/^go/i.test(entry.name) && entry.isDirectory()) candidates.push(join(programs, entry.name, 'go', 'bin', 'go.exe'))
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    for (const candidate of candidates) {
      try { await access(candidate); return candidate } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  }
  return 'go'
}

async function buildGo(goos, goarch, destination) {
  const args = ['build', '-trimpath', '-ldflags=-s -w', '-o', destination, './cmd/vietlatex-backend']
  try {
    await run(go, args, goEnvironment(goos, goarch))
  } catch (nativeError) {
    if (process.platform !== 'win32') throw nativeError
    const wsl = process.env.WSL_BINARY || 'wsl.exe'
    const sourceLinux = toWslPath(moduleDir)
    const destinationLinux = toWslPath(destination)
    const shell = `set -eu; cd ${shellQuote(sourceLinux)}; if command -v go >/dev/null 2>&1; then go_bin="$(command -v go)"; elif [ -x /usr/local/go/bin/go ]; then go_bin=/usr/local/go/bin/go; else go_bin="$(find "$HOME/.local/share" -path '*/bin/go' -type f -print -quit)"; fi; test -n "$go_bin"; GOOS=${shellQuote(goos)} GOARCH=${shellQuote(goarch)} CGO_ENABLED=0 "$go_bin" build -trimpath -ldflags='-s -w' -o ${shellQuote(destinationLinux)} ./cmd/vietlatex-backend`
    await run(wsl, ['--exec', 'bash', '-lc', shell], process.env)
  }
}

function toWslPath(value) {
  const resolved = resolve(value)
  const match = /^([a-z]):\\(.*)$/i.exec(resolved)
  if (!match) throw new Error(`Không đổi được đường dẫn Windows sang WSL: ${resolved}`)
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`
}

function shellQuote(value) { return `'${value.replaceAll("'", "'\\''")}'` }

await mkdir(outputDir, { recursive: true })

if (universalMac) {
  if (process.platform !== 'darwin') throw new Error('Bản macOS universal cần được biên dịch trên macOS có lipo.')
  const staging = join(outputDir, '.universal-staging')
  const binaries = [join(staging, 'amd64'), join(staging, 'arm64')]
  await mkdir(staging, { recursive: true })
  try {
    await buildGo('darwin', 'amd64', binaries[0])
    await buildGo('darwin', 'arm64', binaries[1])
    await run('lipo', ['-create', binaries[0], binaries[1], '-output', join(outputDir, 'vietlatex-backend')], process.env)
    await chmod(join(outputDir, 'vietlatex-backend'), 0o755)
  } finally {
    const resolved = resolve(staging)
    const relativePath = relative(resolve(outputDir), resolved)
    if (relativePath && !relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath)) {
      await rm(resolved, { recursive: true, force: true })
    }
  }
} else {
  const goos = windowsX64 ? 'windows' : process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
  const goarch = windowsX64 ? 'amd64' : process.arch === 'arm64' ? 'arm64' : 'amd64'
  const extension = goos === 'windows' ? '.exe' : ''
  const destination = join(outputDir, `vietlatex-backend${extension}`)
  const temporary = join(outputDir, `.vietlatex-backend${extension}.tmp`)
  await buildGo(goos, goarch, temporary)
  try {
    await rename(temporary, destination)
  } catch (error) {
    // Windows cannot overwrite a running executable but can rename it aside.
    if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error
    await rename(destination, join(outputDir, `.vietlatex-backend-${Date.now()}.old${extension}`))
    await rename(temporary, destination)
  }
  for (const name of await readdir(outputDir)) {
    if (/^\.vietlatex-backend-\d+\.old/.test(name)) await rm(join(outputDir, name), { force: true }).catch(() => {})
  }
  if (goos !== 'windows') await chmod(destination, 0o755)
}

console.log(`Go backend ready in ${relative(root, outputDir)}`)
