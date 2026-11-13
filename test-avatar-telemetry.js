'use strict'
// Avatar lifecycle telemetry: a signed-in member's page reports avatar
// lifecycle metadata ({"type":"avatar_telemetry"} frames) on its existing,
// already-authenticated member WebSocket; the server writes one allowlisted
// "[avatar] {...}" line per accepted event and nothing else. No new endpoint,
// no new authentication path, no persistence. Every field is an enum, a
// bounded integer or the 12-hex ephemeral avatar session id; anything else in
// a frame (content, tokens, SDP, ICE credentials, unknown keys, out-of-enum
// strings) never reaches the output. Supabase and model are doubles.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const WebSocket = require('ws')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-avatar-telemetry-'))
const dbPath = path.join(dir, 'members.sqlite')
const capture = path.join(dir, 'capture.jsonl')
const fixtureFile = path.join(dir, 'fixture.json')
const USER = '56565656-5656-4565-8565-565656565656'
const port = 7100 + (process.pid % 500)

const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url')
let serial = 0
const token = sub => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig${++serial}synthetic`
const tGood = token(USER), tGood2 = token(USER), tGood3 = token(USER), tBad = token(USER)
fs.writeFileSync(fixtureFile, JSON.stringify({
  users: { [tGood]: USER, [tGood2]: USER, [tGood3]: USER }, memberships: { [USER]: 'active' }, down: false,
}))
fs.writeFileSync(capture, '')

// Sentinels that must never appear in server output, whatever field carries them.
const SENTINEL = {
  memberSpeech: 'SYNTHETIC-MEMBER-SPEECH-I-am-worried-about-tomorrow',
  confidanteSpeech: 'SYNTHETIC-CONFIDANTE-SPEECH-tell-me-more',
  transcript: 'SYNTHETIC-TRANSCRIPT-fragment-0123',
  prompt: 'SYNTHETIC-SYSTEM-PROMPT-you-are-aline',
  memory: 'SYNTHETIC-MEMORY-CONTENT-sister-name',
  sessionToken: 'synthetic-simli-session-token-NEVER-LOGGED-0123',
  accessToken: 'synthetic-supabase-access-token-NEVER-LOGGED-0123',
  sdp: 'v=0 o=- 4611731400430051336 2 IN IP4 127.0.0.1 a=ice-pwd:SYNTHETICPWD0123',
  iceCredential: 'synthetic-ice-credential-NEVER-LOGGED-4567',
  iceUser: 'synthetic-ice-username-NEVER-LOGGED-4567',
  candidate: 'candidate:842163049 1 udp 1677729535 203.0.113.7 3478 typ srflx',
  providerKey: 'synthetic-simli-key-telemetry-0123',
}

const pause = ms => new Promise(r => setTimeout(r, ms))
let passed = 0
let failed = 0
let child
let output = ''
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name) } catch (e) { failed++; console.log('FAIL ' + name + ' ' + e.message) }
}
const avatarLines = () => output.split('\n').filter(l => l.startsWith('[avatar] ')).map(l => JSON.parse(l.slice(9)))

async function start(overrides = {}) {
  const env = {
    PATH: process.env.PATH, NODE_OPTIONS: '', PORT: String(port), MODEL_NAME: 'synthetic-local',
    ANTHROPIC_API_KEY: 'synthetic', DEEPGRAM_API_KEY: 'synthetic', ELEVENLABS_API_KEY: 'synthetic',
    SIMLI_API_KEY: SENTINEL.providerKey, AVATAR_TEST_TOKEN: SENTINEL.sessionToken,
    PERSONA_V4_DB: dbPath, SUPABASE_URL: 'https://synthetic-supabase.test', SUPABASE_SERVICE_KEY: 'synthetic-service-key-telemetry-0123',
    IDENTITY_TEST_CAPTURE: capture, IDENTITY_TEST_FIXTURE: fixtureFile,
    ...overrides,
  }
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k]
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

function attempt(query, protocols) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?${query}`, protocols)
  ws.events = []
  ws.on('message', (d, bin) => { if (!bin) ws.events.push(JSON.parse(d.toString())) })
  ws.on('error', () => {})
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('timeout')), 4000)
    ws.on('open', () => { setTimeout(() => { clearTimeout(timer); if (ws.readyState === WebSocket.OPEN) resolve({ ws }) }, 300) })
    ws.on('close', code => { clearTimeout(timer); resolve({ code }) })
  })
}
const close = ws => new Promise(r => { ws.once('close', r); ws.close() })
// Telemetry is fire-and-forget; a ping/pong round trip orders it after the frames.
async function settle(ws) {
  const before = ws.events.filter(e => e.type === 'pong').length
  ws.send(JSON.stringify({ type: 'ping' }))
  for (let i = 0; i < 200; i++) { if (ws.events.filter(e => e.type === 'pong').length > before) return; await pause(10) }
  throw Error('no pong')
}
const SID = '0a1b2c3d4e5f'
const frame = (event, extra = {}) => JSON.stringify({ type: 'avatar_telemetry', sid: SID, mint: 1, t: 1234, event, ...extra })

;(async () => {
  await start()

  await check('1. member socket: lifecycle events become one allowlisted [avatar] line each', async () => {
    const r = await attempt('persona=aline', ['persona.v1', tGood])
    assert.ok(r.ws, 'rejected ' + r.code)
    r.ws.send(frame('avatar_mint_ok', { t: 0 }))
    r.ws.send(frame('avatar_pc_connected', { pc: 'connected', ice: 'connected', ws: 'open', audio: 'live', video: 'live' }))
    r.ws.send(frame('avatar_video_track_ended', { t: 16020, pc: 'connected', ice: 'connected', ws: 'open', audio: 'live', video: 'ended' }))
    r.ws.send(frame('avatar_signal_closed', { t: 16100, code: 1006, ws: 'closed' }))
    r.ws.send(frame('avatar_signal_event', { signal: 'STOP' }))
    r.ws.send(frame('avatar_client_error', { category: 'rate' }))
    r.ws.send(frame('avatar_mint_failed', { mint: 2, t: 0, category: 'rate_limited', status: 429 }))
    r.ws.send(frame('avatar_remint', { mint: 2, t: 0, reason: 'retry' }))
    await settle(r.ws)
    assert.deepEqual(avatarLines(), [
      { persona: 'aline', sid: SID, event: 'avatar_mint_ok', mint: 1, t: 0 },
      { persona: 'aline', sid: SID, event: 'avatar_pc_connected', mint: 1, t: 1234, pc: 'connected', ice: 'connected', ws: 'open', audio: 'live', video: 'live' },
      { persona: 'aline', sid: SID, event: 'avatar_video_track_ended', mint: 1, t: 16020, pc: 'connected', ice: 'connected', ws: 'open', audio: 'live', video: 'ended' },
      { persona: 'aline', sid: SID, event: 'avatar_signal_closed', mint: 1, t: 16100, code: 1006, ws: 'closed' },
      { persona: 'aline', sid: SID, event: 'avatar_signal_event', mint: 1, t: 1234, signal: 'STOP' },
      { persona: 'aline', sid: SID, event: 'avatar_client_error', mint: 1, t: 1234, category: 'rate' },
      { persona: 'aline', sid: SID, event: 'avatar_mint_failed', mint: 2, t: 0, category: 'rate_limited', status: 429 },
      { persona: 'aline', sid: SID, event: 'avatar_remint', mint: 2, t: 0, reason: 'retry' },
    ])
    // Fire-and-forget: no reply frame, no model turn, no memory.
    assert.deepEqual(r.ws.events.map(e => e.type).filter(t => t !== 'pong'), [])
    await close(r.ws)
  })

  await check('2. prohibited content, credentials, SDP and unknown keys never reach output', async () => {
    const r = await attempt('persona=aline', ['persona.v1', tGood2])
    assert.ok(r.ws)
    const lineCount = avatarLines().length
    // Valid event carrying every prohibited field alongside allowed ones.
    r.ws.send(JSON.stringify({
      type: 'avatar_telemetry', sid: SID, mint: 1, t: 5, event: 'avatar_snapshot', pc: 'connected',
      content: SENTINEL.memberSpeech, text: SENTINEL.confidanteSpeech, transcript: SENTINEL.transcript,
      prompt: SENTINEL.prompt, memory: SENTINEL.memory, sessionToken: SENTINEL.sessionToken,
      accessToken: SENTINEL.accessToken, authorization: 'Bearer ' + SENTINEL.accessToken, sdp: SENTINEL.sdp,
      iceServers: [{ urls: ['turn:x'], username: SENTINEL.iceUser, credential: SENTINEL.iceCredential }],
      candidate: SENTINEL.candidate, detail: SENTINEL.memberSpeech, persona: 'chase', member: 'member#x', apiKey: SENTINEL.providerKey,
    }))
    // Allowed keys stuffed with prohibited strings, wrong types and out-of-range numbers.
    r.ws.send(JSON.stringify({
      type: 'avatar_telemetry', sid: SID, mint: 1, t: 6, event: 'avatar_client_error',
      category: SENTINEL.memberSpeech, signal: SENTINEL.sdp, reason: SENTINEL.accessToken, pc: SENTINEL.candidate,
      ice: { state: SENTINEL.iceCredential }, ws: ['open'], audio: 'live ' + SENTINEL.transcript, video: 'LIVE',
      code: 1006.5, status: '429', mint2: 1,
    }))
    r.ws.send(frame('avatar_signal_closed', { code: 99999 }))
    r.ws.send(frame('avatar_mint_ok', { t: -1, mint: 1e9 }))
    // Rejected whole: unknown or content-bearing event names, bad sid, oversized/odd frames.
    r.ws.send(frame('avatar_' + SENTINEL.memberSpeech))
    r.ws.send(frame('response_text', { text: SENTINEL.confidanteSpeech }))
    r.ws.send(JSON.stringify({ type: 'avatar_telemetry', sid: SENTINEL.sessionToken, event: 'avatar_mint_ok' }))
    r.ws.send(JSON.stringify({ type: 'avatar_telemetry', sid: 'ABCDEF012345', event: 'avatar_mint_ok' }))
    r.ws.send(JSON.stringify({ type: 'avatar_telemetry', event: 'avatar_mint_ok' }))
    r.ws.send(JSON.stringify({ type: 'avatar_telemetry', sid: SID, event: ['avatar_mint_ok'] }))
    r.ws.send(JSON.stringify([{ type: 'avatar_telemetry', sid: SID, event: 'avatar_mint_ok' }]))
    r.ws.send(JSON.stringify({ type: 'avatar_telemetry', sid: SID, event: 'avatar_mint_ok', pad: 'x'.repeat(20000) + SENTINEL.memory }))
    await settle(r.ws)
    const fresh = avatarLines().slice(lineCount)
    assert.deepEqual(fresh, [
      { persona: 'aline', sid: SID, event: 'avatar_snapshot', mint: 1, t: 5, pc: 'connected' },
      { persona: 'aline', sid: SID, event: 'avatar_client_error', mint: 1, t: 6 },
      { persona: 'aline', sid: SID, event: 'avatar_signal_closed', mint: 1, t: 1234 },
      { persona: 'aline', sid: SID, event: 'avatar_mint_ok' },
      { persona: 'aline', sid: SID, event: 'avatar_mint_ok' },
    ])
    for (const [name, s] of Object.entries(SENTINEL)) assert.ok(!output.includes(s), 'leaked ' + name)
    assert.ok(!output.includes('member#'), 'member identifier in output')
    assert.deepEqual(r.ws.events.map(e => e.type).filter(t => t !== 'pong'), [])
    await close(r.ws)
  })

  await check('3. bounded: at most 300 events per connection, then one capped marker', async () => {
    const r = await attempt('persona=chase', ['persona.v1', tGood3])
    assert.ok(r.ws)
    const lineCount = avatarLines().length
    for (let i = 0; i < 320; i++) r.ws.send(frame('avatar_snapshot', { t: i }))
    await settle(r.ws)
    const fresh = avatarLines().slice(lineCount)
    assert.equal(fresh.filter(l => l.event === 'avatar_snapshot').length, 300)
    assert.deepEqual(fresh.filter(l => l.event !== 'avatar_snapshot'), [{ persona: 'chase', sid: SID, event: 'avatar_telemetry_capped' }])
    assert.ok(fresh.every(l => l.persona === 'chase'))
    await close(r.ws)
  })

  await check('4. no new authentication path: telemetry needs an authenticated member socket', async () => {
    const lineCount = avatarLines().length
    for (const [query, protocols] of [['persona=aline', undefined], ['persona=aline', ['persona.v1', tBad]],
      ['persona=aline&bridge=anything-0123456789abcdef0123', undefined], ['persona=aline&telemetry=1', undefined]]) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/?${query}`, protocols)
      ws.on('error', () => {})
      const code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('timeout')), 4000)
        // Send as soon as the upgrade completes, before the server's verdict.
        ws.on('open', () => { try { ws.send(frame('avatar_mint_ok')) } catch {} })
        ws.on('close', c => { clearTimeout(timer); resolve(c) })
      })
      assert.equal(code, 1008, query)
    }
    await pause(100)
    assert.equal(avatarLines().length, lineCount)
  })

  await check('5. server output: no Supabase token, provider key or session token', async () => {
    for (const s of [tGood, tGood2, tGood3, tBad, SENTINEL.providerKey, SENTINEL.sessionToken]) assert.ok(!output.includes(s), 'leaked ' + s.slice(0, 10))
  })

  child.kill('SIGTERM')
  await new Promise(r => child.once('exit', r))

  await check('6. without a member store (legacy configuration) no socket is a member: telemetry is dropped', async () => {
    output = ''
    await start({ PERSONA_V4_DB: undefined })
    try {
      const r = await attempt('persona=aline')
      if (r.ws) {
        r.ws.send(frame('avatar_mint_ok'))
        await settle(r.ws)
        await close(r.ws)
      }
      assert.deepEqual(avatarLines(), [])
    } finally {
      child.kill('SIGTERM')
      await new Promise(res => child.once('exit', res))
    }
  })

  await check('7. continuity events (rotation, recovery, idle hold, audio flush, frame stalls) pass with bounded numbers only', async () => {
    const { sanitizeAvatarTelemetry } = require('./services/avatar-telemetry')
    assert.deepEqual(sanitizeAvatarTelemetry({ sid: SID, event: 'avatar_recovery_done', mint: 3, t: 5, reason: 'recover', ms: 2400 }),
      { sid: SID, event: 'avatar_recovery_done', mint: 3, t: 5, ms: 2400, reason: 'recover' })
    assert.deepEqual(sanitizeAvatarTelemetry({ sid: SID, event: 'avatar_video_stall', frame_age: 1800, audio_age: 300 }),
      { sid: SID, event: 'avatar_video_stall', frame_age: 1800, audio_age: 300 })
    assert.deepEqual(sanitizeAvatarTelemetry({ sid: SID, event: 'avatar_audio_flush', bytes: 64000 }),
      { sid: SID, event: 'avatar_audio_flush', bytes: 64000 })
    for (const e of ['avatar_rotate_start', 'avatar_rotate_done', 'avatar_rotate_abandoned', 'avatar_recovery_start', 'avatar_idle_hold', 'avatar_video_resume'])
      assert.ok(sanitizeAvatarTelemetry({ sid: SID, event: e }), e)
    // Content in a numeric or enum field is dropped, never logged.
    assert.deepEqual(sanitizeAvatarTelemetry({ sid: SID, event: 'avatar_rotate_done', ms: SENTINEL.memberSpeech, bytes: -1, reason: SENTINEL.transcript }),
      { sid: SID, event: 'avatar_rotate_done' })
  })

  await check('8. continuity timing metadata (session age, planned rotation, standby ready, retry number, held audio) passes bounded', async () => {
    const { sanitizeAvatarTelemetry } = require('./services/avatar-telemetry')
    assert.deepEqual(sanitizeAvatarTelemetry({ sid: SID, event: 'avatar_rotate_scheduled', reason: 'rotate', due: 780000, age: 0 }),
      { sid: SID, event: 'avatar_rotate_scheduled', age: 0, due: 780000, reason: 'rotate' })
    assert.deepEqual(sanitizeAvatarTelemetry({ sid: SID, event: 'avatar_rotate_ready', reason: 'rotate', ms: 2500 }),
      { sid: SID, event: 'avatar_rotate_ready', ms: 2500, reason: 'rotate' })
    assert.deepEqual(sanitizeAvatarTelemetry({ sid: SID, event: 'avatar_audio_held', bytes: 64000, held_ms: 2000 }),
      { sid: SID, event: 'avatar_audio_held', bytes: 64000, held_ms: 2000 })
    assert.deepEqual(sanitizeAvatarTelemetry({ sid: SID, event: 'avatar_page_stop', reason: 'lost', age: 901000, attempt: 2 }),
      { sid: SID, event: 'avatar_page_stop', age: 901000, attempt: 2, reason: 'lost' })
    // Content in the new numeric fields is dropped, never logged.
    assert.deepEqual(sanitizeAvatarTelemetry({ sid: SID, event: 'avatar_audio_held', held_ms: SENTINEL.memberSpeech, age: SENTINEL.transcript, due: 'soon', attempt: '2' }),
      { sid: SID, event: 'avatar_audio_held' })
  })

  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.log('FAIL harness ' + e.message); if (child) child.kill('SIGKILL'); process.exit(1) })
