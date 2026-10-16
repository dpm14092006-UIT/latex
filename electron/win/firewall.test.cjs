const test = require('node:test')
const assert = require('node:assert/strict')
const { firewallAdvice, createFirewallInspector } = require('./firewall.cjs')

const report = (category, rules, enabled = true) => ({
  networks: [{ alias: 'Wi-Fi', category }],
  profiles: ['Domain', 'Private', 'Public'].map(name => ({ name, enabled })),
  rules,
})

test('a Block rule for the network profile wins over Allow rules', () => {
  const advice = firewallAdvice(report('Public', [{ action: 'Allow', profile: 'Any' }, { action: 'Block', profile: 'Public' }]), 'Wi-Fi')
  assert.deepEqual(advice, { network: 'Wi-Fi', profile: 'Public', state: 'blocked' })
  assert.equal(firewallAdvice(report('Private', [{ action: 'Block', profile: 'Private, Public' }]), 'Wi-Fi').state, 'blocked')
})

test('rules only count for the profile they cover', () => {
  assert.equal(firewallAdvice(report('Private', [{ action: 'Allow', profile: 'Private' }]), 'Wi-Fi').state, 'allowed')
  assert.equal(firewallAdvice(report('Public', [{ action: 'Allow', profile: 'Private' }]), 'Wi-Fi').state, 'unconfirmed')
  assert.equal(firewallAdvice(report('Public', []), 'Wi-Fi').state, 'unconfirmed')
  assert.equal(firewallAdvice(report('DomainAuthenticated', [{ action: 'Allow', profile: 'Domain' }]), 'Wi-Fi').state, 'allowed')
})

test('a disabled firewall profile and unknown reports raise no warning', () => {
  assert.equal(firewallAdvice(report('Public', [{ action: 'Block', profile: 'Public' }], false), 'Wi-Fi').state, 'allowed')
  assert.equal(firewallAdvice(null, 'Wi-Fi'), null)
  assert.equal(firewallAdvice(report('Public', []), 'Ethernet'), null, 'adapter without a network profile')
})

test('PowerShell single-object output (not an array) is accepted', () => {
  const single = { networks: { alias: 'Wi-Fi', category: 'Private' }, profiles: { name: 'Private', enabled: true }, rules: { action: 'Allow', profile: 'Private' } }
  assert.equal(firewallAdvice(single, 'Wi-Fi').state, 'allowed')
})

test('inspector caches one PowerShell run and refreshes on request', async () => {
  let runs = 0, clock = 0
  const inspect = createFirewallInspector({ program: 'app.exe', now: () => clock, run: async program => { runs++; assert.equal(program, 'app.exe'); return report('Public', []) } })
  await Promise.all([inspect('Wi-Fi'), inspect('Wi-Fi')])
  assert.equal(runs, 1, 'concurrent checks share one run')
  assert.equal((await inspect('Wi-Fi')).state, 'unconfirmed')
  assert.equal(runs, 1)
  await inspect('Wi-Fi', { refresh: true })
  clock = 60000; await inspect('Wi-Fi')
  assert.equal(runs, 3)
})
