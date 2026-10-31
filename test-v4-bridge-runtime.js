'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const WebSocket = require('ws')
const { openMemoryStore } = require('./services/member-memory')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-v4-bridge-'))
const dbPath = path.join(dir, 'members.sqlite')
const capture = path.join(dir, 'capture.jsonl')
const bridge = 'synthetic-bridge-token'
const port = 4800 + (process.pid % 500)

const store = openMemoryStore(dbPath)
const member = store.enroll()
store.close()
fs.writeFileSync(capture, '')

const pause = ms => new Promise(r => setTimeout(r, ms))
const sockets = new Set()
let checks = 0
let serial = 0
let child

function check(name, fn) {
  fn()
  checks++
  console.log('PASS ' + name)
}

function readCapture() {
  const text = fs.readFileSync(capture, 'utf8').trim()
  return text ? text.split('\n').map(JSON.parse) : []
}

async function waitFor(fn) {
  for (let i = 0; i < 250; i++) {
    if (fn()) return
    await pause(20)
  }
  throw Error('timed out')
}

async function start() {
  const env = {
    PATH: process.env.PATH,
    NODE_OPTIONS: '',
    PORT: String(port),
    MODEL_NAME: 'synthetic-local',
    ANTHROPIC_API_KEY: 'synthetic',
    DEEPGRAM_API_KEY: 'synthetic',
    ELEVENLABS_API_KEY: 'synthetic',
    PERSONA_V4_DB: dbPath,
    PERSONA_DEMO_BRIDGE_TOKEN: bridge,
    PERSONA_DEMO_MEMBER_CREDENTIAL: member.credential,
    V4_TEST_CAPTURE: capture,
    ALINE_CADENCE_V1: '1',
  }

  child = spawn(
    process.execPath,
    ['--require', path.join(__dirname, 'test-support/v4-providers.cjs'), 'server.js'],
    { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] }
  )

  let ready = false
  let errors = ''

  child.stdout.on('data', d => {
    if (d.toString().includes('Backend v3.3.0 on port')) ready = true
  })

  child.stderr.on('data', d => { errors += d })

  await waitFor(() => {
    if (child.exitCode !== null) throw Error('server exited: ' + errors)
    return ready
  })
}

async function expectRejected(url, name) {
  const ws = new WebSocket(url)
  sockets.add(ws)

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(name + ': timeout')), 3000)

    ws.on('close', c => {
      clearTimeout(timer)
      resolve(c)
    })

    ws.on('error', () => {})
  })

  sockets.delete(ws)
  check(name, () => assert.equal(code, 1008))
}

async function connect(persona) {
  const ws = new WebSocket(
    `ws://127.0.0.1:${port}/?persona=${persona}&bridge=${bridge}`
  )

  sockets.add(ws)
  await once(ws, 'open')

  ws.events = []
  ws.on('message', (data, binary) => {
    if (!binary) ws.events.push(JSON.parse(String(data)))
  })

  return ws
}

async function ping(ws, name) {
  const start = ws.events.length
  ws.send(JSON.stringify({ type: 'ping' }))
  await waitFor(() => ws.events.slice(start).some(e => e.type === 'pong'))
  check(name, () => assert.ok(true))
}

async function control(ws, action, props = {}) {
  const requestId = String(++serial)
  ws.send(JSON.stringify({ type: 'memory', requestId, action, ...props }))

  await waitFor(() => ws.events.some(e => e.requestId === requestId))
  return ws.events.find(e => e.requestId === requestId)
}

async function create(ws, content, scope) {
  const result = await control(ws, 'create', {
    memory: { content, scope }
  })

  assert.equal(result.type, 'memory_result')
  return result.result
}

async function turn(ws, text) {
  const eventStart = ws.events.length
  const captureStart = readCapture().length

  ws.send(JSON.stringify({ type: 'message', content: text }))

  await waitFor(() =>
    ws.events.slice(eventStart).some(
      e => e.type === 'response_complete' || e.type === 'error'
    )
  )

  return readCapture().slice(captureStart)
}

function retainedIds(trace) {
  const model = trace.find(e => e.type === 'model')
  assert.ok(model, 'missing captured model request')

  const context = JSON.parse(model.config.messages[0].content)
  return [...context.institutional, ...context.relationship].map(m => m.id)
}

async function stop() {
  for (const ws of sockets) ws.terminate()
  sockets.clear()

  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await once(child, 'exit')
  }

  fs.rmSync(dir, { recursive: true, force: true })
}

;(async () => {
  try {
    await start()

    await expectRejected(
      `ws://127.0.0.1:${port}/?persona=aline`,
      'no auth rejected'
    )

    await expectRejected(
      `ws://127.0.0.1:${port}/?persona=aline&bridge=wrong`,
      'wrong bridge rejected'
    )

    const aline = await connect('aline')
    await ping(aline, 'correct bridge accepts Aline')

    const chase = await connect('chase')
    await ping(chase, 'same bridge accepts Chase')

    const shared = await create(
      aline,
      'Bridge regression shared fact',
      'all'
    )

    const privateAline = await create(
      aline,
      'Bridge regression Aline-private fact',
      'private'
    )

    const alineTrace = await turn(aline, 'Bridge qualification A')
    const chaseTrace = await turn(chase, 'Bridge qualification B')

    const alineIds = retainedIds(alineTrace)
    const chaseIds = retainedIds(chaseTrace)

    check(
      'Aline receives shared memory',
      () => assert.ok(alineIds.includes(shared.id))
    )

    check(
      'Chase receives same shared memory',
      () => assert.ok(chaseIds.includes(shared.id))
    )

    check(
      'Aline receives Aline-private memory',
      () => assert.ok(alineIds.includes(privateAline.id))
    )

    check(
      'Chase does not receive Aline-private memory',
      () => assert.ok(!chaseIds.includes(privateAline.id))
    )

    console.log(`BRIDGE RUNTIME RESULTS: ${checks}/8 passed`)
    assert.equal(checks, 8)
  } finally {
    await stop()
  }
})().catch(async err => {
  console.error('FAIL', err.message)
  try { await stop() } catch {}
  process.exit(1)
})
