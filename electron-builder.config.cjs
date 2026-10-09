const { tmpdir } = require('node:os')
const { join } = require('node:path')
const pkg = require('./package.json')
const packageBuild = pkg.build

module.exports = {
  ...packageBuild,
  electronFuses: process.platform === 'darwin'
    ? { ...packageBuild.electronFuses, resetAdHocDarwinSignature: true }
    : packageBuild.electronFuses,
  extraResources: [
    ...packageBuild.extraResources.map(resource => process.platform === 'darwin'
      ? { ...resource, filter: resource.to === 'backend' ? ['vietlatex-backend'] : ['**/*', '!**/*.exe'] }
      : resource),
    // Fallback engine for Macs without MacTeX (scripts/setup-tectonic.mjs).
    ...(process.platform === 'darwin' ? [{ from: 'tools/tectonic', to: 'tectonic', filter: ['**/*'] }] : []),
  ],
  directories: {
    ...packageBuild.directories,
    output: join(tmpdir(), `VietLatexDesktopBuild-${pkg.version}`),
  },
}
