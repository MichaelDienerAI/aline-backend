'use strict'
// The public demo bridge is retired: no query parameter or shared browser
// credential admits a WebSocket, even while the old bridge variables are still
// configured. Supabase members connect as before; a failed proof never becomes
// the demo member; the demo member and its memory stay intact. The per-member
// Authorization-header credential (not reachable from browsers; used by the
// offline rehearsal harness) is unchanged. Supabase and model are doubles.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')
const WebSocket = require('ws')
const { openMemoryStore } = require('./services/member-memory')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-bridge-retired-'))
const dbPath = path.join(dir, 'members.sqlite')
const capture = path.join(dir, 'capture.jsonl')
const fixtureFile = path.join(dir, 'fixture.json')
const BRIDGE = 'synthetic-old-bridge-token-0123456789abcdef'
const USER = '12121212-1212-4212-8212-121212121212'
const USER_REVOKED = '34343434-3434-4434-8434-343434343434'
const port = 6600 + (process.pid % 500)

const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url')
let serial = 0
const token = sub => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig${++serial}synthetic`
const tGood = token(USER), tGood2 = token(USER), tRevoked = token(USER_REVOKED), tBad = token(USER)
fs.writeFileSync(fixtureFile, JSON.stringify({
  users: { [tGood]: USER, [tGood2]: USER, [tRevoked]: USER_REVOKED },
  memberships: { [USER]: 'active', [USER_REVOKED]: 'canceled' }, down: false,
}))
fs.writeFileSync(capture, '')

const store = openMemoryStore(dbPath)
const demo = store.enroll()
store.close()
// Seed the demo member with a record through the member runtime.
const { createMemberRuntime } = require('./services/member-runtime')
{
  const runtime = createMemberRuntime(dbPath)
  const session = runtime.connect('Bearer ' + demo.credential, 'aline', () => {})
  session.control({ type: 'memory', requestId: 'seed', action: 'create', memory: { content: 'Synthetic demo record', scope: 'all' } })
  session.close()
}

const pause = ms => new Promise(r => setTimeout(r, ms))
let passed = 0
let failed = 0
let child
let output = ''
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name) } catch (e) { failed++; console.log('FAIL ' + name + ' ' + e.message) }
}
const rows = sql => { const db = new DatabaseSync(dbPath); try { return db.prepare(sql).all().map(r => ({ ...r })) } finally { db.close() } }
const count = sql => rows(sql)[0].n
const snapshot = () => ({
  members: rows('SELECT id FROM members ORDER BY id'),
  mappings: rows('SELECT provider, subject, member_id FROM member_identities ORDER BY subject'),
  demoMemories: rows(`SELECT id, body FROM memories WHERE member_id='${demo.memberId}' ORDER BY id`),
})

async function start() {
  const env = {
    PATH: process.env.PATH, NODE_OPTIONS: '', PORT: String(port), MODEL_NAME: 'synthetic-local',
    ANTHROPIC_API_KEY: 'synthetic', DEEPGRAM_API_KEY: 'synthetic', ELEVENLABS_API_KEY: 'synthetic',
    SIMLI_API_KEY: 'synthetic-simli-key-bridge-0123', AVATAR_TEST_TOKEN: 'synthetic-bridge-session-0123456789',
    PERSONA_V4_DB: dbPath, SUPABASE_URL: 'https://synthetic-supabase.test', SUPABASE_SERVICE_KEY: 'synthetic-service-key-bridge-0123',
    // The retired bridge's variables are deliberately still configured: the
    // code must ignore them, not merely lack them.
    PERSONA_DEMO_BRIDGE_TOKEN: BRIDGE, PERSONA_DEMO_MEMBER_CREDENTIAL: demo.credential,
    IDENTITY_TEST_CAPTURE: capture, IDENTITY_TEST_FIXTURE: fixtureFile,
  }
  child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-support/v4-identity-providers.cjs'), 'server.js'],
    { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', d => { output += d })
  child.stderr.on('data', d => { output += d })
  for (let i = 0; i < 250; i++) {
    if (child.exitCode !== null) throw Error('server exited during startup')
    if (output.includes('Backend v3.3.0 on port')) return
    await pause(20)
  }
  throw Error('server did not start')
}

// Resolves {ws} when the socket stays open past the handler, or {code} when
// the server closes it (rejections are accepted upgrades closed with a code).
function attempt(query, protocols, options) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?${query}`, protocols, options)
  ws.events = []
  ws.on('message', (d, bin) => { if (!bin) ws.events.push(JSON.parse(d.toString())) })
  ws.on('error', () => {})
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('timeout')), 4000)
    let opened = false
    ws.on('open', () => { opened = true; setTimeout(() => { clearTimeout(timer); if (ws.readyState === WebSocket.OPEN) resolve({ ws }) }, 300) })
    ws.on('close', code => { clearTimeout(timer); resolve({ code, opened }) })
  })
}
async function control(ws, action, props = {}) {
  const requestId = 'q' + (++serial)
  ws.send(JSON.stringify({ type: 'memory', requestId, action, ...props }))
  for (let i = 0; i < 200; i++) {
    const found = ws.events.find(e => e.requestId === requestId)
    if (found) return found
    await pause(10)
  }
  throw Error('no memory response')
}
const close = ws => new Promise(r => { ws.once('close', r); ws.close() })

;(async () => {
  await start()
  const before = snapshot()
  let member

  await check('1. valid Supabase member connects and is served', async () => {
    const r = await attempt('persona=aline', ['persona.v1', tGood])
    assert.ok(r.ws, 'rejected ' + r.code)
    assert.equal(r.ws.protocol, 'persona.v1')
    const created = await control(r.ws, 'create', { memory: { content: 'Synthetic member record', scope: 'all' } })
    assert.equal(created.type, 'memory_result')
    member = rows(`SELECT member_id FROM member_identities WHERE subject='${USER}'`)[0].member_id
    assert.deepEqual(rows(`SELECT member_id FROM memories WHERE id='${created.result.id}'`), [{ member_id: member }])
    await close(r.ws)
  })
  await check('2. invalid Supabase token rejected (1008)', async () => {
    assert.equal((await attempt('persona=aline', ['persona.v1', tBad])).code, 1008)
  })
  await check('3. revoked membership rejected (1008)', async () => {
    assert.equal((await attempt('persona=aline', ['persona.v1', tRevoked])).code, 1008)
  })
  await check('4. ?bridge=<the configured old token> alone is rejected (1008)', async () => {
    assert.equal((await attempt(`persona=aline&bridge=${BRIDGE}`)).code, 1008)
  })
  await check('5. ?bridge=<arbitrary token> is rejected (1008)', async () => {
    assert.equal((await attempt('persona=aline&bridge=anything-else-0123456789abcdef0123')).code, 1008)
  })
  await check('6. bridge parameter plus a valid Supabase proof: the Supabase member, never the demo member', async () => {
    const r = await attempt(`persona=aline&bridge=${BRIDGE}`, ['persona.v1', tGood2])
    assert.ok(r.ws)
    const created = await control(r.ws, 'create', { memory: { content: 'Synthetic second member record', scope: 'all' } })
    assert.deepEqual(rows(`SELECT member_id FROM memories WHERE id='${created.result.id}'`), [{ member_id: member }])
    await close(r.ws)
  })
  await check('6b. bridge parameter plus an invalid Supabase proof is rejected, not bridged', async () => {
    assert.equal((await attempt(`persona=aline&bridge=${BRIDGE}`, ['persona.v1', tBad])).code, 1008)
  })
  await check('7. missing credentials rejected (1008)', async () => {
    assert.equal((await attempt('persona=aline')).code, 1008)
    assert.equal((await attempt('persona=chase')).code, 1008)
  })
  await check('8/10. no demo fallback: demo member, its record and its memories untouched', async () => {
    const now = snapshot()
    assert.deepEqual(now.demoMemories, before.demoMemories)
    assert.ok(now.members.some(m => m.id === demo.memberId))
    assert.equal(before.demoMemories.length, 1)
  })
  await check('9. one mapping for the Supabase subject; no member created by any rejected attempt', async () => {
    assert.equal(count(`SELECT COUNT(*) n FROM member_identities WHERE subject='${USER}'`), 1)
    assert.equal(count(`SELECT COUNT(*) n FROM member_identities WHERE subject='${USER_REVOKED}'`), 0)
    assert.equal(count('SELECT COUNT(*) n FROM members'), before.members.length + 1)
  })
  await check('per-member Authorization-header credential (non-browser) is unchanged and is not the bridge', async () => {
    const r = await attempt('persona=aline', undefined, { headers: { Authorization: 'Bearer ' + demo.credential } })
    assert.ok(r.ws, 'rejected ' + r.code)
    await close(r.ws)
    assert.deepEqual(snapshot().demoMemories, before.demoMemories)
  })
  await check('server output: no bridge token, credential or Supabase token', async () => {
    for (const s of [BRIDGE, demo.credential, tGood, tGood2, tRevoked, tBad]) assert.ok(!output.includes(s), 'leaked ' + s.slice(0, 10))
  })

  child.kill('SIGTERM')
  await new Promise(r => child.once('exit', r))
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.log('FAIL harness ' + e.message); if (child) child.kill('SIGKILL'); process.exit(1) })
