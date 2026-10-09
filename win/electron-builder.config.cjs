// Windows packaging. Shared settings (appId, files, fuses) live in package.json "build".
const { join } = require('node:path')
const pkg = require('../package.json')

module.exports = {
  ...pkg.build,
  extraResources: [
    { from: 'build/backend', to: 'backend', filter: ['vietlatex-backend.exe'] },
    { from: 'tools/pandoc', to: 'pandoc', filter: ['pandoc.exe', 'COPYING*', 'COPYRIGHT*', 'provenance.json'] },
  ],
  win: {
    icon: join(__dirname, 'resources', 'app-icon.ico'),
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'Viet-Latex-Studio-${version}-Setup.${ext}',
  },
  // Per-user install without admin rights, so the in-app updater can run the
  // next Setup.exe silently (/S) into the same folder.
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: pkg.build.productName,
    deleteAppDataOnUninstall: false,
  },
  directories: { output: join(__dirname, '..', 'artifacts', 'win-package') },
}
