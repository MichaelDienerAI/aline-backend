'use strict'
// Rejected-WebSocket frame regression (raw sockets). A connection the server
// rejects with 1008 is still an open socket until the close handshake ends.
// A protocol-invalid frame sent in that window must not terminate the
// process. Each rejection path is exercised with several invalid frames, and
// healthy behaviour (/health, member ping/pong, 1008 rejection) is re-checked
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-rejected-ws-'))
const dbPath = path.join(dir, 'members.sqlite')
const capture = path.join(dir, 'capture.jsonl')
const port = 5900 + (process.pid % 300)
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
// A crash on one path must not hide the result of the next: restart and count.
let exits = 0
async function restartIfDead() {
  if (alive()) return
  exits++
  output = ''
  await start()
}

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

// Complete the upgrade, then send `frame` once the 101 head has arrived.
// Resolves with everything received after the head and whether the server
// closed the socket before the deadline.
function rejectedUpgrade(target, headers, frame) {
  return new Promise(resolve => {
    let data = Buffer.alloc(0)
    let sent = false
    let done = false
    const finish = closed => {
      if (done) return
      done = true
      s.destroy()
      const sep = data.indexOf('\r\n\r\n')
      resolve({ head: sep === -1 ? data.toString('latin1') : data.subarray(0, sep).toString('latin1'), frames: sep === -1 ? Buffer.alloc(0) : data.subarray(sep + 4), closed })
    }
    const s = net.connect(port, '127.0.0.1', () => s.write([`GET ${target} HTTP/1.1`, 'Host: 127.0.0.1', 'Upgrade: websocket',
      'Connection: Upgrade', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', ...headers].join('\r\n') + '\r\n\r\n'))
    s.on('data', d => {
      data = Buffer.concat([data, d])
      if (!sent && data.includes('\r\n\r\n')) { sent = true; s.write(frame) }
    })
    s.on('error', () => {})
    s.on('close', () => finish(true))
    setTimeout(() => finish(false), 2000)
  })
}
// Only close frames may follow the handshake; the first must carry 1008.
function assertOnlyClose(frames) {
  assert.ok(frames.length >= 4, 'no close frame received')
  assert.equal(frames.readUInt16BE(2), 1008, 'first close code must be 1008')
  for (let i = 0; i < frames.length;) {
    assert.equal(frames[i], 0x88, 'non-close frame sent on a rejected connection')
    i += 2 + (frames[i + 1] & 0x7f)
  }
}

// Each is invalid on a server socket and makes the ws receiver emit 'error'.
const FRAMES = {
  'unmasked text frame': Buffer.from([0x81, 0x02, 0x68, 0x69]),
  'masked frame with RSV1 set': Buffer.from([0xc1, 0x82, 0, 0, 0, 0, 0x68, 0x69]),
  'masked frame with reserved opcode 0x3': Buffer.from([0x83, 0x80, 0, 0, 0, 0]),
}
const PATHS = {
  'no member credential': ['/?persona=aline', []],
  'unknown confidante': ['/?persona=nobody', ['Authorization: Bearer ' + member.credential]],
  'malformed request URL': ['//[', []],
}

async function main() {
  await start()

  for (const [pathName, [target, headers]] of Object.entries(PATHS)) {
    for (const [frameName, frame] of Object.entries(FRAMES)) {
      await restartIfDead()
      await check(`${pathName} + ${frameName} -> 1008, socket closed, process alive`, async () => {
        const r = await rejectedUpgrade(target, headers, frame)
        await pause(150)
        assert.ok(alive(), 'server process terminated')
        assert.match(r.head, /^HTTP\/1\.1 101/)
        assertOnlyClose(r.frames)
        assert.ok(r.closed, 'server did not close the rejected socket')
      })
    }
  }

  // Control: an accepted session already has an 'error' listener, so the same
  // frame must close only that socket.
  await restartIfDead()
  await check('accepted member session + unmasked text frame -> socket closed, process alive', async () => {
    const r = await rejectedUpgrade('/?persona=aline', ['Authorization: Bearer ' + member.credential], FRAMES['unmasked text frame'])
    await pause(150)
    assert.ok(alive(), 'server process terminated')
    assert.match(r.head, /^HTTP\/1\.1 101/)
    assert.ok(r.closed, 'server did not close the socket')
  })

  await restartIfDead()
  await check('server still answers /health after invalid frames', async () => {
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
  await check('process never exited during the suite', () => { assert.ok(alive()); assert.equal(exits, 0, `server exited ${exits} time(s)`) })

  if (alive()) { child.kill('SIGTERM'); await once(child, 'exit') }
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`\nREJECTED WS FRAME RESULTS: ${passed}/${passed + failed} passed`)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.log('FATAL ' + e.message); if (child && alive()) child.kill(); process.exit(1) })
