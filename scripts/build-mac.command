#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  printf '\n%s\n' "$1" >&2
  if [ -t 0 ]; then read -r -p 'Bam Enter de dong cua so...' _; fi
  exit 1
}

[ "$(uname -s)" = 'Darwin' ] || fail 'File nay can chay tren macOS de tao bo cai .dmg.'
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/local/go/bin:$PATH"
for tool in node npm go; do
  command -v "$tool" >/dev/null 2>&1 || fail "Thieu $tool. Cai Node.js 24 LTS/npm 11 va Go 1.26.8+ theo docs/MAC-INSTALLER.md, sau do chay lai."
done
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22 || (major===22 && minor<13)) process.exit(1)' || fail 'Can Node.js 22.13+; khuyen nghi Node.js 24 LTS.'
trap 'printf "\nBuild that bai. Xem thong bao phia tren; chua co bo cai Mac hoan chinh.\n" >&2' ERR
printf '\nDang tao Viet Latex Studio cho Mac Intel va Apple Silicon...\n'
npm ci
npm run desktop:build:mac
app_version="$(node -p 'require("./package.json").version')"
installer_name="Viet-Latex-Studio-${app_version}-universal.dmg"
(
  cd release-desktop
  shasum -a 256 -c "${installer_name}.sha256"
)
printf '\nDa tao bo cai: release-desktop/%s\n' "$installer_name"
open release-desktop
