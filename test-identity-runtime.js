'use strict'
// Supabase member identity inside the real server.js process: one user is one
// Persona member across /v4/avatar-session and the WebSocket, members are
// isolated, failures close without demo fallback, and secrets stay out of
// responses and logs. Supabase and Simli are in-process doubles.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')
const WebSocket = require('ws')
const { openMemoryStore } = require('./services/member-memory')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-identity-rt-'))
const dbPath = path.join(dir, 'members.sqlite')
const capture = path.join(dir, 'capture.jsonl')
const fixtureFile = path.join(dir, 'fixture.json')
const SERVICE_KEY = 'synthetic-service-role-key-NEVER-LOGGED-0123456789'
const SIMLI_KEY = 'synthetic-simli-key-identity-0123456789'
const SIMLI_TOKEN = 'synthetic-identity-session-token-NEVER-LOGGED-0123456789'
const BRIDGE = 'synthetic-bridge-token-0123456789abcdef'
const ORIGIN = 'https://personaio.app'
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const USER_INACTIVE = '33333333-3333-4333-8333-333333333333'
const port = 5800 + (process.pid % 500)

const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url')
let serial = 0
const token = sub => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig${++serial}synthetic`
const tA = token(USER_A), tA2 = token(USER_A), tB = token(USER_B), tI = token(USER_INACTIVE), tBad = token(USER_A)
const fixture = { users: { [tA]: USER_A, [tA2]: USER_A, [tB]: USER_B, [tI]: USER_INACTIVE }, memberships: { [USER_A]: 'active', [USER_B]: 'active', [USER_INACTIVE]: 'canceled' }, down: false }
const writeFixture = () => fs.writeFileSync(fixtureFile, JSON.stringify(fixture))

const store = openMemoryStore(dbPath)
const demo = store.enroll()
store.close()
fs.writeFileSync(capture, '')
writeFixture()

const pause = ms => new Promise(r => setTimeout(r, ms))
let passed = 0
let failed = 0
let child
let output = ''
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name) } catch (e) { failed++; console.log('FAIL ' + name + ' ' + e.message) }
}
const records = type => fs.readFileSync(capture, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(r => r.type === type)
const rows = sql => { const db = new DatabaseSync(dbPath); try { return db.prepare(sql).all().map(r => ({ ...r })) } finally { db.close() } }

async function start() {
  const env = {
    PATH: process.env.PATH, NODE_OPTIONS: '', PORT: String(port), MODEL_NAME: 'synthetic-local',
    ANTHROPIC_API_KEY: 'synthetic', DEEPGRAM_API_KEY: 'synthetic', ELEVENLABS_API_KEY: 'synthetic',
    SIMLI_API_KEY: SIMLI_KEY, AVATAR_TEST_TOKEN: SIMLI_TOKEN, PERSONA_V4_DB: dbPath,
    SUPABASE_URL: 'https://synthetic-supabase.test', SUPABASE_SERVICE_KEY: SERVICE_KEY,
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

async function avatar(bearer, persona = 'aline') {
  const r = await fetch(`http://127.0.0.1:${port}/v4/avatar-session`, {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: 'Bearer ' + bearer },
    body: JSON.stringify({ persona }),
  })
  const text = await r.text()
  let body = null
  try { body = JSON.parse(text) } catch {}
  return { status: r.status, text, body }
}

// Opens a socket; resolves {ws, protocol} on open or {closed: code} on close.
function connect(query, protocols) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?${query}`, protocols)
  ws.events = []
  ws.on('message', (data, isBinary) => { if (!isBinary) ws.events.push(JSON.parse(data.toString())) })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('timeout')), 4000)
    ws.once('open', () => { clearTimeout(timer); resolve({ ws, protocol: ws.protocol }) })
    ws.once('close', code => { clearTimeout(timer); resolve({ closed: code }) })
    ws.once('error', () => {})
  })
}
async function control(ws, action, props = {}) {
  const requestId = String(++serial)
  ws.send(JSON.stringify({ type: 'memory', requestId, action, ...props }))
  for (let i = 0; i < 200; i++) {
    const found = ws.events.find(e => e.requestId === requestId)
    if (found) return found
    await pause(10)
  }
  throw Error('no memory response')
}
const close = ws => new Promise(r => { ws.once('close', r); ws.close() })
// Rejections are accepted upgrades closed with a policy code by the handler
// (the existing contract for every v4 rejection path); wait for that code.
function closeCode(query, protocols) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?${query}`, protocols)
  ws.on('error', () => {})
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('timeout')), 4000)
    ws.on('close', code => { clearTimeout(timer); resolve(code) })
  })
}

;(async () => {
  await start()

  let memberA
  await check('1/5. Supabase member A: avatar-session 200, one member and one mapping created', async () => {
    const r = await avatar(tA)
    assert.equal(r.status, 200)
    const mapped = rows(`SELECT member_id FROM member_identities WHERE provider='supabase' AND subject='${USER_A}'`)
    assert.equal(mapped.length, 1)
    memberA = mapped[0].member_id
    assert.notEqual(memberA, demo.memberId)
    assert.equal(rows('SELECT COUNT(*) n FROM members')[0].n, 2)
  })
  await check('16. browser-facing response holds only provider, sessionToken, expiresInSeconds', async () => {
    const r = await avatar(tB)
    assert.equal(r.status, 200)
    assert.deepEqual(Object.keys(r.body).sort(), ['expiresInSeconds', 'iceServers', 'provider', 'sessionToken'])
    for (const secret of [SERVICE_KEY, SIMLI_KEY, demo.credential, USER_B, tB]) assert.ok(!r.text.includes(secret))
  })
  await check('13/14/15. Simli request: maxIdleTime 300, maxSessionLength 900, fields unchanged', async () => {
    const calls = records('simli')
    assert.equal(calls.length, 2)
    for (const { body } of calls) {
      assert.equal(body.maxIdleTime, 300)
      assert.equal(body.maxSessionLength, 900)
      assert.equal(body.apiVersion, 'v2')
      assert.deepEqual(Object.keys(body).sort(), ['apiVersion', 'faceId', 'maxIdleTime', 'maxSessionLength'])
    }
  })
  await check('Supabase calls use the service key and query only the verified user', async () => {
    const sb = records('supabase')
    assert.ok(sb.length >= 4)
    assert.ok(sb.every(r => r.serviceKeyOk))
    assert.ok(sb.filter(r => r.path === 'memberships').every(r => r.serviceBearer))
  })

  let wsA
  await check('9. WebSocket with Supabase proof opens as member A (same member as avatar-session)', async () => {
    const r = await connect('persona=aline', ['persona.v1', tA2])
    assert.ok(r.ws, 'closed ' + r.closed)
    assert.equal(r.protocol, 'persona.v1')
    wsA = r.ws
    const created = await control(wsA, 'create', { memory: { content: 'Synthetic A record for isolation', scope: 'all' } })
    assert.equal(created.type, 'memory_result')
    const owner = rows(`SELECT member_id FROM memories WHERE id='${created.result.id}'`)
    assert.deepEqual(owner, [{ member_id: memberA }])
    assert.equal(rows(`SELECT COUNT(*) n FROM member_identities WHERE subject='${USER_A}'`)[0].n, 1)
  })
  await check('6. repeat: avatar-session for A hits the same per-member rate limit (same member)', async () => {
    const r = await avatar(tA2)
    assert.equal(r.status, 429)
  })
  await check('10. member B over WebSocket cannot see or touch A state', async () => {
    const r = await connect('persona=aline', ['persona.v1', tB])
    assert.ok(r.ws)
    const list = await control(r.ws, 'list')
    assert.deepEqual(list.result, [])
    const aRecord = rows(`SELECT id FROM memories WHERE member_id='${memberA}'`)[0].id
    const denied = await control(r.ws, 'inspect', { id: aRecord })
    assert.equal(denied.code, 'not_found')
    await close(r.ws)
  })
  await check('6b. A reconnects in a new socket and sees its own record', async () => {
    await close(wsA)
    const r = await connect('persona=chase', ['persona.v1', tA])
    assert.ok(r.ws)
    const list = await control(r.ws, 'list')
    assert.equal(list.result.length, 1)
    await close(r.ws)
  })
  await check('4. inactive member: avatar 403 membership_required, WebSocket 1008, nothing enrolled', async () => {
    const r = await avatar(tI)
    assert.equal(r.status, 403)
    assert.deepEqual(r.body, { error: 'membership_required' })
    assert.equal(await closeCode('persona=aline', ['persona.v1', tI]), 1008)
    assert.equal(rows(`SELECT COUNT(*) n FROM member_identities WHERE subject='${USER_INACTIVE}'`)[0].n, 0)
  })
  await check('2. invalid Supabase token: avatar 401, WebSocket 1008', async () => {
    assert.equal((await avatar(tBad)).status, 401)
    assert.equal(await closeCode('persona=aline', ['persona.v1', tBad]), 1008)
  })
  await check('11. failed Supabase proof never falls back to the demo bridge member', async () => {
    const before = rows('SELECT COUNT(*) n FROM members')[0].n
    assert.equal(await closeCode(`persona=aline&bridge=${BRIDGE}`, ['persona.v1', tBad]), 1008)
    assert.equal(await closeCode(`persona=aline&bridge=${BRIDGE}`, ['persona.v1']), 1008)
    assert.equal(rows('SELECT COUNT(*) n FROM members')[0].n, before)
  })
  await check('invalid confidante with a valid proof closes 1008', async () => {
    assert.equal(await closeCode('persona=nobody', ['persona.v1', tA]), 1008)
  })
  await check('Supabase outage: avatar 503 identity_unavailable, WebSocket 1013 (fail closed)', async () => {
    fixture.down = true; writeFixture()
    const r = await avatar(tB)
    assert.equal(r.status, 503)
    assert.deepEqual(r.body, { error: 'identity_unavailable' })
    assert.equal(await closeCode('persona=aline', ['persona.v1', tB]), 1013)
    fixture.down = false; writeFixture()
  })
  await check('demo bridge without a Supabase proof still reaches only the demo member (unchanged path)', async () => {
    const r = await connect(`persona=aline&bridge=${BRIDGE}`)
    assert.ok(r.ws)
    const created = await control(r.ws, 'create', { memory: { content: 'Synthetic demo record', scope: 'all' } })
    assert.deepEqual(rows(`SELECT member_id FROM memories WHERE id='${created.result.id}'`), [{ member_id: demo.memberId }])
    await close(r.ws)
  })
  await check('server stayed up: /health 200', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/health`)
    assert.equal(r.status, 200)
    assert.equal(child.exitCode, null)
  })
  await check('17/18/19. server output: no Supabase token, service key, Simli token/key, or provider body', async () => {
    for (const secret of [tA, tA2, tB, tI, tBad, SERVICE_KEY, SIMLI_TOKEN, SIMLI_KEY, demo.credential, 'raw-supabase-outage-detail', 'raw-supabase-jwt-detail']) {
      assert.ok(!output.includes(secret), 'leaked ' + secret.slice(0, 12))
    }
    assert.ok(output.includes('[identity] {"component":"member-identity","failure":"supabase_unavailable","status":503}'))
  })

  child.kill('SIGTERM')
  await new Promise(r => child.once('exit', r))
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.log('FAIL harness ' + e.message); if (child) child.kill('SIGKILL'); process.exit(1) })
