'use strict'
// Malformed request-target regression (raw sockets). A request line whose
// target cannot be parsed as a URL must be rejected without terminating the
// process, on both the HTTP path and the WebSocket upgrade path. Valid v4
// WebSocket behaviour (member auth, ping/pong, 1008 rejection) is re-checked
// afterwards in the same process.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const WebSocket = require('ws')
const { openMemoryStore } = require('./services/member-memory')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-malformed-url-'))
const dbPath = path.join(dir, 'members.sqlite')
const capture = path.join(dir, 'capture.jsonl')
const port = 5600 + (process.pid % 300)
const store = openMemoryStore(dbPath)
const member = store.enroll()
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
const alive = () => child.exitCode === null && child.signalCode === null

async function start() {
  const env = {
    PATH: process.env.PATH, NODE_OPTIONS: '', PORT: String(port), MODEL_NAME: 'synthetic-local',
    ANTHROPIC_API_KEY: 'synthetic', DEEPGRAM_API_KEY: 'synthetic', ELEVENLABS_API_KEY: 'synthetic',
    PERSONA_V4_DB: dbPath, V4_TEST_CAPTURE: capture,
  }
  child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-support/v4-providers.cjs'), 'server.js'],
    { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', d => { output += d })
  child.stderr.on('data', d => { output += d })
  for (let i = 0; i < 250; i++) {
    if (!alive()) throw Error('server exited during startup')
    if (output.includes('Backend v3.3.0 on port')) return
    await pause(20)
  }
  throw Error('server did not start')
}

// Send one raw request; resolve with the raw bytes that came back before close/timeout.
function raw(lines) {
  return new Promise(resolve => {
    let data = Buffer.alloc(0)
    const s = net.connect(port, '127.0.0.1', () => s.write(lines.join('\r\n') + '\r\n\r\n'))
    s.on('data', d => { data = Buffer.concat([data, d]) })
    s.on('error', () => {})
    s.on('close', () => resolve(data))
    setTimeout(() => { s.destroy(); resolve(data) }, 1000)
  })
}
// Fail closed means: either no handshake at all, or a handshake whose only
// frame is a close with 1008 — the same shape v4 uses for auth rejection.
function assertFailClosed(reply) {
  const sep = reply.indexOf('\r\n\r\n')
  const head = sep === -1 ? reply.toString('latin1') : reply.subarray(0, sep).toString('latin1')
  if (!/^HTTP\/1\.1 101/.test(head)) return
  const frames = reply.subarray(sep + 4)
  assert.ok(frames.length >= 4, 'handshake accepted but no close frame sent')
  assert.equal(frames[0], 0x88, 'first frame after handshake must be a close frame')
  const len = frames[1] & 0x7f
  assert.equal(frames.readUInt16BE(2), 1008, 'close code must be 1008')
  assert.equal(frames.length, 2 + len, 'no data frames may follow the close')
}
const upgrade = target => [`GET ${target} HTTP/1.1`, 'Host: 127.0.0.1', 'Upgrade: websocket', 'Connection: Upgrade',
  'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==']

async function main() {
  await start()

  for (const target of ['//[', '//:99999', '//a:b@[x']) {
    await check(`malformed WebSocket upgrade ${target} -> rejected, process alive`, async () => {
      const reply = await raw(upgrade(target))
      await pause(150)
      assert.ok(alive(), 'server process terminated')
      assertFailClosed(reply)
    })
    await check(`malformed HTTP request ${target} -> process alive`, async () => {
      await raw([`GET ${target} HTTP/1.1`, 'Host: 127.0.0.1'])
      await raw([`POST ${target} HTTP/1.1`, 'Host: 127.0.0.1', 'Content-Length: 0'])
      await pause(150)
      assert.ok(alive(), 'server process terminated')
    })
  }

  await check('server still answers /health after malformed traffic', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/health`)
    assert.equal(r.status, 200)
  })
  await check('v4 WebSocket without credential still rejected with 1008', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?persona=aline`)
    ws.on('error', () => {})
    const [code] = await once(ws, 'close')
    assert.equal(code, 1008)
  })
  await check('valid member WebSocket still opens and answers ping with pong', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?persona=aline`, { headers: { Authorization: 'Bearer ' + member.credential } })
    const events = []
    ws.on('message', (d, binary) => { if (!binary) events.push(JSON.parse(d)) })
    await once(ws, 'open')
    ws.send(JSON.stringify({ type: 'ping' }))
    for (let i = 0; i < 100 && !events.some(e => e.type === 'pong'); i++) await pause(20)
    assert.ok(events.some(e => e.type === 'pong'))
    ws.close()
  })
  await check('process alive at end of suite', () => assert.ok(alive()))

  if (alive()) { child.kill('SIGTERM'); await once(child, 'exit') }
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`\nMALFORMED URL RESULTS: ${passed}/${passed + failed} passed`)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.log('FATAL ' + e.message); if (child && alive()) child.kill(); process.exit(1) })
