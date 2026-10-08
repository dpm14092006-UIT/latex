const { tmpdir } = require('node:os')
const { join } = require('node:path')
const pkg = require('./package.json')
const packageBuild = pkg.build

module.exports = {
  ...packageBuild,
  extraResources: packageBuild.extraResources.map(resource => process.platform === 'darwin'
    ? { ...resource, filter: resource.to === 'backend' ? ['vietlatex-backend'] : ['**/*', '!**/*.exe'] }
    : resource),
  directories: {
    ...packageBuild.directories,
    output: join(tmpdir(), `VietLatexDesktopBuild-${pkg.version}`),
  },
}
