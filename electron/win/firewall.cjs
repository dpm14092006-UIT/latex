const { execFile } = require('node:child_process')
const { join } = require('node:path')

// Read-only look at why another machine may not reach the LAN host on Windows:
// the network's profile (Public/Private/Domain) and this executable's inbound
// firewall rules. Cancelling the first-run firewall prompt silently creates a
// Block rule, and Public networks often have no Allow rule at all.
const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$networks = @(Get-NetConnectionProfile | ForEach-Object { [pscustomobject]@{ alias = [string]$_.InterfaceAlias; category = [string]$_.NetworkCategory } })
$profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; enabled = [string]$_.Enabled -eq 'True' } })
$rules = @(Get-NetFirewallApplicationFilter -PolicyStore ActiveStore -Program $env:VIETLATEX_FIREWALL_PROGRAM | Get-NetFirewallRule | Where-Object { [string]$_.Enabled -eq 'True' -and [string]$_.Direction -eq 'Inbound' } | ForEach-Object { [pscustomobject]@{ action = [string]$_.Action; profile = [string]$_.Profile } })
ConvertTo-Json -Compress -Depth 3 -InputObject @{ networks = $networks; profiles = $profiles; rules = $rules }
`

function runPowerShell(program, { env = process.env, timeout = 15000 } = {}) {
  const shell = join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
  return new Promise(resolve => {
    execFile(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      env: { ...env, VIETLATEX_FIREWALL_PROGRAM: program }, timeout, windowsHide: true, maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      if (error) return resolve(null)
      try { resolve(JSON.parse(stdout.trim())) } catch { resolve(null) }
    })
  })
}

const list = value => Array.isArray(value) ? value : value ? [value] : []
function normalize(report) {
  if (!report || typeof report !== 'object') return null
  return {
    networks: list(report.networks).filter(item => typeof item?.alias === 'string'),
    profiles: list(report.profiles).filter(item => typeof item?.name === 'string'),
    rules: list(report.rules).filter(item => typeof item?.action === 'string' && typeof item?.profile === 'string'),
  }
}

// `state`: 'blocked' (a Block rule covers this network's profile), 'unconfirmed'
// (no Allow rule yet; Windows may still prompt) or 'allowed'. Null when unknown.
function firewallAdvice(report, interfaceName) {
  const data = normalize(report)
  const network = data?.networks.find(item => item.alias === interfaceName)
  if (!network) return null
  const profile = network.category === 'DomainAuthenticated' ? 'Domain' : network.category
  if (!['Public', 'Private', 'Domain'].includes(profile)) return null
  const base = { network: network.alias, profile }
  if (data.profiles.some(item => item.name === profile && !item.enabled)) return { ...base, state: 'allowed' }
  const covers = rule => rule.profile === 'Any' || rule.profile.split(/,\s*/).includes(profile)
  // Windows Firewall lets a Block rule win over any Allow rule.
  if (data.rules.some(rule => rule.action === 'Block' && covers(rule))) return { ...base, state: 'blocked' }
  if (!data.rules.some(rule => rule.action === 'Allow' && covers(rule))) return { ...base, state: 'unconfirmed' }
  return { ...base, state: 'allowed' }
}

function createFirewallInspector({ program = process.execPath, run = runPowerShell, now = Date.now, maxAge = 30000 } = {}) {
  let cached = null, pending = null
  return async function inspect(interfaceName, { refresh = false } = {}) {
    if (refresh || !cached || now() - cached.at > maxAge) {
      pending ??= run(program).then(report => { cached = { at: now(), report }; return report }).finally(() => { pending = null })
      await pending
    }
    return firewallAdvice(cached.report, interfaceName)
  }
}

module.exports = { firewallAdvice, createFirewallInspector, runPowerShell }
