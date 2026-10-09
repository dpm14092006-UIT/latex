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
  // Derived so a version bump only has to touch package.json.
  dmg: { ...pkg.build.dmg, title: `${pkg.build.productName} ${pkg.version}` },
  directories: {
    ...pkg.build.directories,
    output: join(__dirname, 'artifacts', 'mac-package'),
  },
}
