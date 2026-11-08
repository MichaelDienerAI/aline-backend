'use strict'
// Supabase identity → Persona member: resolver order, enrollment, isolation,
// fail-closed paths, verifier wire contract, and log hygiene. Synthetic tokens
// and an in-process Supabase double only; no network.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { createMemberRuntime } = require('./services/member-runtime')
const { openMemoryStore } = require('./services/member-memory')
const { createMemberIdentity, createSupabaseVerifier, selectProtocol, SUBPROTOCOL } = require('./services/member-identity')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-identity-'))
const SERVICE_KEY = 'synthetic-service-role-key-NEVER-LOGGED-0123456789'
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const USER_INACTIVE = '33333333-3333-4333-8333-333333333333'

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name) } catch (e) { failed++; console.log('FAIL ' + name + ' ' + e.message) }
}
const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url')
let serial = 0
// Shape-valid synthetic JWT. The signature segment is a per-token nonce; only
// the verifier double decides validity.
function token({ exp = Math.floor(Date.now() / 1000) + 3600, sub = USER_A } = {}) {
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp })}.sig${++serial}synthetic`
}
async function rejects(promise, code) {
  try { await promise } catch (e) { assert.equal(e.code || e.message, code); return }
  throw Error('expected rejection ' + code)
}

// Verifier double: token → user id, user id → membership status.
function fakeVerifier({ users = new Map(), active = new Set([USER_A, USER_B]), delayMs = 0, userError, membershipError } = {}) {
  const calls = { user: 0, membership: 0 }
  return {
    calls,
    async user(t) {
      calls.user++
      if (delayMs) await new Promise(r => setTimeout(r, delayMs))
      if (userError) throw Object.assign(Error(userError), { code: userError })
      if (!users.has(t)) throw Object.assign(Error('unauthenticated'), { code: 'unauthenticated' })
      return { id: users.get(t) }
    },
    async activeMembership(id) {
      calls.membership++
      if (membershipError) throw Object.assign(Error(membershipError), { code: membershipError })
      return active.has(id)
    },
  }
}
function setup(verifierOptions) {
  const file = path.join(dir, `members-${++serial}.sqlite`)
  const runtime = createMemberRuntime(file)
  const verifier = verifierOptions === null ? null : fakeVerifier(verifierOptions)
  const logs = []
  const identity = createMemberIdentity({ runtime, verifier, log: line => logs.push(line) })
  const rows = sql => { const db = new DatabaseSync(file); try { return db.prepare(sql).all().map(r => ({ ...r })) } finally { db.close() } }
  return { file, runtime, verifier, identity, logs, rows }
}

;(async () => {
  // ── RESOLUTION ──
  {
    const tA = token()
    const s = setup({ users: new Map([[tA, USER_A]]) })
    let first
    await check('1. valid Supabase member resolves to a Persona member', async () => {
      first = await s.identity.authenticate('Bearer ' + tA)
      assert.match(first, /^[0-9a-f-]{36}$/)
    })
    await check('5. first valid request enrolls exactly one member and one mapping', async () => {
      assert.equal(s.rows('SELECT COUNT(*) n FROM members')[0].n, 1)
      assert.deepEqual(s.rows('SELECT provider, subject, member_id FROM member_identities'), [{ provider: 'supabase', subject: USER_A, member_id: first }])
    })
    await check('6. repeated request (new token, same user) returns the same member, no new rows', async () => {
      const tA2 = token()
      s.verifier.calls.user = 0
      const users = new Map([[tA2, USER_A]])
      const again = createMemberIdentity({ runtime: s.runtime, verifier: fakeVerifier({ users }), log: () => {} })
      assert.equal(await again.authenticate('Bearer ' + tA2), first)
      assert.equal(await s.identity.authenticate('Bearer ' + tA), first)
      assert.equal(s.rows('SELECT COUNT(*) n FROM members')[0].n, 1)
    })
    await check('mapping survives a store reopen (reconnects, restarts)', async () => {
      const reopened = createMemberIdentity({ runtime: createMemberRuntime(s.file), verifier: fakeVerifier({ users: new Map([[tA, USER_A]]) }), log: () => {} })
      assert.equal(await reopened.authenticate('Bearer ' + tA), first)
    })
  }
  {
    const tokens = Array.from({ length: 12 }, () => token())
    const s = setup({ users: new Map(tokens.map(t => [t, USER_A])), delayMs: 15 })
    await check('7. concurrent first requests for one user create one member', async () => {
      const ids = await Promise.all(tokens.map(t => s.identity.authenticate('Bearer ' + t)))
      assert.equal(new Set(ids).size, 1)
      assert.equal(s.rows('SELECT COUNT(*) n FROM members')[0].n, 1)
      assert.equal(s.rows('SELECT COUNT(*) n FROM member_identities')[0].n, 1)
    })
    await check('7b. concurrent first requests across two store connections create one member', async () => {
      const otherRuntime = createMemberRuntime(s.file)
      const t1 = token(); const t2 = token()
      const users = new Map([[t1, USER_B], [t2, USER_B]])
      const a = createMemberIdentity({ runtime: s.runtime, verifier: fakeVerifier({ users, delayMs: 10 }), log: () => {} })
      const b = createMemberIdentity({ runtime: otherRuntime, verifier: fakeVerifier({ users, delayMs: 10 }), log: () => {} })
      const [x, y] = await Promise.all([a.authenticate('Bearer ' + t1), b.authenticate('Bearer ' + t2)])
      assert.equal(x, y)
      assert.equal(s.rows(`SELECT COUNT(*) n FROM member_identities WHERE subject='${USER_B}'`)[0].n, 1)
    })
  }
  {
    const tA = token(); const tB = token({ sub: USER_B })
    const s = setup({ users: new Map([[tA, USER_A], [tB, USER_B]]) })
    let a, b
    await check('8. two Supabase users resolve to different members', async () => {
      a = await s.identity.authenticate('Bearer ' + tA)
      b = await s.identity.authenticate('Bearer ' + tB)
      assert.notEqual(a, b)
    })
    await check('10. member A cannot read or change member B state', async () => {
      const sa = s.runtime.connectMember(a, 'aline', () => {})
      const sb = s.runtime.connectMember(b, 'aline', () => {})
      const created = sb.control({ action: 'create', memory: { content: 'B private synthetic record', scope: 'all' } })
      assert.deepEqual(sa.control({ action: 'list' }), [])
      assert.throws(() => sa.control({ action: 'inspect', id: created.id }), /not_found/)
      assert.throws(() => sa.control({ action: 'delete', id: created.id }), /not_found/)
      assert.equal(sb.control({ action: 'list' }).length, 1)
      assert.deepEqual(JSON.parse(sa.begin().content).institutional, [])
      sa.end()
    })
    await check('identity is taken from Supabase, not from the token payload', async () => {
      // Payload claims USER_B; the verifier says USER_A.
      const forged = token({ sub: USER_B })
      const s2 = createMemberIdentity({ runtime: s.runtime, verifier: fakeVerifier({ users: new Map([[forged, USER_A]]) }), log: () => {} })
      assert.equal(await s2.authenticate('Bearer ' + forged), a)
    })
  }

  // ── REJECTIONS ──
  {
    const tA = token()
    const s = setup({ users: new Map([[tA, USER_A]]) })
    await check('2. invalid token rejects (Supabase 401)', async () => {
      await rejects(s.identity.authenticate('Bearer ' + token()), 'unauthenticated')
    })
    await check('2b. non-Bearer, empty, oversized and non-JWT-shaped proofs reject', async () => {
      for (const auth of [undefined, '', 'Basic x', 'Bearer ', 'Bearer a.b', 'Bearer a.b.c.d', 'Bearer ' + 'a'.repeat(3000) + '.' + 'b'.repeat(1100) + '.c']) {
        await rejects(s.identity.authenticate(auth), 'unauthenticated')
      }
    })
    await check('3. expired token rejects before any Supabase call', async () => {
      const calls = s.verifier.calls.user
      const expired = token({ exp: Math.floor(Date.now() / 1000) - 5 })
      s.verifier && (s.verifier.calls.user = calls)
      await rejects(s.identity.authenticate('Bearer ' + expired), 'unauthenticated')
      await rejects(s.identity.authenticate(`Bearer ${b64({ alg: 'HS256' })}.${b64({ sub: USER_A })}.sig`), 'unauthenticated')
      await rejects(s.identity.authenticate(`Bearer ${b64({ alg: 'HS256' })}.not-json.sig`), 'unauthenticated')
      assert.equal(s.verifier.calls.user, calls)
    })
    await check('4. inactive / no membership rejects and enrolls nothing', async () => {
      const tI = token({ sub: USER_INACTIVE })
      const s2 = setup({ users: new Map([[tI, USER_INACTIVE]]) })
      await rejects(s2.identity.authenticate('Bearer ' + tI), 'membership_required')
      assert.equal(s2.rows('SELECT COUNT(*) n FROM members')[0].n, 0)
      assert.equal(s2.rows('SELECT COUNT(*) n FROM member_identities')[0].n, 0)
    })
    await check('4b. membership revoked after enrollment rejects the mapped user', async () => {
      await s.identity.authenticate('Bearer ' + tA)
      const revoked = createMemberIdentity({ runtime: s.runtime, verifier: fakeVerifier({ users: new Map([[tA, USER_A]]), active: new Set() }), log: () => {} })
      await rejects(revoked.authenticate('Bearer ' + tA), 'membership_required')
    })
    await check('Supabase unreachable / not configured fails closed (identity_unavailable)', async () => {
      const t = token()
      const down = setup({ users: new Map([[t, USER_A]]), userError: 'identity_unavailable' })
      await rejects(down.identity.authenticate('Bearer ' + t), 'identity_unavailable')
      const membershipDown = setup({ users: new Map([[t, USER_A]]), membershipError: 'identity_unavailable' })
      await rejects(membershipDown.identity.authenticate('Bearer ' + t), 'identity_unavailable')
      const none = setup(null)
      await rejects(none.identity.authenticate('Bearer ' + t), 'identity_unavailable')
      for (const x of [down, membershipDown, none]) assert.equal(x.rows('SELECT COUNT(*) n FROM members')[0].n, 0)
    })
  }

  // ── MALFORMED METADATA, CORRUPT MAPPING ──
  {
    await check('12. malformed identity metadata fails closed', async () => {
      const t = token()
      for (const id of ['', 'not-a-uuid', '11111111-1111-4111-8111-11111111111', null, 42]) {
        const runtime = createMemberRuntime(path.join(dir, `m-${++serial}.sqlite`))
        const verifier = createSupabaseVerifier({ url: 'https://synthetic.supabase.test', serviceKey: SERVICE_KEY,
          fetch: async () => new Response(JSON.stringify({ id }), { status: 200 }) })
        await rejects(createMemberIdentity({ runtime, verifier, log: () => {} }).authenticate('Bearer ' + t), 'unauthenticated')
      }
      const s = setup({})
      await assert.rejects(async () => s.runtime.externalMember('supabase', ''), /invalid_identity/)
      await assert.rejects(async () => s.runtime.externalMember('supabase', 'x'.repeat(257)), /invalid_identity/)
    })
    await check('E. mapping to a missing member fails closed and never re-enrolls', async () => {
      const tA = token()
      const s = setup({ users: new Map([[tA, USER_A]]) })
      const id = await s.identity.authenticate('Bearer ' + tA)
      const db = new DatabaseSync(s.file)
      db.exec('PRAGMA foreign_keys=OFF')
      db.prepare('DELETE FROM members WHERE id=?').run(id)
      db.close()
      await rejects(s.identity.authenticate('Bearer ' + tA), 'member_store_failure')
      assert.equal(s.rows('SELECT COUNT(*) n FROM members')[0].n, 0)
      assert.deepEqual(s.rows('SELECT member_id FROM member_identities'), [{ member_id: id }])
      assert.ok(s.logs.some(l => l.includes('"failure":"member_store_failure"')))
    })
    await check('member credentials still authenticate; enrolled members have no usable credential', async () => {
      const s = setup({ users: new Map() })
      const store = openMemoryStore(path.join(dir, `cred-${++serial}.sqlite`))
      const { memberId, credential } = store.enroll()
      store.close()
      const runtime = createMemberRuntime(path.join(dir, `cred-${serial}.sqlite`))
      const identity = createMemberIdentity({ runtime, verifier: null, log: () => {} })
      assert.equal(await identity.authenticate('Bearer ' + credential), memberId)
      await rejects(s.identity.authenticate('Bearer not-a-member-credential'), 'unauthenticated')
    })
    await check('schema migration: existing store keeps members and memories, gains member_identities', async () => {
      const file = path.join(dir, `legacy-${++serial}.sqlite`)
      fs.closeSync(fs.openSync(file, 'wx', 0o600))
      const db = new DatabaseSync(file)
      db.exec(`CREATE TABLE members(id TEXT PRIMARY KEY, credential_hash TEXT UNIQUE NOT NULL);
        CREATE TABLE memories(id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), body TEXT NOT NULL);
        CREATE INDEX memory_member ON memories(member_id);`)
      const credential = 'legacy-synthetic-credential'
      const hash = require('node:crypto').createHash('sha256').update(credential).digest('hex')
      db.prepare('INSERT INTO members VALUES(?,?)').run('legacy-member', hash)
      db.prepare('INSERT INTO memories VALUES(?,?,?)').run('mem-1', 'legacy-member', JSON.stringify({ id: 'mem-1', memberId: 'legacy-member', content: 'synthetic' }))
      db.close()
      const runtime = createMemberRuntime(file)
      assert.equal(runtime.authenticate('Bearer ' + credential), 'legacy-member')
      const check2 = new DatabaseSync(file)
      assert.equal(check2.prepare('SELECT COUNT(*) n FROM memories').get().n, 1)
      assert.equal(check2.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='member_identities'").get().n, 1)
      check2.close()
    })
  }

  // ── WEBSOCKET UPGRADE PROOF ──
  {
    const tA = token()
    const s = setup({ users: new Map([[tA, USER_A]]) })
    const up = h => s.identity.verifyUpgrade({ headers: h === undefined ? {} : { 'sec-websocket-protocol': h } })
    await check('9. WebSocket upgrade and HTTP resolve the same member for the same user', async () => {
      const viaHttp = await s.identity.authenticate('Bearer ' + tA)
      const viaWs = await up(`${SUBPROTOCOL}, ${tA}`)
      assert.deepEqual(viaWs, { memberId: viaHttp })
    })
    await check('upgrade without the persona subprotocol defers to existing paths (null)', async () => {
      assert.equal(await up(undefined), null)
      assert.equal(await up('chat'), null)
    })
    await check('upgrade with zero or several tokens is rejected', async () => {
      assert.deepEqual(await up(SUBPROTOCOL), { error: 'unauthenticated' })
      assert.deepEqual(await up(`${SUBPROTOCOL}, ${tA}, ${token()}`), { error: 'unauthenticated' })
    })
    await check('upgrade failures carry bounded codes', async () => {
      assert.deepEqual(await up(`${SUBPROTOCOL}, ${token()}`), { error: 'unauthenticated' })
      const tI = token({ sub: USER_INACTIVE })
      const s2 = setup({ users: new Map([[tI, USER_INACTIVE]]) })
      assert.deepEqual(await s2.identity.verifyUpgrade({ headers: { 'sec-websocket-protocol': `${SUBPROTOCOL}, ${tI}` } }), { error: 'membership_required' })
    })
    await check('only the fixed subprotocol is ever selected; the token is never echoed', async () => {
      assert.equal(selectProtocol(new Set([SUBPROTOCOL, tA])), SUBPROTOCOL)
      assert.equal(selectProtocol(new Set([tA])), false)
      assert.equal(selectProtocol(new Set(['chat'])), false)
    })
  }

  // ── SUPABASE VERIFIER WIRE CONTRACT ──
  {
    const tA = token()
    const seen = []
    const route = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
    let plan = []
    const verifier = createSupabaseVerifier({
      url: 'https://synthetic.supabase.test/', serviceKey: SERVICE_KEY, timeoutMs: 50,
      fetch: async (url, opts) => { seen.push({ url, headers: opts.headers }); const next = plan.shift(); return typeof next === 'function' ? next(opts) : next },
    })
    await check('verifier calls /auth/v1/user with the member token and the service key only as apikey', async () => {
      plan = [route(200, { id: USER_A, email: 'synthetic@example.test' })]
      assert.deepEqual(await verifier.user(tA), { id: USER_A })
      assert.equal(seen.at(-1).url, 'https://synthetic.supabase.test/auth/v1/user')
      assert.equal(seen.at(-1).headers.Authorization, 'Bearer ' + tA)
      assert.equal(seen.at(-1).headers.apikey, SERVICE_KEY)
    })
    await check('membership query reads memberships.status for exactly that user with the service role', async () => {
      plan = [route(200, [{ status: 'active' }])]
      assert.equal(await verifier.activeMembership(USER_A), true)
      assert.equal(seen.at(-1).url, `https://synthetic.supabase.test/rest/v1/memberships?select=status&user_id=eq.${USER_A}`)
      assert.equal(seen.at(-1).headers.Authorization, 'Bearer ' + SERVICE_KEY)
    })
    await check('membership must be exactly one active row', async () => {
      for (const [body, expected] of [[[], false], [[{ status: 'canceled' }], false], [[{ status: 'active' }, { status: 'active' }], false], [[null], false]]) {
        plan = [route(200, body)]
        assert.equal(await verifier.activeMembership(USER_A), expected)
      }
      plan = [route(200, { status: 'active' })]
      await rejects(verifier.activeMembership(USER_A), 'identity_unavailable')
      await rejects(verifier.activeMembership('not-a-uuid'), 'unauthenticated')
    })
    await check('Supabase 401/403 → unauthenticated; 5xx, network, timeout → identity_unavailable', async () => {
      plan = [route(401, 'raw-supabase-detail')]; await rejects(verifier.user(tA), 'unauthenticated')
      plan = [route(403, 'raw-supabase-detail')]; await rejects(verifier.user(tA), 'unauthenticated')
      plan = [route(500, 'raw-supabase-detail')]; await rejects(verifier.user(tA), 'identity_unavailable')
      plan = [() => { throw Error('ECONNRESET raw-network-detail') }]; await rejects(verifier.user(tA), 'identity_unavailable')
      plan = [opts => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' }))))]
      await rejects(verifier.user(tA), 'identity_unavailable')
      plan = [route(200, 'not json')]; await rejects(verifier.user(tA), 'unauthenticated')
    })
  }

  // ── LOG HYGIENE ──
  {
    const tA = token()
    const logs = []
    const runtime = createMemberRuntime(path.join(dir, `logs-${++serial}.sqlite`))
    const verifier = createSupabaseVerifier({ url: 'https://synthetic.supabase.test', serviceKey: SERVICE_KEY,
      fetch: async () => new Response('raw-supabase-provider-detail ' + SERVICE_KEY, { status: 502 }) })
    const identity = createMemberIdentity({ runtime, verifier, log: line => logs.push(line) })
    await rejects(identity.authenticate('Bearer ' + tA), 'identity_unavailable')
    await rejects(createMemberIdentity({ runtime, verifier: null, log: line => logs.push(line) }).authenticate('Bearer ' + tA), 'identity_unavailable')
    await check('17/18/19. logs carry bounded literals only: no token, no service key, no provider body', async () => {
      assert.ok(logs.length >= 2)
      const all = logs.join('\n')
      for (const secret of [tA, tA.split('.')[2], SERVICE_KEY, 'raw-supabase-provider-detail']) assert.ok(!all.includes(secret), 'leaked')
      for (const line of logs) assert.match(line, /^\[identity\] \{"component":"member-identity","failure":"[a-z_]+","status":\d+\}$/)
    })
  }

  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})()
