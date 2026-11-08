'use strict'
// v4 avatar-session boundary: module-level checks against the real member
// runtime (synthetic SQLite store) and a scripted Simli double. No network.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { openMemoryStore } = require('./services/member-memory')
const { createMemberRuntime } = require('./services/member-runtime')
const { createAvatarSession, createRateLimiter } = require('./services/avatar-session')

const KEY = 'synthetic-simli-key-0123456789abcdef'
const TOKEN = 'synthetic-session-token-SHOULD-NEVER-BE-LOGGED-0123456789'
const PROVIDER_SECRET_BODY = 'provider-detail-SHOULD-NEVER-REACH-CLIENT'
const ORIGIN = 'https://personaio.app'
const FACE = { aline: '003760f2-027b-4259-93ef-fbd8cf3ceac3', chase: 'f67abeed-9640-44e6-b49e-2b02a23158f0' }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-avatar-'))
const dbPath = path.join(dir, 'members.sqlite')
const seed = openMemoryStore(dbPath)
const member = seed.enroll()
const other = seed.enroll()
seed.close()
const runtime = createMemberRuntime(dbPath)

let passed = 0
let failed = 0
// A hang is a failure, not a stall: every check is bounded.
async function check(name, fn) {
  let timer
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('check timed out after 5s')), 5000) })
  try { await Promise.race([fn(), limit]); passed++; console.log('PASS ' + name) } catch (e) { failed++; console.log('FAIL ' + name + ' ' + e.message) } finally { clearTimeout(timer) }
}

// Scripted provider double. `next` decides the response for the next call.
const calls = []
let next = () => new Response(JSON.stringify({ session_token: TOKEN, warnings: [] }), { status: 200 })
async function fakeFetch(url, opts) {
  calls.push({ url: String(url), headers: { ...opts.headers }, body: JSON.parse(opts.body), signal: opts.signal })
  return next(opts)
}

const logs = []
let clock = 1_000_000
let apiKey = KEY
const session = createAvatarSession({
  memberRuntime: runtime,
  faceIds: FACE,
  getApiKey: () => apiKey,
  fetch: fakeFetch,
  timeoutMs: 50,
  bodyTimeoutMs: 200,
  limiter: createRateLimiter({ now: () => clock }),
  log: line => logs.push(String(line)),
})

const server = http.createServer((req, res) => {
  if (session.matches(req)) return session.handle(req, res)
  res.writeHead(418); res.end()
})

let port
function request({ method = 'POST', pathname = '/v4/avatar-session', origin = ORIGIN, auth, body, raw, headers = {} } = {}) {
  const h = { ...headers }
  if (origin !== null) h.Origin = origin
  if (auth !== undefined) h.Authorization = auth
  let payload = raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined
  if (payload !== undefined) h['Content-Type'] = h['Content-Type'] || 'application/json'
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: h }, res => {
      let text = ''
      res.on('data', d => { text += d })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(text) } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json })
      })
    })
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}
const bearer = (c = member.credential) => 'Bearer ' + c
// Each successful mint needs a fresh limiter slot; advance past the interval.
const tick = () => { clock += 11_000 }

async function rejectsWithoutProvider(name, opts, status, error) {
  await check(name, async () => {
    tick()
    const before = calls.length
    const r = await request(opts)
    assert.equal(r.status, status)
    assert.deepEqual(r.json, { error })
    assert.equal(calls.length, before, 'provider must not be called')
  })
}

async function main() {
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  port = server.address().port

  // ── Authentication fails closed before any provider call ──
  await rejectsWithoutProvider('no Authorization header -> 401', { body: { persona: 'aline' } }, 401, 'unauthenticated')
  for (const [label, auth] of [['Basic scheme', 'Basic abc'], ['bare Bearer', 'Bearer'], ['empty Bearer', 'Bearer '],
    ['lowercase scheme', 'bearer ' + member.credential], ['oversized credential', 'Bearer ' + 'x'.repeat(300)]]) {
    await rejectsWithoutProvider('malformed Authorization (' + label + ') -> 401', { auth, body: { persona: 'aline' } }, 401, 'unauthenticated')
  }
  await rejectsWithoutProvider('invalid member credential -> 401', { auth: bearer('not-a-member'), body: { persona: 'aline' } }, 401, 'unauthenticated')
  await rejectsWithoutProvider('invalid credential + invalid persona -> 401 (auth checked first)', { auth: bearer('not-a-member'), body: { persona: 'zoe' } }, 401, 'unauthenticated')
  for (const persona of ['zoe', '', 'ALINE', '__proto__', 'constructor', 42, null]) {
    await rejectsWithoutProvider('valid member + invalid persona ' + JSON.stringify(persona) + ' -> 400', { auth: bearer(), body: { persona } }, 400, 'invalid_confidante')
  }
  await rejectsWithoutProvider('valid member + missing persona -> 400', { auth: bearer(), body: {} }, 400, 'invalid_confidante')
  await rejectsWithoutProvider('malformed JSON body -> 400', { auth: bearer(), raw: '{"persona":' }, 400, 'invalid_request')
  await rejectsWithoutProvider('non-object JSON body -> 400', { auth: bearer(), raw: '["aline"]' }, 400, 'invalid_request')
  await rejectsWithoutProvider('oversized body -> 400', { auth: bearer(), raw: JSON.stringify({ persona: 'aline', pad: 'x'.repeat(5000) }) }, 400, 'invalid_request')

  // ── Origin allowlist (endpoint only) ──
  for (const [label, origin] of [['foreign origin', 'https://evil.example'], ['missing Origin', null],
    ['vercel alias', 'https://v0-persona-i-o-platform.vercel.app'], ['http scheme', 'http://personaio.app'],
    ['www host', 'https://www.personaio.app'], ['suffix trick', 'https://personaio.app.evil.example']]) {
    await check('disallowed Origin (' + label + ') -> 403, no CORS grant, no provider call', async () => {
      tick()
      const before = calls.length
      const r = await request({ origin, auth: bearer(), body: { persona: 'aline' } })
      assert.equal(r.status, 403)
      assert.deepEqual(r.json, { error: 'origin_not_allowed' })
      assert.equal(r.headers['access-control-allow-origin'], undefined)
      assert.equal(calls.length, before)
    })
  }
  await check('disallowed Origin preflight -> 403 without CORS grant', async () => {
    const r = await request({ method: 'OPTIONS', origin: 'https://evil.example' })
    assert.equal(r.status, 403)
    assert.equal(r.headers['access-control-allow-origin'], undefined)
  })
  await check('allowed production Origin preflight -> 204 with exact-origin CORS', async () => {
    const r = await request({ method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' } })
    assert.equal(r.status, 204)
    assert.equal(r.headers['access-control-allow-origin'], ORIGIN)
    assert.match(r.headers['vary'] || '', /Origin/)
    assert.match(r.headers['access-control-allow-headers'], /Authorization/i)
    assert.match(r.headers['access-control-allow-methods'], /POST/)
  })
  await rejectsWithoutProvider('GET from allowed origin -> 405', { method: 'GET' }, 405, 'method_not_allowed')

  // ── Success path ──
  await check('valid Aline member request -> 200, Aline faceId sent', async () => {
    tick()
    const before = calls.length
    const r = await request({ auth: bearer(), body: { persona: 'aline' } })
    assert.equal(r.status, 200)
    assert.equal(calls.length, before + 1)
    const c = calls.at(-1)
    assert.equal(c.url, 'https://api.simli.ai/compose/token')
    assert.equal(c.body.faceId, FACE.aline)
    assert.equal(r.headers['access-control-allow-origin'], ORIGIN)
    assert.equal(r.headers['cache-control'], 'no-store')
  })
  await check('valid Chase member request -> 200, Chase faceId sent', async () => {
    tick()
    const r = await request({ auth: bearer(other.credential), body: { persona: 'chase' } })
    assert.equal(r.status, 200)
    assert.equal(calls.at(-1).body.faceId, FACE.chase)
  })
  await check('provider request uses maxSessionLength 900, maxIdleTime 60, apiVersion v2', async () => {
    const b = calls.at(-1).body
    assert.equal(b.maxSessionLength, 900)
    assert.equal(b.maxIdleTime, 60)
    assert.equal(b.apiVersion, 'v2')
    assert.deepEqual(Object.keys(b).sort(), ['apiVersion', 'faceId', 'maxIdleTime', 'maxSessionLength'])
  })
  await check('SIMLI_API_KEY sent only in the x-simli-api-key header', async () => {
    const c = calls.at(-1)
    assert.equal(c.headers['x-simli-api-key'], KEY)
    assert.ok(!JSON.stringify(c.body).includes(KEY))
    assert.ok(!c.url.includes(KEY))
    assert.equal(c.headers.Authorization, undefined, 'member credential must not be forwarded to provider')
  })
  await check('response carries only provider, sessionToken, expiresInSeconds; never the key', async () => {
    tick()
    const r = await request({ auth: bearer(), body: { persona: 'aline' } })
    assert.deepEqual(Object.keys(r.json).sort(), ['expiresInSeconds', 'provider', 'sessionToken'])
    assert.equal(r.json.provider, 'simli')
    assert.equal(r.json.sessionToken, TOKEN)
    assert.equal(r.json.expiresInSeconds, 300)
    assert.ok(!r.text.includes(KEY))
    assert.ok(!JSON.stringify(r.headers).includes(KEY))
  })

  // ── Provider failures are bounded ──
  const providerFailure = async (name, respond, status, failure) => {
    await check(name, async () => {
      tick()
      next = respond
      const r = await request({ auth: bearer(), body: { persona: 'aline' } })
      next = () => new Response(JSON.stringify({ session_token: TOKEN }), { status: 200 })
      assert.equal(r.status, status)
      assert.deepEqual(r.json, { error: 'avatar_unavailable' })
      assert.ok(!r.text.includes(PROVIDER_SECRET_BODY))
      const last = logs.at(-1)
      assert.ok(last.startsWith('[avatar] '), 'bounded log line expected')
      assert.deepEqual(JSON.parse(last.slice(9)).failure, failure)
    })
  }
  const body = (status, text = PROVIDER_SECRET_BODY) => () => new Response(text, { status })
  await providerFailure('provider 401 -> 502 bounded', body(401), 502, 'simli_auth_failure')
  await providerFailure('provider 403 -> 502 bounded', body(403), 502, 'simli_auth_failure')
  await providerFailure('provider 429 -> 502 bounded', body(429), 502, 'simli_rate_limited')
  await providerFailure('provider 500 -> 502 bounded', body(500), 502, 'simli_http_failure')
  await providerFailure('provider 503 -> 502 bounded', body(503), 502, 'simli_http_failure')
  await providerFailure('provider 400 FAIL TOKEN -> 502 bounded', () => new Response(JSON.stringify({ session_token: 'FAIL TOKEN', detail: PROVIDER_SECRET_BODY }), { status: 400 }), 502, 'simli_http_failure')
  await providerFailure('provider 200 non-JSON -> 502 bounded', body(200), 502, 'simli_malformed_response')
  await providerFailure('provider 200 without session_token -> 502 bounded', () => new Response(JSON.stringify({ detail: PROVIDER_SECRET_BODY }), { status: 200 }), 502, 'simli_malformed_response')
  await providerFailure('provider 200 with FAIL token -> 502 bounded', () => new Response(JSON.stringify({ session_token: 'FAIL TOKEN' }), { status: 200 }), 502, 'simli_malformed_response')
  await providerFailure('provider timeout -> 504 bounded', opts => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })))), 504, 'simli_timeout')
  await providerFailure('provider transport error -> 502 bounded', () => Promise.reject(Error(PROVIDER_SECRET_BODY)), 502, 'simli_transport_failure')

  await check('missing SIMLI_API_KEY -> 503 without provider call', async () => {
    tick()
    apiKey = undefined
    const before = calls.length
    const r = await request({ auth: bearer(), body: { persona: 'aline' } })
    apiKey = KEY
    assert.equal(r.status, 503)
    assert.deepEqual(r.json, { error: 'avatar_unavailable' })
    assert.equal(calls.length, before)
  })

  // ── Rate limiting ──
  await check('rate limit: immediate repeat -> 429 with Retry-After, no provider call', async () => {
    tick()
    const first = await request({ auth: bearer(), body: { persona: 'aline' } })
    assert.equal(first.status, 200)
    const before = calls.length
    const second = await request({ auth: bearer(), body: { persona: 'aline' } })
    assert.equal(second.status, 429)
    assert.deepEqual(second.json, { error: 'rate_limited' })
    assert.ok(Number(second.headers['retry-after']) >= 1)
    assert.equal(calls.length, before)
  })
  await check('rate limit is per member: other member unaffected', async () => {
    const r = await request({ auth: bearer(other.credential), body: { persona: 'chase' } })
    assert.equal(r.status, 200)
  })
  await check('rate limit: hourly ceiling of 20 per member', () => {
    let t = 0
    const limiter = createRateLimiter({ now: () => t })
    for (let i = 0; i < 20; i++) { assert.equal(limiter.take('m').ok, true, 'take ' + i); t += 10_000 }
    const blocked = limiter.take('m')
    assert.equal(blocked.ok, false)
    assert.ok(blocked.retryAfterSeconds >= 1)
    t += 3_600_000
    assert.equal(limiter.take('m').ok, true)
  })

  // ── I2: request-body handling is bounded ──
  // Sends headers and a partial body; never ends it unless told to abort.
  const partial = ({ auth, abortAfterMs } = {}) => new Promise(resolve => {
    const started = Date.now()
    const headers = { Origin: ORIGIN, 'Content-Type': 'application/json', 'Content-Length': '100' }
    if (auth) headers.Authorization = auth
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/v4/avatar-session', headers }, res => {
      let text = ''
      res.on('data', d => { text += d })
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - started, text }))
    })
    req.on('error', () => resolve({ status: 'socket_closed', ms: Date.now() - started }))
    req.write('{"persona":')
    if (abortAfterMs) setTimeout(() => req.destroy(), abortAfterMs)
  })
  await check('unauthenticated caller with stalled body -> 401 immediately, body never awaited', async () => {
    const r = await partial({ auth: 'Bearer not-a-member' })
    assert.equal(r.status, 401)
    assert.ok(r.ms < 150, `took ${r.ms}ms`)
  })
  await check('authenticated slowloris body -> 408 at the body deadline, no provider call', async () => {
    tick()
    const before = calls.length
    const r = await partial({ auth: bearer() })
    assert.equal(r.status, 408)
    assert.ok(r.ms >= 180 && r.ms < 1000, `took ${r.ms}ms`)
    assert.equal(calls.length, before)
  })
  await check('authenticated client aborting mid-body -> no crash, endpoint still serves', async () => {
    tick()
    const r = await partial({ auth: bearer(), abortAfterMs: 30 })
    assert.equal(r.status, 'socket_closed')
    await new Promise(r => setTimeout(r, 50))
    tick()
    const after = await request({ auth: bearer(), body: { persona: 'aline' } })
    assert.equal(after.status, 200)
  })

  // ── I1: the provider deadline covers the body; the body is bounded ──
  const enc = s => new TextEncoder().encode(s)
  const stalledBody = () => new Response(new ReadableStream({
    start(c) { c.enqueue(enc('{"session_token":"')) },
    pull() { return new Promise(() => {}) }, // never delivers the rest; ignores abort
  }), { status: 200 })
  await providerFailure('provider headers then stalled body -> 504 within the deadline', stalledBody, 504, 'simli_timeout')
  await check('stalled provider body is released within the deadline', async () => {
    tick()
    next = stalledBody
    const started = Date.now()
    const r = await request({ auth: bearer(), body: { persona: 'aline' } })
    next = () => new Response(JSON.stringify({ session_token: TOKEN }), { status: 200 })
    assert.equal(r.status, 504)
    assert.ok(Date.now() - started < 1000, 'must not wait beyond the provider deadline')
  })
  let cancelled = 0
  const streamOf = (text, status) => new Response(new ReadableStream({
    start(c) { c.enqueue(enc(text)) },
    pull() { return new Promise(() => {}) },
    cancel() { cancelled++ },
  }), { status })
  await check('oversized provider body -> 502 malformed and stream cancelled', async () => {
    tick()
    cancelled = 0
    next = () => streamOf('{"session_token":"' + 'x'.repeat(20_000), 200)
    const r = await request({ auth: bearer(), body: { persona: 'aline' } })
    next = () => new Response(JSON.stringify({ session_token: TOKEN }), { status: 200 })
    assert.equal(r.status, 502)
    assert.deepEqual(r.json, { error: 'avatar_unavailable' })
    assert.equal(JSON.parse(logs.at(-1).slice(9)).failure, 'simli_malformed_response')
    assert.equal(cancelled, 1)
  })
  await check('provider error body is cancelled, not left unread', async () => {
    tick()
    cancelled = 0
    next = () => streamOf(PROVIDER_SECRET_BODY, 500)
    const r = await request({ auth: bearer(), body: { persona: 'aline' } })
    next = () => new Response(JSON.stringify({ session_token: TOKEN }), { status: 200 })
    assert.equal(r.status, 502)
    assert.equal(cancelled, 1)
  })

  // ── Internal faults stay inside the endpoint (no process crash) ──
  await check('internal fault -> bounded 500, listener survives, no provider call', async () => {
    const faulty = createAvatarSession({
      memberRuntime: runtime, faceIds: FACE, getApiKey: () => KEY, fetch: fakeFetch,
      limiter: { take() { throw Error('limiter exploded ' + TOKEN) } },
      log: line => logs.push(String(line)),
    })
    const s2 = http.createServer((req, res) => faulty.handle(req, res))
    await new Promise(r => s2.listen(0, '127.0.0.1', r))
    const saved = port
    port = s2.address().port
    const before = calls.length
    try {
      const r = await request({ auth: bearer(), body: { persona: 'aline' } })
      assert.equal(r.status, 500)
      assert.deepEqual(r.json, { error: 'internal_error' })
      assert.equal(calls.length, before)
      assert.equal(JSON.parse(logs.at(-1).slice(9)).failure, 'avatar_internal_failure')
    } finally {
      port = saved
      s2.close()
    }
    const alive = await request({ method: 'OPTIONS' })
    assert.equal(alive.status, 204)
  })

  // ── Logs ──
  await check('logs never contain the API key, session token, or member credential', () => {
    const all = logs.join('\n')
    assert.ok(logs.length > 0)
    for (const secret of [KEY, TOKEN, member.credential, other.credential, PROVIDER_SECRET_BODY]) assert.ok(!all.includes(secret))
    for (const line of logs) {
      assert.ok(line.startsWith('[avatar] '))
      assert.deepEqual(Object.keys(JSON.parse(line.slice(9))).sort(), ['component', 'failure', 'status'])
    }
  })

  server.close()
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`\nAVATAR SESSION RESULTS: ${passed}/${passed + failed} passed`)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.log('FATAL ' + e.message); process.exit(1) })
