'use strict'
// v4 avatar boundary: ICE/TURN from Simli through Persona, exact-origin policy
// (production plus configured exact origins, never wildcards) and the approved
// persona face mapping. Module-level checks with a scripted provider double,
// then the real server.js with the avatar provider double. No network.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { openMemoryStore } = require('./services/member-memory')
const { createAvatarSession, createRateLimiter, parseAllowedOrigins } = require('./services/avatar-session')

// The approved face for each confidante (frontend-approved; Chase b575ab08...).
const APPROVED_FACES = Object.freeze({ aline: 'dd4decd0-81ea-48b0-87e0-cb8c0503bf7a', chase: 'b575ab08-c2a1-4dbf-8333-815a400449f8' })
const KEY = 'synthetic-simli-key-ice-NEVER-IN-RESPONSE-0123'
const TOKEN = 'synthetic-session-token-ice-0123456789'
const ICE_CREDENTIAL = 'synthetic-ice-credential-0123456789'
const PREVIEW = 'https://v0-persona-i-o-platform-git-member-lease-ec081e-michaeldienerai.vercel.app'
const PROD = 'https://personaio.app'

let passed = 0
let failed = 0
async function check(name, fn) {
  let timer
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('check timed out after 5s')), 5000) })
  try { await Promise.race([fn(), limit]); passed++; console.log('PASS ' + name) } catch (e) { failed++; console.log('FAIL ' + name + ' ' + e.message) } finally { clearTimeout(timer) }
}

// ── Module level ──────────────────────────────────────────────────
const members = { 'Bearer good-member': 'member-1', 'Bearer other-member': 'member-2' }
const runtime = {
  async authenticate(authorization) {
    if (authorization === 'Bearer revoked-member') throw Object.assign(Error('membership_required'), { code: 'membership_required' })
    if (members[authorization]) return members[authorization]
    throw Object.assign(Error('unauthenticated'), { code: 'unauthenticated' })
  },
}
const tokenCalls = []
const iceCalls = []
let nextToken = () => new Response(JSON.stringify({ session_token: TOKEN }), { status: 200 })
let nextIce = () => new Response(JSON.stringify([
  { urls: 'stun:stun.synthetic.test:3478', username: 'u-0123', credential: ICE_CREDENTIAL, extra: 'drop-me' },
  { urls: ['turn:turn.synthetic.test:3478?transport=udp', 'turns:turn.synthetic.test:5349?transport=tcp'], username: 'u-0123', credential: ICE_CREDENTIAL },
]), { status: 200, headers: { 'x-provider-secret': 'raw-provider-header-NEVER-FORWARDED' } })
async function fakeFetch(url, opts) {
  if (String(url) === 'https://api.simli.ai/compose/ice') { iceCalls.push({ method: opts.method, key: opts.headers['x-simli-api-key'] }); return nextIce(opts) }
  tokenCalls.push({ body: JSON.parse(opts.body), key: opts.headers['x-simli-api-key'] })
  return nextToken()
}
const logs = []
let clock = 1_000_000
const session = createAvatarSession({
  memberRuntime: runtime,
  faceIds: APPROVED_FACES,
  allowedOrigins: parseAllowedOrigins(PREVIEW),
  getApiKey: () => KEY,
  fetch: fakeFetch,
  timeoutMs: 100,
  bodyTimeoutMs: 200,
  limiter: createRateLimiter({ now: () => clock }),
  log: line => logs.push(String(line)),
})
const server = http.createServer((req, res) => session.handle(req, res))
async function post({ origin = PROD, auth = 'Bearer good-member', persona = 'aline' } = {}) {
  clock += 60_000 // outside the per-member interval unless a test says otherwise
  const headers = { 'Content-Type': 'application/json' }
  if (origin) headers.Origin = origin
  if (auth) headers.Authorization = auth
  const r = await fetch(`http://127.0.0.1:${server.address().port}/v4/avatar-session`, { method: 'POST', headers, body: JSON.stringify({ persona }) })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: r.status, text, json, headers: r.headers }
}

;(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r))

  await check('origins: wildcards, http, ports, paths and lookalikes are never accepted from configuration', async () => {
    assert.deepEqual(parseAllowedOrigins(''), [PROD])
    assert.deepEqual(parseAllowedOrigins(`${PREVIEW}, https://*.vercel.app, *, http://x.vercel.app, https://x.vercel.app:443, https://x.vercel.app/, https://x.vercel.app/p, https://-bad.vercel.app`), [PROD, PREVIEW])
  })
  await check('1. production origin accepted', async () => {
    const r = await post()
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('access-control-allow-origin'), PROD)
  })
  await check('2. the exact configured preview origin accepted', async () => {
    const r = await post({ origin: PREVIEW })
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('access-control-allow-origin'), PREVIEW)
  })
  await check('3. any other Vercel origin rejected (403), no provider call', async () => {
    const before = tokenCalls.length + iceCalls.length
    for (const origin of ['https://v0-persona-i-o-platform-git-other-michaeldienerai.vercel.app', 'https://evil.vercel.app', PREVIEW + '.evil.test', PREVIEW.replace('https', 'http')]) {
      assert.equal((await post({ origin })).status, 403, origin)
    }
    assert.equal(tokenCalls.length + iceCalls.length, before)
  })
  await check('4. external and missing origins rejected', async () => {
    assert.equal((await post({ origin: 'https://example.com' })).status, 403)
    assert.equal((await post({ origin: null })).status, 403)
  })
  await check('5/6. member gets a session token and sanitized ICE (STUN and TURN, provider credentials kept, extra fields dropped)', async () => {
    const r = await post()
    assert.deepEqual(Object.keys(r.json).sort(), ['expiresInSeconds', 'iceServers', 'provider', 'sessionToken'])
    assert.equal(r.json.sessionToken, TOKEN)
    assert.deepEqual(r.json.iceServers, [
      { urls: ['stun:stun.synthetic.test:3478'], username: 'u-0123', credential: ICE_CREDENTIAL },
      { urls: ['turn:turn.synthetic.test:3478?transport=udp', 'turns:turn.synthetic.test:5349?transport=tcp'], username: 'u-0123', credential: ICE_CREDENTIAL },
    ])
    assert.equal(iceCalls.at(-1).method, 'GET')
    assert.equal(iceCalls.at(-1).key, KEY)
  })
  await check('7/12. no Simli key, raw provider header or provider body ever reaches the response or the logs', async () => {
    const r = await post()
    for (const s of [KEY, 'raw-provider-header-NEVER-FORWARDED']) assert.ok(!r.text.includes(s))
    assert.equal(r.headers.get('x-provider-secret'), null)
    nextIce = () => new Response('provider-ice-body-NEVER-FORWARDED', { status: 500 })
    const f = await post()
    assert.ok(!f.text.includes('provider-ice-body'))
    for (const line of logs) for (const s of [KEY, TOKEN, ICE_CREDENTIAL, 'provider-ice-body']) assert.ok(!line.includes(s), 'log leaked')
    nextIce = () => new Response(JSON.stringify([{ urls: 'stun:stun.synthetic.test:3478' }]), { status: 200 })
  })
  await check('8. no bridge or credential fallback: missing, bridge-shaped or unknown bearer is 401 with no provider call', async () => {
    const before = tokenCalls.length + iceCalls.length
    assert.equal((await post({ auth: null })).status, 401)
    assert.equal((await post({ auth: 'Bearer synthetic-bridge-token' })).status, 401)
    assert.equal(tokenCalls.length + iceCalls.length, before)
  })
  await check('9. revoked membership rejected 403 with no provider call', async () => {
    const before = tokenCalls.length + iceCalls.length
    const r = await post({ auth: 'Bearer revoked-member' })
    assert.equal(r.status, 403)
    assert.deepEqual(r.json, { error: 'membership_required' })
    assert.equal(tokenCalls.length + iceCalls.length, before)
  })
  await check('10. Simli session failure -> 502 avatar_unavailable, no ICE returned', async () => {
    nextToken = () => new Response('x', { status: 500 })
    const r = await post()
    assert.equal(r.status, 502)
    assert.deepEqual(r.json, { error: 'avatar_unavailable' })
    nextToken = () => new Response(JSON.stringify({ session_token: TOKEN }), { status: 200 })
  })
  await check('11. Simli ICE failure of every kind -> explicit failure, never a token without ICE', async () => {
    const cases = [
      () => new Response('x', { status: 500 }),
      () => new Response('not json', { status: 200 }),
      () => new Response('[]', { status: 200 }),
      () => new Response(JSON.stringify({ urls: 'stun:x' }), { status: 200 }),
      () => new Response(JSON.stringify([{ urls: 'http://not-ice.test' }]), { status: 200 }),
      () => new Response(JSON.stringify([{ urls: 'turn:x', credential: 42 }]), { status: 200 }),
      () => new Response(JSON.stringify(Array(11).fill({ urls: 'stun:x' })), { status: 200 }),
      // provider never answers: only the deadline (abort) ends it
      opts => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })))),
    ]
    for (const [i, c] of cases.entries()) {
      nextIce = c
      const r = await post()
      assert.ok(r.status === 502 || r.status === 504, `case ${i}: ${r.status}`)
      assert.deepEqual(r.json, { error: 'avatar_unavailable' }, `case ${i}`)
      assert.ok(!r.text.includes(TOKEN), `case ${i} leaked a token`)
    }
    assert.ok(logs.some(l => l.includes('"failure":"simli_ice_failure"')))
    nextIce = () => new Response(JSON.stringify([{ urls: 'stun:stun.synthetic.test:3478' }]), { status: 200 })
  })
  await check('13/14. Chase uses the approved face, Aline unchanged (sent to Simli)', async () => {
    await post({ persona: 'chase' })
    assert.equal(tokenCalls.at(-1).body.faceId, APPROVED_FACES.chase)
    await post({ persona: 'aline' })
    assert.equal(tokenCalls.at(-1).body.faceId, APPROVED_FACES.aline)
  })
  await check('13b. server.js AVATAR_IDS equals the approved persona faces (drift guard)', async () => {
    const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8')
    const block = /const AVATAR_IDS = \{([\s\S]*?)\n\}/.exec(src)[1]
    const ids = Object.fromEntries([...block.matchAll(/(\w+):\s*'([0-9a-f-]{36})'/g)].map(m => [m[1], m[2]]))
    assert.deepEqual(ids, APPROVED_FACES)
  })
  server.close()

  // ── Real server.js: env-configured exact origin ───────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-avatar-ice-'))
  const dbPath = path.join(dir, 'members.sqlite')
  const capture = path.join(dir, 'capture.jsonl')
  fs.writeFileSync(capture, '')
  const store = openMemoryStore(dbPath)
  const member = store.enroll()
  const second = store.enroll()
  store.close()
  const port = 6100 + (process.pid % 500)
  let output = ''
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-support/v4-avatar-providers.cjs'), 'server.js'], {
    cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, NODE_OPTIONS: '', PORT: String(port), MODEL_NAME: 'synthetic-local', ANTHROPIC_API_KEY: 'synthetic',
      DEEPGRAM_API_KEY: 'synthetic', ELEVENLABS_API_KEY: 'synthetic', SIMLI_API_KEY: KEY, AVATAR_TEST_TOKEN: TOKEN,
      AVATAR_TEST_CAPTURE: capture, AVATAR_TEST_MODE_FILE: path.join(dir, 'mode'), PERSONA_V4_DB: dbPath,
      PERSONA_AVATAR_EXTRA_ORIGINS: `${PREVIEW},https://*.vercel.app` },
  })
  child.stdout.on('data', d => { output += d })
  child.stderr.on('data', d => { output += d })
  for (let i = 0; i < 250 && !output.includes('Backend v3.3.0 on port'); i++) await new Promise(r => setTimeout(r, 20))
  const live = (origin, credential) => fetch(`http://127.0.0.1:${port}/v4/avatar-session`, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: 'Bearer ' + credential }, body: JSON.stringify({ persona: 'chase' }) })
  await check('runtime: configured preview origin 200 with ICE; wildcard entry ignored; Chase approved face; key absent', async () => {
    const ok = await live(PREVIEW, member.credential)
    const body = await ok.json()
    assert.equal(ok.status, 200)
    assert.ok(Array.isArray(body.iceServers) && body.iceServers.some(s => s.urls.some(u => u.startsWith('turn'))))
    assert.equal((await live('https://anything.vercel.app', second.credential)).status, 403)
    const simli = fs.readFileSync(capture, 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(simli.find(r => r.type === 'simli').faceId, APPROVED_FACES.chase)
    assert.ok(simli.some(r => r.type === 'simli_ice' && r.keyHeaderMatches))
    assert.ok(!output.includes(KEY) && !output.includes(TOKEN))
  })
  child.kill('SIGTERM')
  await new Promise(r => child.once('exit', r))
  fs.rmSync(dir, { recursive: true, force: true })

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.log('FAIL harness ' + e.message); process.exit(1) })
