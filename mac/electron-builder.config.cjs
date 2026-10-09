// macOS packaging. Shared settings (appId, files, fuses) live in package.json "build".
const { join } = require('node:path')
const pkg = require('../package.json')

const resources = join(__dirname, 'resources')

module.exports = {
  ...pkg.build,
  electronFuses: { ...pkg.build.electronFuses, resetAdHocDarwinSignature: true },
  extraResources: [
    { from: 'build/backend', to: 'backend', filter: ['vietlatex-backend'] },
    { from: 'tools/pandoc', to: 'pandoc', filter: ['**/*', '!**/*.exe'] },
  ],
  mac: {
    category: 'public.app-category.productivity',
    artifactName: 'Viet-Latex-Studio-${version}-${arch}.${ext}',
    target: ['dmg'],
    icon: join(resources, 'app-icon.icns'),
    minimumSystemVersion: '26.0',
    extendInfo: {
      NSLocalNetworkUsageDescription: 'Viet Latex Studio cần truy cập mạng nội bộ để đồng bộ tài liệu và PDF với máy bạn đã ghép. Chia sẻ chỉ bắt đầu khi bạn bật Đồng bộ LAN.',
    },
    hardenedRuntime: true,
    entitlements: join(resources, 'entitlements.mac.plist'),
    entitlementsInherit: join(resources, 'entitlements.mac.plist'),
    x64ArchFiles: 'Contents/Resources/{backend/vietlatex-backend,pandoc/pandoc}',
    sign: join(__dirname, 'sign-mac.cjs'),
    // A configured Developer ID takes precedence; local builds use an ad-hoc signature.
    ...(process.env.CSC_LINK || process.env.CSC_NAME ? {} : { identity: '-' }),
  },
  dmg: {
    sign: false,
    // Derived so a version bump only has to touch package.json.
    title: `${pkg.build.productName} ${pkg.version}`,
    contents: [
      { x: 160, y: 180, type: 'file' },
      { x: 440, y: 180, type: 'link', path: '/Applications' },
    ],
  },
  afterPack: join(__dirname, 'package-tex.cjs'),
  directories: { output: join(__dirname, '..', 'artifacts', 'mac-package') },
}
