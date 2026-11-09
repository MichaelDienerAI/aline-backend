'use strict'
// v4 avatar-session route inside the real server.js process: route placement,
// CORS precedence over the global wildcard, legacy guard, WS auth, log hygiene.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const WebSocket = require('ws')
const { openMemoryStore } = require('./services/member-memory')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-v4-avatar-'))
const dbPath = path.join(dir, 'members.sqlite')
const capture = path.join(dir, 'capture.jsonl')
const modeFile = path.join(dir, 'mode')
const KEY = 'synthetic-simli-key-runtime-0123456789'
const TOKEN = 'synthetic-runtime-session-token-NEVER-LOGGED-0123456789'
const ORIGIN = 'https://personaio.app'
const FACE = { aline: '003760f2-027b-4259-93ef-fbd8cf3ceac3', chase: 'cdd8c2c3-6536-45c6-9e99-83879888593f' }
const port = 5300 + (process.pid % 500)

const store = openMemoryStore(dbPath)
const alineMember = store.enroll()
const chaseMember = store.enroll()
const failureMember = store.enroll()
store.close()
fs.writeFileSync(capture, '')

const pause = ms => new Promise(r => setTimeout(r, ms))
let passed = 0
let failed = 0
let child
let output = ''
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name) } catch (e) { failed++; console.log('FAIL ' + name + ' ' + e.message) }
}
const simliCalls = () => fs.readFileSync(capture, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(r => r.type === 'simli')

async function start(v4) {
  output = ''
  const env = {
    PATH: process.env.PATH, NODE_OPTIONS: '', PORT: String(port), MODEL_NAME: 'synthetic-local',
    ANTHROPIC_API_KEY: 'synthetic', DEEPGRAM_API_KEY: 'synthetic', ELEVENLABS_API_KEY: 'synthetic',
    SIMLI_API_KEY: KEY, AVATAR_TEST_TOKEN: TOKEN, AVATAR_TEST_CAPTURE: capture, AVATAR_TEST_MODE_FILE: modeFile,
    ...(v4 ? { PERSONA_V4_DB: dbPath } : {}),
  }
  child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-support/v4-avatar-providers.cjs'), 'server.js'],
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
async function stop() {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise(r => child.once('exit', r))
}

async function post(body, { auth, origin = ORIGIN, pathname = '/v4/avatar-session' } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (origin) headers.Origin = origin
  if (auth) headers.Authorization = auth
  const r = await fetch(`http://127.0.0.1:${port}${pathname}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: r.status, headers: r.headers, text, json }
}

async function wsRejected(url) {
  const ws = new WebSocket(url)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('timeout')), 3000)
    ws.on('close', code => { clearTimeout(timer); resolve(code) })
    ws.on('error', () => {})
  })
}

async function main() {
  await start(true)

  await check('/health unchanged', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/health`)
    assert.equal(r.status, 200)
    assert.equal((await r.json()).status, 'ok')
  })
  await check('no Authorization -> 401 through real server, no provider call', async () => {
    const r = await post({ persona: 'aline' })
    assert.equal(r.status, 401)
    assert.equal(simliCalls().length, 0)
  })
  await check('Aline member -> 200 with Aline faceId and exact-origin CORS (not wildcard)', async () => {
    const r = await post({ persona: 'aline' }, { auth: 'Bearer ' + alineMember.credential })
    assert.equal(r.status, 200)
    assert.equal(r.json.sessionToken, TOKEN)
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN)
    const c = simliCalls().at(-1)
    assert.equal(c.faceId, FACE.aline)
    assert.equal(c.keyHeaderMatches, true)
    assert.deepEqual(c.keys, ['apiVersion', 'faceId', 'maxIdleTime', 'maxSessionLength'])
  })
  await check('Chase member -> 200 with Chase faceId', async () => {
    const r = await post({ persona: 'chase' }, { auth: 'Bearer ' + chaseMember.credential })
    assert.equal(r.status, 200)
    assert.equal(simliCalls().at(-1).faceId, FACE.chase)
  })
  await check('disallowed Origin -> 403 and no wildcard CORS leaks from global handler', async () => {
    const before = simliCalls().length
    const r = await post({ persona: 'aline' }, { auth: 'Bearer ' + alineMember.credential, origin: 'https://evil.example' })
    assert.equal(r.status, 403)
    assert.equal(r.headers.get('access-control-allow-origin'), null)
    assert.equal(simliCalls().length, before)
  })
  await check('allowed-origin preflight answered by the endpoint, not the global OPTIONS handler', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/v4/avatar-session`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } })
    assert.equal(r.status, 204)
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN)
    assert.match(r.headers.get('access-control-allow-headers') || '', /Authorization/i)
  })
  await check('provider 401 -> bounded 502 through real server', async () => {
    fs.writeFileSync(modeFile, '401')
    await pause(10)
    const r = await post({ persona: 'aline' }, { auth: 'Bearer ' + failureMember.credential })
    fs.writeFileSync(modeFile, 'ok')
    assert.equal(r.status, 502)
    assert.deepEqual(r.json, { error: 'avatar_unavailable' })
    assert.ok(!r.text.includes('provider-detail'))
  })
  await check('legacy /simli-session still 404 under v4, no provider call', async () => {
    const before = simliCalls().length
    const r = await fetch(`http://127.0.0.1:${port}/simli-session?persona=aline`)
    assert.equal(r.status, 404)
    assert.equal(simliCalls().length, before)
  })
  await check('WebSocket member authentication unchanged: no credential -> 1008', async () => {
    assert.equal(await wsRejected(`ws://127.0.0.1:${port}/?persona=aline`), 1008)
  })
  await check('server output never contains API key, session token, or member credentials', async () => {
    await pause(50)
    for (const secret of [KEY, TOKEN, alineMember.credential, chaseMember.credential, failureMember.credential]) assert.ok(!output.includes(secret))
  })
  await stop()

  await start(false)
  await check('legacy (non-v4) mode: avatar route inactive, no provider call', async () => {
    const before = simliCalls().length
    const r = await post({ persona: 'aline' }, { auth: 'Bearer ' + alineMember.credential })
    assert.notEqual(r.status, 401)
    assert.ok(!r.text.includes(TOKEN))
    assert.equal(simliCalls().length, before)
  })
  await stop()

  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`\nAVATAR RUNTIME RESULTS: ${passed}/${passed + failed} passed`)
  process.exit(failed ? 1 : 0)
}

main().catch(async e => { console.log('FATAL ' + e.message); await stop(); process.exit(1) })
