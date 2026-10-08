const { cp, mkdir } = require('node:fs/promises')
const { join } = require('node:path')
const { Arch } = require('builder-util')

module.exports = async function packageTex(context) {
  if (context.electronPlatformName !== 'darwin' || context.arch !== Arch.universal) return
  // The TeX executables are already universal. Add the shared tree once after
  // Electron's merge and before code signing, avoiding a merge of 27,000 data files.
  const resources = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
  await mkdir(resources, { recursive: true })
  await cp(join(context.packager.projectDir, 'tools', 'tex'), join(resources, 'tex'), {
    recursive: true,
    // Preserve relative TeX symlinks: absolute links would point to the build machine.
    verbatimSymlinks: true,
    filter: source => !source.includes('/tlpkg/backups/'),
  })
}
