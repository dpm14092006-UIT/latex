const { delimiter, join } = require('node:path')

// MiKTeX installs per user under LOCALAPPDATA and is not always on the PATH of
// processes started from the Start menu right after installation.
function backendEnvironment({ env = process.env } = {}) {
  const extra = []
  if (env.LOCALAPPDATA) extra.push(join(env.LOCALAPPDATA, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'))
  if (env.ProgramFiles) extra.push(join(env.ProgramFiles, 'MiKTeX', 'miktex', 'bin', 'x64'))
  const key = Object.keys(env).find(name => name.toUpperCase() === 'PATH') || 'Path'
  const paths = [...(env[key] || '').split(delimiter).filter(Boolean), ...extra]
  return { ...env, [key]: [...new Set(paths)].join(delimiter) }
}

module.exports = { backendEnvironment }
