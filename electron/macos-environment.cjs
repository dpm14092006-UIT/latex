const { join, dirname } = require('node:path')
const { homedir } = require('node:os')

// Finder launches do not load the user's shell profile.
function backendEnvironment({ appPath, resourcesPath, env = process.env, home = homedir() }) {
  const texRoot = resourcesPath ? join(resourcesPath, 'tex') : join(appPath, 'tools', 'tex')
  const texBin = join(texRoot, 'bin', 'universal-darwin')
  const paths = [
    ...(env.XELATEX_PATH ? [dirname(env.XELATEX_PATH)] : []),
    texBin, '/Library/TeX/texbin', '/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin',
    join(home, 'Library', 'TinyTeX', 'bin', 'universal-darwin'), join(home, 'bin'),
    ...(env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin').split(':'),
  ]
  return {
    ...env,
    PATH: [...new Set(paths)].join(':'),
    // Keep generated fonts/configuration outside the signed, possibly read-only app.
    TEXMFVAR: env.TEXMFVAR || join(home, 'Library', 'Caches', 'vn.vietlatex.studio', 'texmf-var'),
    TEXMFCONFIG: env.TEXMFCONFIG || join(home, 'Library', 'Application Support', 'vn.vietlatex.studio', 'texmf-config'),
  }
}

module.exports = { backendEnvironment }
