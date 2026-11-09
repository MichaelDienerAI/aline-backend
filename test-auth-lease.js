'use strict'
// Authorization lease on Supabase WebSockets, inside the real server.js: the
// grant ends at the proof's verified exp (close 4401), no frame is served
// after the deadline, renewal resumes the same member, revocation blocks
// re-entry, expiry never falls back to the demo member, every lease timer is
// cleared or fired, and legacy paths carry no lease. Supabase and Simli are
// in-process doubles; lease timers are observed by test-support/lease-timer-probe.cjs;
// model, speech-to-text and TTS are test-support/lease-turn-providers.cjs.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')
const WebSocket = require('ws')
const { openMemoryStore } = require('./services/member-memory')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-lease-'))
const dbPath = path.join(dir, 'members.sqlite')
const capture = path.join(dir, 'capture.jsonl')
const leaseCapture = path.join(dir, 'leases.jsonl')
const fixtureFile = path.join(dir, 'fixture.json')
const SERVICE_KEY = 'synthetic-service-role-key-lease-NEVER-LOGGED-0123456789'
const SIMLI_KEY = 'synthetic-simli-key-lease-0123456789'
const SIMLI_TOKEN = 'synthetic-lease-session-token-NEVER-LOGGED-0123456789'
const BRIDGE = 'synthetic-bridge-token-lease-0123456789abcdef'
const ORIGIN = 'https://personaio.app'
const USER_X = '55555555-5555-4555-8555-555555555555'
const USER_Y = '66666666-6666-4666-8666-666666666666'
const USER_H = '77777777-7777-4777-8777-777777777777'
const USER_T = '88888888-8888-4888-8888-888888888888'
const port = 6900 + (process.pid % 500)

const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url')
let serial = 0
const fixture = { users: {}, memberships: { [USER_X]: 'active', [USER_Y]: 'active', [USER_H]: 'active', [USER_T]: 'active' }, down: false }
const writeFixture = () => fs.writeFileSync(fixtureFile, JSON.stringify(fixture))
const issued = []
// exp is whole seconds; a lease of `s` seconds lands s..s+1 seconds from now.
function token(sub, s) {
  const exp = Math.ceil(Date.now() / 1000) + s
  const t = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp })}.sig${++serial}synthetic`
  fixture.users[t] = sub
  writeFixture()
  issued.push(t)
  return { t, expMs: exp * 1000 }
}

const store = openMemoryStore(dbPath)
const demo = store.enroll()
const legacy = store.enroll()
store.close()
fs.writeFileSync(capture, '')
fs.writeFileSync(leaseCapture, '')
writeFixture()

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
const supabaseCalls = () => fs.readFileSync(capture, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(r => r.type === 'supabase').length
const turnEvents = type => leaseEvents().filter(e => e.type === type)
const leaseEvents = () => fs.readFileSync(leaseCapture, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
const mapped = sub => rows(`SELECT member_id FROM member_identities WHERE provider='supabase' AND subject='${sub}'`)
const demoMemories = () => count(`SELECT COUNT(*) n FROM memories WHERE member_id='${demo.memberId}'`)

async function start() {
  const env = {
    PATH: process.env.PATH, NODE_OPTIONS: '', PORT: String(port), MODEL_NAME: 'synthetic-local',
    ANTHROPIC_API_KEY: 'synthetic', DEEPGRAM_API_KEY: 'synthetic', ELEVENLABS_API_KEY: 'synthetic',
    SIMLI_API_KEY: SIMLI_KEY, AVATAR_TEST_TOKEN: SIMLI_TOKEN, PERSONA_V4_DB: dbPath,
    SUPABASE_URL: 'https://synthetic-supabase.test', SUPABASE_SERVICE_KEY: SERVICE_KEY,
    PERSONA_DEMO_BRIDGE_TOKEN: BRIDGE, PERSONA_DEMO_MEMBER_CREDENTIAL: demo.credential,
    IDENTITY_TEST_CAPTURE: capture, IDENTITY_TEST_FIXTURE: fixtureFile, LEASE_TEST_CAPTURE: leaseCapture,
  }
  child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-support/v4-identity-providers.cjs'),
    '--require', path.join(__dirname, 'test-support/lease-turn-providers.cjs'),
    '--require', path.join(__dirname, 'test-support/lease-timer-probe.cjs'), 'server.js'],
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

// Resolves once open (or closed during admission). Records close code and time.
function connect(query, protocols, options) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?${query}`, protocols, options)
  ws.events = []
  // Bounded: a socket that never closes yields {code: null} instead of hanging.
  const closing = new Promise(resolve => ws.on('close', code => resolve({ code, at: Date.now() })))
  Object.defineProperty(ws, 'closed', { get: () => Promise.race([closing, pause(5000).then(() => ({ code: null, at: null }))]) })
  ws.on('message', (data, isBinary) => { if (!isBinary) ws.events.push(JSON.parse(data.toString())) })
  ws.on('error', () => {})
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('timeout')), 4000)
    ws.once('open', () => { clearTimeout(timer); resolve(ws) })
    closing.then(() => { clearTimeout(timer); resolve(ws) })
  })
}
function send(ws, action, props = {}) {
  const requestId = 'q' + (++serial)
  ws.send(JSON.stringify({ type: 'memory', requestId, action, ...props }))
  return requestId
}
async function control(ws, action, props = {}) {
  const requestId = send(ws, action, props)
  for (let i = 0; i < 200; i++) {
    const found = ws.events.find(e => e.requestId === requestId)
    if (found) return found
    await pause(10)
  }
  throw Error('no memory response')
}
const until = ms => pause(Math.max(0, ms - Date.now()))
const withinMs = (actual, expected, bound) => assert.ok(Math.abs(actual - expected) <= bound, `delta ${actual - expected} ms`)

;(async () => {
  await start()

  // ── Expiry, isolation, cleanup and legacy paths share one ~3 s window ──
  const x1 = token(USER_X, 2)
  const s1 = await connect('persona=aline', ['persona.v1', x1.t])
  const memberX = mapped(USER_X)[0]?.member_id
  const x2 = token(USER_X, 4)
  const s2 = await connect('persona=chase', ['persona.v1', x2.t])
  const y = token(USER_Y, 4)
  const s3 = await connect('persona=aline', ['persona.v1', y.t])
  const memberY = mapped(USER_Y)[0]?.member_id
  const normal = await connect('persona=aline', ['persona.v1', token(USER_Y, 2).t])
  const abrupt = await connect('persona=aline', ['persona.v1', token(USER_Y, 2).t])
  const broken = await connect('persona=aline', ['persona.v1', token(USER_Y, 2).t])
  const bridged = await connect(`persona=aline&bridge=${BRIDGE}`, ['persona.v1', token(USER_Y, 2).t])
  const legacySock = await connect('persona=aline', undefined, { headers: { Authorization: 'Bearer ' + legacy.credential } })
  const bridgeSock = await connect(`persona=aline&bridge=${BRIDGE}`)
  const demoBefore = demoMemories()
  const supabaseAtAdmission = supabaseCalls()
  let recordX

  await check('a. lease sockets open with persona.v1; one lease armed per Supabase socket only', async () => {
    for (const ws of [s1, s2, s3, normal, abrupt, broken, bridged]) assert.equal(ws.readyState, WebSocket.OPEN)
    assert.equal(s1.protocol, 'persona.v1')
    assert.equal(leaseEvents().filter(e => e.event === 'arm').length, 7)
  })
  await check('b. message clearly before expiry is served', async () => {
    const created = await control(s1, 'create', { memory: { content: 'Synthetic lease record', scope: 'all' } })
    assert.equal(created.type, 'memory_result')
    recordX = created.result.id
    assert.deepEqual(rows(`SELECT member_id FROM memories WHERE id='${recordX}'`), [{ member_id: memberX }])
  })
  await check('6. normal client close clears its lease timer', async () => {
    const armed = leaseEvents().filter(e => e.event === 'arm').map(e => e.lease)
    normal.close()
    await normal.closed
    await pause(100)
    assert.equal(leaseEvents().filter(e => e.event === 'clear').length, 1)
    assert.ok(armed.length === 7)
  })
  await check('7. abnormal close (client socket destroyed) clears its lease timer', async () => {
    abrupt.terminate()
    await pause(150)
    assert.equal(leaseEvents().filter(e => e.event === 'clear').length, 2)
  })
  await check('7b. server-side protocol-error close clears its lease timer', async () => {
    broken._socket.write(Buffer.from([0x83, 0x80, 0, 0, 0, 0])) // reserved opcode 0x3, masked, empty
    const { code } = await broken.closed
    assert.equal(code, 1002)
    await pause(150)
    assert.equal(leaseEvents().filter(e => e.event === 'clear').length, 3)
  })

  await until(x1.expMs + 400)
  await check('1. Supabase socket closes 4401 at verified expiry', async () => {
    const { code, at } = await s1.closed
    assert.equal(code, 4401)
    withinMs(at, x1.expMs, 250)
  })
  await check('9. same member, second socket: independent lease, still open and served', async () => {
    assert.equal(s2.readyState, WebSocket.OPEN)
    const list = await control(s2, 'list')
    assert.deepEqual(list.result.map(r => r.id), [recordX])
  })
  await check('9b. different member: independent lease, still open and isolated', async () => {
    assert.equal(s3.readyState, WebSocket.OPEN)
    assert.deepEqual((await control(s3, 'list')).result, [])
  })
  await check('5. expiry with a bridge parameter present never becomes the demo member', async () => {
    assert.equal((await bridged.closed).code, 4401)
    assert.equal(demoMemories(), demoBefore)
  })
  await check('10. member-credential socket carries no lease and stays open past expiry; retired bridge socket was rejected', async () => {
    assert.equal(legacySock.readyState, WebSocket.OPEN)
    assert.equal((await control(legacySock, 'list')).type, 'memory_result')
    assert.equal((await bridgeSock.closed).code, 1008)
    legacySock.close()
    await legacySock.closed
    assert.equal(leaseEvents().filter(e => e.event === 'arm').length, 7)
  })
  await until(x2.expMs + 400)
  await check('9c. later leases close at their own expiry', async () => {
    const a = await s2.closed
    const b = await s3.closed
    assert.equal(a.code, 4401); withinMs(a.at, x2.expMs, 250)
    assert.equal(b.code, 4401); withinMs(b.at, y.expMs, 250)
  })
  await check('D. lease expiry makes zero Supabase requests; admission made two per socket', async () => {
    assert.equal(supabaseCalls(), supabaseAtAdmission)
    assert.equal(supabaseAtAdmission, 2 * 7)
  })
  await check('8. every lease timer ended exactly once: fired or cleared, never both, none leaked', async () => {
    const ev = leaseEvents()
    const armed = ev.filter(e => e.event === 'arm').map(e => e.lease)
    for (const lease of armed) {
      const ends = ev.filter(e => e.lease === lease && e.event !== 'arm')
      assert.equal(ends.length, 1, `lease ${lease}: ${ends.map(e => e.event)}`)
    }
    assert.equal(ev.filter(e => e.event === 'fire').length, 4)
  })

  // ── Deadline beats the timer: a frame processed after exp is never served ──
  await check('2. frame queued before expiry but processed after it is not served (server stalled across exp)', async () => {
    const z = token(USER_H, 2)
    const ws = await connect('persona=aline', ['persona.v1', z.t])
    const memberH = mapped(USER_H)[0].member_id
    const before = count(`SELECT COUNT(*) n FROM memories WHERE member_id='${memberH}'`)
    await until(z.expMs - 600)
    child.kill('SIGSTOP')
    const late = send(ws, 'create', { memory: { content: 'Synthetic post-expiry write', scope: 'all' } })
    const lateList = send(ws, 'list')
    await until(z.expMs + 300)
    child.kill('SIGCONT')
    const { code } = await ws.closed
    assert.equal(code, 4401)
    assert.ok(!ws.events.some(e => e.requestId === late || e.requestId === lateList), 'post-expiry frame answered')
    assert.equal(count(`SELECT COUNT(*) n FROM memories WHERE member_id='${memberH}'`), before, 'post-expiry write executed')
  })
  await check('2b. a proof already expired at upgrade is rejected 1008, no lease armed', async () => {
    const armed = leaseEvents().filter(e => e.event === 'arm').length
    const exp = Math.floor(Date.now() / 1000) - 1
    const t = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_X, exp })}.sig${++serial}synthetic`
    fixture.users[t] = USER_X; writeFixture(); issued.push(t)
    const ws = await connect('persona=aline', ['persona.v1', t])
    assert.equal((await ws.closed).code, 1008)
    assert.equal(leaseEvents().filter(e => e.event === 'arm').length, armed)
  })

  // ── TERMINATE: in-flight work ends with the grant ──
  await check('E. in-flight reply at expiry: model aborted once at exp, no TTS, no output, no memory write, 4401', async () => {
    const z = token(USER_T, 2)
    const ws = await connect('persona=aline', ['persona.v1', z.t])
    const memberT = mapped(USER_T)[0].member_id
    const memories = count(`SELECT COUNT(*) n FROM memories WHERE member_id='${memberT}'`)
    await until(z.expMs - 1000)
    ws.send(JSON.stringify({ type: 'message', content: 'Synthetic hold-across-expiry turn' }))
    for (let i = 0; i < 100 && !turnEvents('model_start').length; i++) await pause(10)
    assert.equal(turnEvents('model_start').length, 1, 'reply did not start before expiry')
    const seen = ws.events.length
    let binary = 0
    ws.on('message', (d, isBinary) => { if (isBinary) binary++ })
    ws._socket.pause() // never acknowledge the close: the server must not wait for us
    await until(z.expMs + 2500)
    const aborts = turnEvents('model_abort')
    assert.equal(aborts.length, 1, `model aborts: ${aborts.length}`)
    withinMs(aborts[0].at, z.expMs, 250)
    assert.equal(turnEvents('tts').length, 0, 'TTS started')
    ws._socket.resume()
    const { code } = await ws.closed
    assert.equal(code, 4401)
    assert.deepEqual(ws.events.slice(seen).filter(e => e.type !== 'status'), [], 'content after expiry')
    assert.equal(binary, 0, 'audio after expiry')
    assert.equal(count(`SELECT COUNT(*) n FROM memories WHERE member_id='${memberT}'`), memories)
    assert.deepEqual(mapped(USER_T), [{ member_id: memberT }])
  })
  await check('F. reply text ready after the deadline but before the timer fires is never sent (server stalled)', async () => {
    const z = token(USER_T, 2)
    const ws = await connect('persona=aline', ['persona.v1', z.t])
    const tts = turnEvents('tts').length
    await until(z.expMs - 1000)
    ws.send(JSON.stringify({ type: 'message', content: `Synthetic hold-until-${z.expMs - 150} turn` }))
    for (let i = 0; i < 100 && !ws.events.some(e => e.type === 'status' && e.message === 'thinking'); i++) await pause(10)
    const seen = ws.events.length
    let binary = 0
    ws.on('message', (d, isBinary) => { if (isBinary) binary++ })
    await until(z.expMs - 400)
    child.kill('SIGSTOP') // the reply (exp-150) and the lease timer (exp) both come due while stalled
    await until(z.expMs + 300)
    child.kill('SIGCONT')
    assert.equal((await ws.closed).code, 4401)
    assert.deepEqual(ws.events.slice(seen).filter(e => e.type !== 'status'), [], 'content after expiry')
    assert.equal(binary, 0, 'audio after expiry')
    assert.equal(turnEvents('tts').length, tts, 'TTS started after expiry')
  })
  await check('G. a transcript ready after the deadline but before the timer fires is never sent (server stalled)', async () => {
    const z = token(USER_T, 2)
    const ws = await connect('persona=aline', ['persona.v1', z.t])
    ws.send(JSON.stringify({ type: 'start' }))
    const due = Buffer.alloc(16); due.writeDoubleLE(z.expMs + 60000, 0); due.writeDoubleLE(z.expMs - 150, 8)
    ws.send(due)
    await until(z.expMs - 400)
    assert.ok(!ws.events.some(e => e.type === 'transcript'), 'transcript sent before the stall')
    child.kill('SIGSTOP') // the transcript (exp-150) and the lease timer (exp) both come due while stalled
    await until(z.expMs + 300)
    child.kill('SIGCONT')
    assert.equal((await ws.closed).code, 4401)
    assert.ok(!ws.events.some(e => e.type === 'transcript'), 'transcript sent after expiry')
  })
  await check('A. a reply cannot begin after the deadline even when its utterance was queued before it', async () => {
    const z = token(USER_T, 2)
    const ws = await connect('persona=aline', ['persona.v1', z.t])
    const starts = turnEvents('model_start').length
    ws.send(JSON.stringify({ type: 'start' }))
    const due = Buffer.alloc(8); due.writeDoubleLE(z.expMs - 150)
    ws.send(due)
    for (let i = 0; i < 100 && !ws.events.some(e => e.type === 'transcript'); i++) await pause(10)
    assert.ok(ws.events.some(e => e.type === 'transcript'), 'utterance not queued before expiry')
    await until(z.expMs - 400)
    child.kill('SIGSTOP') // utterance end (exp-150) and the lease timer (exp) both come due while stalled
    await until(z.expMs + 300)
    child.kill('SIGCONT')
    assert.equal((await ws.closed).code, 4401)
    await pause(100)
    assert.ok(turnEvents('utterance_end').length >= 1, 'utterance end never fired')
    assert.equal(turnEvents('model_start').length, starts, 'reply began after the deadline')
  })
  await check('B. proof expires during the Supabase round trip: 4401, no member session, no lease, nothing served', async () => {
    const armed = leaseEvents().filter(e => e.event === 'arm').length
    const z = token(USER_T, 1)
    fixture.userDelayMs = z.expMs - Date.now() + 300; writeFixture()
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?persona=aline`, ['persona.v1', z.t])
    const answers = []
    ws.on('message', d => answers.push(d))
    ws.on('open', () => ws.send(JSON.stringify({ type: 'memory', requestId: 'late', action: 'list' })))
    ws.on('error', () => {})
    const code = await new Promise(r => ws.on('close', r))
    delete fixture.userDelayMs; writeFixture()
    assert.equal(code, 4401)
    assert.equal(leaseEvents().filter(e => e.event === 'arm').length, armed, 'member session opened and lease armed')
    assert.equal(answers.length, 0)
  })
  await check('C. exp beyond 2^31-1 ms: timer capped, socket does not expire at once, still served', async () => {
    const exp = Math.ceil(Date.now() / 1000) + 40 * 24 * 3600
    const t = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_T, exp })}.sig${++serial}synthetic`
    fixture.users[t] = USER_T; writeFixture(); issued.push(t)
    const ws = await connect('persona=aline', ['persona.v1', t])
    const arm = leaseEvents().filter(e => e.event === 'arm').at(-1)
    assert.equal(arm.ms <= 2 ** 31 - 1 && arm.ms > 2 ** 31 - 1 - 1000, true, `armed ${arm.ms} ms`)
    await pause(500)
    assert.equal(ws.readyState, WebSocket.OPEN)
    assert.equal((await control(ws, 'list')).type, 'memory_result')
    ws.close(); await ws.closed
  })

  // ── Renewal and revocation ──
  await check('3. fresh token, same subject, after expiry: same member, no duplicate, state kept, new lease', async () => {
    const members = count('SELECT COUNT(*) n FROM members')
    const armed = leaseEvents().filter(e => e.event === 'arm').length
    const ws = await connect('persona=aline', ['persona.v1', token(USER_X, 60).t])
    assert.equal(ws.readyState, WebSocket.OPEN)
    assert.deepEqual(mapped(USER_X), [{ member_id: memberX }])
    assert.equal(count('SELECT COUNT(*) n FROM members'), members)
    assert.deepEqual((await control(ws, 'list')).result.map(r => r.id), [recordX])
    assert.equal(leaseEvents().filter(e => e.event === 'arm').length, armed + 1)
    ws.close(); await ws.closed
  })
  await check('4. revoked membership: valid fresh token rejected 1008 and avatar 403; member intact; no demo', async () => {
    fixture.memberships[USER_X] = 'canceled'
    const t = token(USER_X, 60).t
    const ws = await connect('persona=aline', ['persona.v1', t])
    assert.equal((await ws.closed).code, 1008)
    const r = await fetch(`http://127.0.0.1:${port}/v4/avatar-session`, { method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ persona: 'aline' }) })
    assert.equal(r.status, 403)
    assert.deepEqual(await r.json(), { error: 'membership_required' })
    assert.deepEqual(mapped(USER_X), [{ member_id: memberX }])
    assert.deepEqual(rows(`SELECT id FROM memories WHERE member_id='${memberX}'`), [{ id: recordX }])
    assert.equal(demoMemories(), demoBefore)
    fixture.memberships[USER_X] = 'active'; writeFixture()
  })
  await check('11. avatar-session auth unchanged: Supabase 200, expired 401, member credential 200', async () => {
    const post = bearer => fetch(`http://127.0.0.1:${port}/v4/avatar-session`, { method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: 'Bearer ' + bearer }, body: JSON.stringify({ persona: 'aline' }) })
    assert.equal((await post(token(USER_Y, 60).t)).status, 200)
    const exp = Math.floor(Date.now() / 1000) - 1
    assert.equal((await post(`${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_Y, exp })}.sigexpiredsynthetic`)).status, 401)
    assert.equal((await post(legacy.credential)).status, 200)
  })
  await check('server stayed up: /health 200', async () => {
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200)
    assert.equal(child.exitCode, null)
  })
  await check('12. server output: no Supabase token, service key, Simli key/token or member credential', async () => {
    for (const secret of [...issued, SERVICE_KEY, SIMLI_KEY, SIMLI_TOKEN, demo.credential, legacy.credential, BRIDGE]) {
      assert.ok(!output.includes(secret), 'leaked ' + secret.slice(0, 12))
    }
  })

  child.kill('SIGTERM')
  await new Promise(r => child.once('exit', r))
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.log('FAIL harness ' + e.message); if (child) { child.kill('SIGCONT'); child.kill('SIGKILL') } process.exit(1) })
