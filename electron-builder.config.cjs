const { join } = require('node:path')
const pkg = require('./package.json')

module.exports = {
  ...pkg.build,
  electronFuses: { ...pkg.build.electronFuses, resetAdHocDarwinSignature: true },
  mac: {
    ...pkg.build.mac,
    // A configured Developer ID takes precedence; local builds use an ad-hoc signature.
    ...(process.env.CSC_LINK || process.env.CSC_NAME ? {} : { identity: '-' }),
  },
  directories: {
    ...pkg.build.directories,
    output: join(__dirname, 'artifacts', 'mac-package'),
  },
}
