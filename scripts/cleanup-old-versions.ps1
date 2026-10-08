param([switch]$Apply, [switch]$Thorough)
$ErrorActionPreference = 'Stop'
$cleanupRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$cleanupTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$cleanupPackage = Get-Content -LiteralPath (Join-Path $cleanupRoot 'package.json') -Raw | ConvertFrom-Json
$releaseRoot = Join-Path $cleanupRoot 'release-desktop'
$reportPath = Join-Path $cleanupRoot $(if ($Thorough) {'docs/cleanup-report.json'} else {'artifacts/cleanup-report.json'})

# Keep the latest verified portable at the path already delivered to the user.
$portableDirectory = Get-ChildItem -LiteralPath $releaseRoot -Directory |
  Where-Object { $_.Name -match '^latest-\d{4}-\d{2}-\d{2}$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'portable-manifest.json')) } |
  Sort-Object Name -Descending | Select-Object -First 1
if (-not $portableDirectory) { throw 'No verified portable release found; nothing will be deleted.' }
$portableManifest = Get-Content -LiteralPath (Join-Path $portableDirectory.FullName 'portable-manifest.json') -Raw | ConvertFrom-Json
$portableName = [IO.Path]::GetFileName([string]$portableManifest.path)
if ($portableName -notmatch "^Viet-Latex-Studio-$([regex]::Escape([string]$cleanupPackage.version))-Portable(?:-[A-Fa-f0-9]{7,40})?\.exe$") {
  throw 'Portable manifest filename is invalid; nothing will be deleted.'
}
$portablePath = Join-Path $portableDirectory.FullName $portableName
if ($portableManifest.version -ne $cleanupPackage.version -or $portableManifest.sha256 -notmatch '^[A-Fa-f0-9]{64}$') {
  throw 'Portable release manifest does not match the current package.'
}
$portableHash = (Get-FileHash -LiteralPath $portablePath -Algorithm SHA256).Hash
if ($portableHash -ne $portableManifest.sha256) { throw 'Portable release checksum does not match.' }

$cleanupProcesses = @(Get-CimInstance Win32_Process | Select-Object Name,ExecutablePath,CommandLine)
$hasActiveProjectBackend = @($cleanupProcesses | Where-Object {
  $_.Name -match 'vietlatex-backend' -and $_.ExecutablePath -like "$cleanupRoot\build\backend\*"
}).Count -gt 0
$cleanupCandidates = [Collections.Generic.List[object]]::new()
function Add-CleanupCandidate([string]$Path, [string]$Reason, [string]$AllowedRoot) {
  if (Test-Path -LiteralPath $Path) {
    $cleanupCandidates.Add([pscustomobject]@{path=[IO.Path]::GetFullPath($Path); reason=$Reason; allowedRoot=$AllowedRoot})
  }
}

# Normal mode retains a fallback; thorough mode keeps only the newest release.
foreach ($entry in Get-ChildItem -LiteralPath $releaseRoot -Force) {
  if ($entry.FullName -eq $portableDirectory.FullName -or (-not $Thorough -and $entry.Name -eq 'VietLatex-Studio-0.4.6')) { continue }
  if ($entry.Name -match '^(VietLatex-Studio-\d+\.\d+\.\d+|latest-\d{4}-\d{2}-\d{2}|Viet-Latex-Studio-\d+\.\d+\.\d+-Setup\.exe(?:\.sha256)?|win-unpacked\.tmp)$') {
    Add-CleanupCandidate $entry.FullName 'Superseded desktop release' $cleanupRoot
  }
}
foreach ($entry in Get-ChildItem -LiteralPath $portableDirectory.FullName -Force) {
  if ($entry.Name -match '(\.incomplete|\.nsis\.7z|\.blockmap)$' -or $entry.Name -eq 'builder-debug.yml') {
    Add-CleanupCandidate $entry.FullName 'Intermediate packaging output' $cleanupRoot
  }
}

$artifactKeep = @(
  'full-check','audit-before','cleanup-report.json','cleanup-integrity.json','cleanup-lint.log',
  'audit-verification.json','audit-memory-benchmark.log','audit-concurrency-repeat.log',
  'audit-lockfile-check.log','audit-dependencies-before.json','audit-dependencies-after.json',
  'audit-packaging.log','audit-windows-policy.json','audit-package-sha256.json',
  'audit-packaged-exe-smoke.log','audit-packaged-ascii-smoke.log',
  'audit-latest-installer.log','audit-latest-portable.log'
)
$artifactRoot = Join-Path $cleanupRoot 'artifacts'
if ($Thorough -and (Test-Path -LiteralPath $artifactRoot)) {
  # Latest audit evidence is archived before this explicit mode is applied.
  $evidenceArchive = Join-Path $cleanupRoot 'docs/verification-2026-10-08.zip'
  if (-not (Test-Path -LiteralPath $evidenceArchive)) { throw 'Archive the latest audit evidence before thorough cleanup.' }
  $latestAuditReport = Join-Path $artifactRoot 'full-check/report.json'
  if (Test-Path -LiteralPath $latestAuditReport) {
    $evidenceZip = [IO.Compression.ZipFile]::OpenRead($evidenceArchive)
    try {
      $reportEntry = $evidenceZip.GetEntry('full-check/report.json')
      if (-not $reportEntry) { throw 'Latest audit report is missing from the evidence archive.' }
      $reportStream = $reportEntry.Open()
      $reportHasher = [Security.Cryptography.SHA256]::Create()
      try {
        $archivedHash = [BitConverter]::ToString($reportHasher.ComputeHash($reportStream)).Replace('-','')
        if ($archivedHash -ne (Get-FileHash -LiteralPath $latestAuditReport -Algorithm SHA256).Hash) { throw 'Latest audit report differs from its archive; archive it again.' }
      } finally { $reportStream.Dispose(); $reportHasher.Dispose() }
    } finally { $evidenceZip.Dispose() }
  }
  Add-CleanupCandidate $artifactRoot 'Generated audit output; latest evidence archived' $cleanupRoot
} elseif (Test-Path -LiteralPath $artifactRoot) {
  foreach ($entry in Get-ChildItem -LiteralPath $artifactRoot -Force) {
    if ($entry.Name -in $artifactKeep -or $entry.Extension -eq '.md') { continue }
    Add-CleanupCandidate $entry.FullName 'Reproducible test/build output or superseded log' $cleanupRoot
  }
}
foreach ($relativeName in @('tmp','desktop-build.log','build/backend/vietlatex-backend-next.exe')) {
  Add-CleanupCandidate (Join-Path $cleanupRoot $relativeName) 'Old diagnostic or build output' $cleanupRoot
}
if ($Thorough) {
  foreach ($relativeName in @(
    'design-demo','Mở demo Noir Full.cmd','scripts/run-noir-full-demo.mjs',
    'scripts/migrate-workspace-references-0.4.1.mjs','scripts/render-citation-regressions.mjs',
    'UPGRADE-0.3.0.md','UPGRADE-0.4.0.md','UPGRADE-0.4.1.md','UPGRADE-0.4.2.md',
    'UPGRADE-0.4.3.md','UPGRADE-0.4.4.md','user-data/noir-full-demo',
    'node_modules/.vite','node_modules/.vite-temp'
  )) { Add-CleanupCandidate (Join-Path $cleanupRoot $relativeName) 'Retired demo, old release notes, one-off tool or generated cache' $cleanupRoot }
  foreach ($relativeName in @('build/go-tmp','build/go-test-tmp','references')) {
    $emptyPath = Join-Path $cleanupRoot $relativeName
    if ((Test-Path -LiteralPath $emptyPath) -and @(Get-ChildItem -LiteralPath $emptyPath -Force).Count -eq 0) {
      Add-CleanupCandidate $emptyPath 'Empty retired directory' $cleanupRoot
    }
  }
}
$oldBackendCopies = @(Get-ChildItem -LiteralPath (Join-Path $cleanupRoot 'build/backend') -Force |
  Where-Object { $_.Name -match '^\.vietlatex-backend-\d+\.old\.exe$' })
if (-not $hasActiveProjectBackend) {
  foreach ($entry in $oldBackendCopies) { Add-CleanupCandidate $entry.FullName 'Obsolete backend copy' $cleanupRoot }
}
$emptyServer = Join-Path $cleanupRoot 'server'
if ((Test-Path -LiteralPath $emptyServer) -and @(Get-ChildItem -LiteralPath $emptyServer -Force).Count -eq 0) {
  Add-CleanupCandidate $emptyServer 'Empty legacy directory' $cleanupRoot
}

# Reference provenance stays in references/README.md; never remove local changes.
$referencesPreserved = @()
foreach ($referenceName in @('plate','shadcn-ui','lucide','react-resizable-panels')) {
  $referencePath = Join-Path $cleanupRoot "references/$referenceName"
  if (-not (Test-Path -LiteralPath $referencePath)) { continue }
  $referenceStatus = @(git -C $referencePath status --porcelain --untracked-files=all --ignored)
  if ($LASTEXITCODE -ne 0 -or $referenceStatus.Count -gt 0) { $referencesPreserved += $referencePath; continue }
  Add-CleanupCandidate $referencePath 'Clean optional reference clone; provenance retained' $cleanupRoot
}
foreach ($entry in Get-ChildItem -LiteralPath $cleanupTempRoot -Directory -Force) {
  if ($entry.Name -match '^(VietLatex-Audit-20261008|VietLatexDesktopBuild-\d+\.\d+\.\d+|vietlatex-e2e-[A-Za-z0-9]+|vietlatex-sync-desktop-[A-Za-z0-9]+)$') {
    Add-CleanupCandidate $entry.FullName 'Project-owned temporary build/test directory' $cleanupTempRoot
  }
}

# Validate all resolved paths, parent components and descendants before any delete.
$cleanupPlan = foreach ($candidate in $cleanupCandidates) {
  $resolvedPath = (Resolve-Path -LiteralPath $candidate.path).ProviderPath
  $allowedPrefix = $candidate.allowedRoot.TrimEnd('\') + '\'
  if (-not $resolvedPath.StartsWith($allowedPrefix,[StringComparison]::OrdinalIgnoreCase)) { throw "Target escapes allowed directory: $resolvedPath" }
  $componentPath = $resolvedPath
  while ($componentPath -and $componentPath -ne $candidate.allowedRoot) {
    if ((Get-Item -LiteralPath $componentPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing a junction/symlink: $componentPath" }
    $componentPath = [IO.Path]::GetDirectoryName($componentPath)
  }
  $targetItem = Get-Item -LiteralPath $resolvedPath -Force
  $descendants = if ($targetItem.PSIsContainer) { @(Get-ChildItem -LiteralPath $resolvedPath -Recurse -Force) } else { @() }
  if (@($descendants | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -gt 0) { throw "Target contains a junction/symlink: $resolvedPath" }
  $files = if ($targetItem.PSIsContainer) { @($descendants | Where-Object { -not $_.PSIsContainer }) } else { @($targetItem) }
  $inUse = @($cleanupProcesses | Where-Object {
    ($_.ExecutablePath -and ($_.ExecutablePath -eq $resolvedPath -or $_.ExecutablePath.StartsWith($resolvedPath + '\',[StringComparison]::OrdinalIgnoreCase))) -or
    ($_.CommandLine -and $_.CommandLine.IndexOf($resolvedPath,[StringComparison]::OrdinalIgnoreCase) -ge 0)
  }).Count -gt 0
  [pscustomobject]@{path=$resolvedPath; reason=$candidate.reason; files=$files.Count; bytes=[long](($files | Measure-Object -Property Length -Sum).Sum); status=$(if ($inUse) {'skipped-in-use'} else {'planned'}); error=$null}
}
$report = [ordered]@{
  createdAt=(Get-Date).ToString('o'); mode=$(if ($Apply) {'apply'} else {'preview'});
  portable=@{path=$portablePath;sha256=$portableHash};
  preserved=@('current source and configuration','node_modules dependencies','dist','tools/pandoc','main user-data and backups','sandbox','current documentation','latest portable and audit evidence');
  activeBackendCopiesPreserved=$(if ($hasActiveProjectBackend) {@($oldBackendCopies.FullName)} else {@()});
  referencesWithLocalFilesPreserved=@($referencesPreserved);
  targets=@($cleanupPlan)
}
New-Item -ItemType Directory -Path (Split-Path -Parent $reportPath) -Force | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding utf8
if ($Apply) {
  foreach ($target in $cleanupPlan) {
    if ($target.status -ne 'planned') { continue }
    try {
      Remove-Item -LiteralPath $target.path -Recurse -Force -ErrorAction Stop
      if (Test-Path -LiteralPath $target.path) { throw 'Target still exists after removal.' }
      $target.status = 'removed'
    } catch {
      $target.status = 'failed'
      $target.error = $_.Exception.Message
    }
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding utf8
  }
}
if ((Get-FileHash -LiteralPath $portablePath -Algorithm SHA256).Hash -ne $portableHash) { throw 'Preserved portable checksum changed.' }
$report['finishedAt'] = (Get-Date).ToString('o')
$report['summary'] = @{
  targets=$cleanupPlan.Count;
  removed=@($cleanupPlan | Where-Object status -eq 'removed').Count;
  planned=@($cleanupPlan | Where-Object status -eq 'planned').Count;
  skippedInUse=@($cleanupPlan | Where-Object status -eq 'skipped-in-use').Count;
  failed=@($cleanupPlan | Where-Object status -eq 'failed').Count;
  bytesRemoved=[long](($cleanupPlan | Where-Object status -eq 'removed' | Measure-Object -Property bytes -Sum).Sum);
  bytesPlanned=[long](($cleanupPlan | Where-Object status -eq 'planned' | Measure-Object -Property bytes -Sum).Sum)
}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding utf8
$report.summary | ConvertTo-Json -Compress
if ($report.summary.failed -gt 0) { exit 1 }
