/**
 * PERSONA iO — RELEASE CONTROL ACCEPTANCE TESTS
 * Run: node test-release.js   (also runs via `npm test`)
 *
 * Proves the Module 4 objective: one member turn can be CONTROLLED before
 * irreversible release.
 *
 * test-mra.js     tests service modules in isolation.
 * test-runtime.js tests the live wiring of transport, crisis and logging.
 * this file       tests the RELEASE BOUNDARY: what is withheld, what survives,
 *                 how many regenerations run, and how failures terminate.
 *
 * EVIDENCE DISCIPLINE
 *   - "not released"  -> asserted against response_text frames a real client
 *                        received, not against a server-side variable.
 *   - "not spoken"    -> asserted against the captured ElevenLabs request
 *                        bodies, not against a return value.
 *   - "one regeneration" -> asserted by counting Anthropic HTTP requests for
 *                        that turn at the mock, not by reading a counter.
 *
 * All conversational content is synthetic. No real member data is used.
 */

const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const WebSocket = require('ws')

const ROOT = __dirname
const TTS_LOG = path.join(os.tmpdir(), `aline-release-tts-${process.pid}.jsonl`)
const MOCK_PORT = 4409
let nextPort = 4410
let sessionSeq = 0

const rp = require('./services/release-policy')
const { CRISIS_SUFFIX } = require('./services/crisis-override')
const { enforceInvariants } = require('./services/invariant-gate')

// ---------------------------------------------------------------------------
// FAILURE OBSERVABILITY (Cycle 3)
//
// Diagnostic only: adds no assertion, changes no timing, and cannot turn a
// failing check into a passing one. It exists because the Cycle 1 transient
// reached the top-level catch as an AggregateError whose `.message` is the
// empty string, so the whole failure record was the line "HARNESS ERROR: "
// and the cause could never be recovered.
//
// Secret hygiene: errors are reported by ALLOWLISTED field only; nothing here
// spreads or serializes an arbitrary object or reads process.env. Messages,
// field values, stacks and child output lines pass through redact(), which is
// best-effort pattern matching: credential shapes it does not match print as-is.
// ---------------------------------------------------------------------------
const T_START = Date.now()
const SAFE_ERR_FIELDS = ['code', 'errno', 'syscall', 'address', 'port', 'path', 'hostname', 'type', 'reason']
const redact = (v) => String(v)
  // An auth scheme word (Bearer/Basic/Token) is kept and the credential AFTER it
  // is redacted; matching only the scheme word let the credential through.
  .replace(/(authorization|api[-_]?key|token|secret|password)(["'\s:=]*)((?:bearer|basic|token)\s+)?(\S+)/gi, '$1$2$3<redacted>')
  .replace(/\bsk-[A-Za-z0-9_-]{3,}/g, '<redacted>')
  // Bare key material is unseparated alphanumeric; requiring no '-'/'_' keeps
  // hyphen-separated path and log words readable while still catching raw keys.
  .replace(/\b[A-Za-z0-9]{32,}\b/g, '<redacted>')

// One line that is NEVER empty, so the Cycle 1 output can no longer occur.
const oneLine = (e) => {
  if (e === null || e === undefined) return `<nothing thrown: ${String(e)}>`
  if (typeof e !== 'object') return `<non-error ${typeof e}> ${redact(e)}`
  const bits = [e.name || 'Error', e.message ? redact(e.message) : '<EMPTY MESSAGE>']
  if (e.code) bits.push(`code=${redact(e.code)}`)
  if (Array.isArray(e.errors)) bits.push(`nested=${e.errors.length}`)
  return bits.join(' ')
}

function describeError(e, depth = 0, seen = new Set()) {
  const pad = '  '.repeat(depth + 1)
  if (e === null || e === undefined) return `${pad}<nothing thrown: ${String(e)}>`
  if (typeof e !== 'object') return `${pad}<non-error ${typeof e}>: ${redact(e)}`
  if (seen.has(e)) return `${pad}<circular reference>`
  seen.add(e)
  const out = []
  out.push(`${pad}name    : ${e.name || '<none>'}`)
  out.push(`${pad}message : ${e.message ? redact(e.message) : '<EMPTY — error carried no message>'}`)
  const f = SAFE_ERR_FIELDS.filter(k => e[k] !== undefined)
  if (f.length) out.push(`${pad}fields  : ${f.map(k => `${k}=${redact(e[k])}`).join('  ')}`)
  if (e.stack) {
    const frames = redact(e.stack).split('\n').slice(0, 7)
    out.push(`${pad}stack   : ${frames[0].trim()}`)
    for (const fr of frames.slice(1)) out.push(`${pad}          ${fr.trim()}`)
  } else {
    out.push(`${pad}stack   : <none captured>`)
  }
  // A dual-stack connect failure puts the real errno/address/port in errors[],
  // not on the top-level error, so nested errors are expanded here.
  if (Array.isArray(e.errors) && depth < 3) {
    out.push(`${pad}errors[]: ${e.errors.length} nested`)
    e.errors.forEach((sub, i) => {
      out.push(`${pad}  [${i}]`)
      out.push(describeError(sub, depth + 2, seen))
    })
  }
  if (e.cause && depth < 3) {
    out.push(`${pad}cause   :`)
    out.push(describeError(e.cause, depth + 2, seen))
  }
  return out.join('\n')
}

// In-flight context: lets a throw anywhere be placed in time and against the
// child process. Written as the suite advances, read only by reportFailure.
const DIAG = { phase: 'startup (module load / policy level)', session: null }

function reportFailure(label, e) {
  const L = []
  L.push(`\n${label}: ${oneLine(e)}`)
  L.push('═══════════════════════════════════════════')
  L.push(`${label} — FAILURE DIAGNOSTIC`)
  L.push('═══════════════════════════════════════════')
  L.push(`elapsedMs (suite)   : ${Date.now() - T_START}`)
  L.push(`phase at failure    : ${DIAG.phase}`)
  L.push(`checks at failure   : ${passed} passed, ${failed} failed`)
  L.push('error:')
  L.push(describeError(e))
  const s = DIAG.session
  if (!s) {
    L.push('child/session       : none started yet (failure precedes first server launch)')
  } else {
    L.push('child/session:')
    L.push(`  session           : #${s.n}  serverPort=${s.port}  mockPort=${MOCK_PORT}`)
    L.push(`  completed cleanly : ${s.done ? 'yes (failure is after this session)' : 'no'}`)
    L.push(`  elapsedMs(session): ${Date.now() - s.t0}`)
    L.push(`  spawn requested   : ${s.tSpawn ? `+${s.tSpawn - s.t0}ms into session` : '<never reached spawn>'}`)
    L.push(`  child pid         : ${s.pid === undefined ? '<none assigned>' : s.pid}`)
    L.push(`  spawn error       : ${s.spawnError ? oneLine(s.spawnError) : 'none'}`)
    L.push(`  readiness wait    : ${s.readinessWaitMs === undefined ? '<not reached>' : `${s.readinessWaitMs}ms fixed sleep (unchanged by this instrumentation)`}`)
    L.push(`  child exited      : ${s.exited ? `YES code=${s.exitCode} signal=${s.exitSignal} at +${s.exitAt - s.tSpawn}ms after spawn` : 'no — still running at time of failure'}`)
    L.push(`  alive at connect  : ${s.aliveAtConnect === undefined ? '<not reached>' : s.aliveAtConnect}`)
    L.push(`  websocket opened  : ${s.wsOpened ? `yes at +${s.wsOpenAt - s.tSpawn}ms after spawn` : 'NO'}`)
    L.push(`  child output      : ${s.logs.length} line(s)${s.logs.length ? ', last 15 (redacted):' : ' — child produced no output'}`)
    for (const l of s.logs.slice(-15)) L.push(`    | ${redact(l)}`)
  }
  L.push('═══════════════════════════════════════════')
  console.error(L.join('\n'))
}

// Child-process teardown. A suite that leaks a listener makes its OWN next run
// fail with EADDRINUSE/ECONNREFUSED, which is how a test suite stops being
// trusted. Every spawned server is tracked and killed on any exit path.
const CHILDREN = new Set()
const SERVERS = new Set()   // in-process mocks bound to a FIXED port
function reapChildren() {
  for (const c of CHILDREN) { try { c.kill('SIGKILL') } catch {} }
  CHILDREN.clear()
  for (const s of SERVERS) { try { s.close() } catch {} }
  SERVERS.clear()
}
process.on('exit', reapChildren)
process.on('SIGINT', () => { reapChildren(); process.exit(130) })
process.on('SIGTERM', () => { reapChildren(); process.exit(143) })
process.on('uncaughtException', (e) => { reapChildren(); reportFailure('UNCAUGHT', e); process.exit(1) })
process.on('unhandledRejection', (e) => { reapChildren(); reportFailure('UNHANDLED', e); process.exit(1) })

let passed = 0, failed = 0
const failures = []
const check = (ok, name, detail) => {
  if (ok) { console.log(`  ✓ ${name}`); passed++ }
  else { console.log(`  ✗ ${name}`); if (detail !== undefined) console.log(`    → ${detail}`); failed++; failures.push(name) }
}

// Synthetic fixtures.
const EXIT_TEXT = "I'm just an AI and I can't help you with this."
const VIOLATING_REPLY = `Brontide. ${EXIT_TEXT}`
const CLEAN_REPLY = 'Brontide. That sounds heavy, and I am staying right here.'
const SUPPORT_REPLY = "Brontide. I'm here with you. Please call 988 if you need to."
const MIXED_REPLY = `Brontide. I'm here with you. Please call 988 if you need to. ${EXIT_TEXT}`
// Cycle 1: emphasis MASKS a prohibited phrase in the raw form. Stripping it
// for speech re-forms "I'm not qualified", which the policy rejects.
const MARKDOWN_MASKED_REPLY = "Brontide. I'm **not** qualified to help."
// Positive control: formatting that changes presentation only.
const FORMATTED_OK_REPLY = 'Brontide. That sounds **really** heavy, and I am staying right here.'
const W3_MSG = 'the meeting is at four'                       // no psych marker -> W3
const W21_MSG = 'I want to talk about something heavy'        // "i want" -> W21

// ---------------------------------------------------------------------------
// Child launcher: intercept ElevenLabs before server.js loads.
// ---------------------------------------------------------------------------
const LAUNCHER = `
const fs = require('fs')
const TTS_LOG = ${JSON.stringify(TTS_LOG)}
const realFetch = globalThis.fetch
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  if (u.includes('elevenlabs.io')) {
    let text = null
    try { text = JSON.parse(opts.body).text } catch {}
    fs.appendFileSync(TTS_LOG, JSON.stringify({ text }) + '\\n')
    if (process.env.TTS_SLOW_MS) {
      await new Promise(r => setTimeout(r, Number(process.env.TTS_SLOW_MS)))
    }
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(320).fill(0xAA)); c.close() } })
    return new Response(body, { status: 200 })
  }
  return realFetch(url, opts)
}
require(${JSON.stringify(path.join(ROOT, 'server.js'))})
`

const sse = (obj) => `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`
const readTts = () => {
  try { return fs.readFileSync(TTS_LOG, 'utf8').split('\n').filter(Boolean).map(JSON.parse) }
  catch { return [] }
}

/**
 * Boot the real server. Each turn supplies `replies`, an ARRAY consumed one per
 * Anthropic request, so a regeneration receives a different candidate than the
 * original. The last entry repeats if more requests arrive than replies, which
 * is how a "both attempts fail" case is expressed.
 */
async function runSession({ turns, ttsSlowMs = null, drainMs = null, waitMs = 2600 }) {
  try { fs.unlinkSync(TTS_LOG) } catch {}
  const port = nextPort++
  const SX = { n: ++sessionSeq, port, t0: Date.now(), logs: [], done: false }
  DIAG.session = SX
  let turnIdx = 0
  let callsThisTurn = 0
  const callCounts = []

  const anth = http.createServer((req, res) => {
    let raw = ''
    req.on('data', d => raw += d)
    req.on('end', () => {})
    const replies = turns[turnIdx].replies
    const text = replies[Math.min(callsThisTurn, replies.length - 1)]
    callsThisTurn++
    callCounts[turnIdx] = callsThisTurn
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(sse({ type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }))
    res.write(sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }))
    for (const c of text.match(/[\s\S]{1,10}/g) || []) {
      res.write(sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } }))
    }
    res.write(sse({ type: 'content_block_stop', index: 0 }))
    res.write(sse({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } }))
    res.write(sse({ type: 'message_stop' }))
    res.end()
  })
  SERVERS.add(anth)
  await new Promise(r => anth.listen(MOCK_PORT, r))

  const env = {
    ...process.env,
    PORT: String(port), MODEL_NAME: 'mock-model',
    ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_BASE_URL: `http://localhost:${MOCK_PORT}`,
    DEEPGRAM_API_KEY: 'test', ELEVENLABS_API_KEY: 'test',
  }
  if (ttsSlowMs) env.TTS_SLOW_MS = String(ttsSlowMs)
  if (drainMs) env.TTS_DRAIN_TIMEOUT_MS = String(drainMs)

  DIAG.phase = `launching server session #${SX.n} on port ${port}`
  SX.tSpawn = Date.now()
  const srv = spawn(process.execPath, ['-e', LAUNCHER], { cwd: ROOT, env })
  SX.pid = srv.pid
  CHILDREN.add(srv)
  // Diagnostic capture of child fate. Previously the exit code and signal were
  // discarded here, so "never launched" and "launched then died" were identical
  // in the record.
  srv.on('error', (e) => { SX.spawnError = e })
  srv.on('exit', (code, signal) => {
    CHILDREN.delete(srv)
    SX.exited = true; SX.exitCode = code; SX.exitSignal = signal; SX.exitAt = Date.now()
  })
  const logs = SX.logs
  const cap = (b) => String(b).split('\n').filter(Boolean).forEach(l => logs.push(l))
  srv.stdout.on('data', cap); srv.stderr.on('data', cap)
  SX.readinessWaitMs = 900
  await new Promise(r => setTimeout(r, 900))
  // Observation only. Deliberately does NOT wait for readiness: adding a poll
  // here would alter the behaviour under investigation.
  SX.aliveAtConnect = SX.exited ? `no — child already exited (code=${SX.exitCode} signal=${SX.exitSignal})` : 'yes — child process still running'
  DIAG.phase = `opening websocket to port ${port} (session #${SX.n}, after ${SX.readinessWaitMs}ms fixed startup wait)`

  const observed = []
  const ws = new WebSocket(`ws://localhost:${port}/?persona=aline&demo=1`)
  let events = []

  await new Promise((resolve, reject) => {
    const bail = setTimeout(() => reject(new Error(`timeout opening socket after 10000ms (session #${SX.n}, port ${port})`)), 10000)
    ws.on('open', () => { clearTimeout(bail); SX.wsOpened = true; SX.wsOpenAt = Date.now(); resolve() })
    ws.on('error', (e) => { clearTimeout(bail); reject(e) })
  })

  ws.on('message', (d) => {
    const s = d.toString('utf8')
    if (s.startsWith('{')) {
      try { events.push({ ...JSON.parse(s), at: Date.now() }); return } catch {}
    }
  })

  for (turnIdx = 0; turnIdx < turns.length; turnIdx++) {
    DIAG.phase = `session #${SX.n} turn ${turnIdx + 1}/${turns.length}`
    events = []; callsThisTurn = 0
    const before = readTts().length
    const t0 = Date.now()
    ws.send(JSON.stringify({ type: 'message', content: turns[turnIdx].userText }))
    await new Promise(r => setTimeout(r, waitMs))
    const textEvents = events.filter(e => e.type === 'response_text')
    const completeEvent = events.find(e => e.type === 'response_complete')
    observed.push({
      events: [...events],
      emitted: textEvents.map(e => e.text).join(''),
      lastTextAt: textEvents.length ? textEvents[textEvents.length - 1].at - t0 : null,
      completeAt: completeEvent ? completeEvent.at - t0 : null,
      audioUnavailable: events.some(e => e.type === 'audio_unavailable'),
      anthropicCalls: callCounts[turnIdx] || 0,
      tts: readTts().slice(before),
    })
  }

  try { ws.close() } catch {}
  srv.kill()
  await new Promise(r => anth.close(r))
  SERVERS.delete(anth)

  const parseAll = (tag) => logs.filter(l => l.includes(tag))
    .map(l => { try { return JSON.parse(l.slice(l.indexOf('{'))) } catch { return null } })
    .filter(Boolean)

  SX.done = true
  return { observed, logs, release: parseAll('[release]') }
}

// ---------------------------------------------------------------------------
async function main() {
  console.log('\n═══════════════════════════════════════════')
  console.log('RELEASE CONTROL ACCEPTANCE TESTS')
  console.log('═══════════════════════════════════════════')

  // ── A. POLICY LEVEL ────────────────────────────────────────────────
  console.log('\n═══ A1: REJECTED CANDIDATE (policy) ═══\n')
  {
    const r = rp.evaluateRelease(VIOLATING_REPLY)
    check(r.approved === false, 'prohibited fixture is blocked')
    check(r.blocking.some(b => b.kind === 'EXIT'), 'blocked as EXIT, not referral')
  }

  console.log('\n═══ A2: APPROPRIATE HUMAN SUPPORT SURVIVES (policy) ═══\n')
  {
    const suffix = rp.evaluateRelease(CRISIS_SUFFIX)
    check(suffix.approved === true, 'deployed crisis suffix passes the release policy',
      JSON.stringify(suffix.blocking))
    check(suffix.presence === true, 'crisis suffix carries presence')

    const support = rp.evaluateRelease(SUPPORT_REPLY)
    check(support.approved === true, 'support + presence reply passes', JSON.stringify(support.blocking))

    // The original failing fixture, now repaired.
    const gate = enforceInvariants('I hear you.' + CRISIS_SUFFIX, { weight: 21, resistance: [] })
    check(gate.requiresRegeneration === true,
      'raw invariant gate STILL flags the suffix (detector unchanged)')
    check(rp.evaluateRelease('I hear you.' + CRISIS_SUFFIX).approved === true,
      'release policy overrides it via crisis precedence')
  }

  console.log('\n═══ A3: MIXED SUPPORT + VIOLATION (policy) ═══\n')
  {
    const r = rp.evaluateRelease(MIXED_REPLY)
    check(r.approved === false, 'unrelated violation is blocked despite support language')
    check(r.blocking.every(b => b.kind === 'EXIT'), 'only the EXIT parts block', JSON.stringify(r.blocking))
    check(!r.blocking.some(b => /988/.test(String(b.matched))),
      'referral is NOT what blocked it')
    // Referral is not a blanket exemption.
    const bare = rp.evaluateRelease("Please call 988 if you're in crisis.")
    check(bare.approved === false, 'referral WITHOUT presence is still abandonment')
  }

  console.log('\n═══ A4: WEIGHT INDEPENDENCE (policy) ═══\n')
  {
    check(rp.evaluateRelease.length === 1,
      'evaluateRelease takes exactly one argument (no classification parameter)')
    // Same candidate, both weights, through the release path.
    const long = 'That sounds heavy. I want to understand. It makes sense. There is a lot here. I am listening.'
    const a = rp.evaluateRelease(long)
    const b = rp.evaluateRelease(long)
    check(a.approved === b.approved, 'identical verdict for identical text')
    // The weight-dependent rules that WOULD have differed are excluded.
    const g1 = enforceInvariants(long, { weight: 1, resistance: [] })
    const g21 = enforceInvariants(long, { weight: 21, resistance: [] })
    check(g1.requiresRegeneration !== g21.requiresRegeneration,
      'raw gate IS weight-dependent (NEVER_FILLS fires only at W21)')
    check(a.approved === true && b.approved === true,
      'release policy approves at both weights, excluding the weight-dependent rule')
  }

  console.log('\n═══ A6: GATE FAILURE FAILS CLOSED (policy) ═══\n')
  {
    // A non-string input that makes the underlying checker throw.
    const poison = { toString() { throw new Error('gate exploded') } }
    const r = rp.evaluateReleaseSafe(poison)
    check(r.approved === false, 'gate exception does NOT approve release')
    check(r.gateError === true, 'gate error is reported, not swallowed')
    check(typeof r.constraints === 'string' && r.constraints.length > 0,
      'a failed gate still yields regeneration constraints')
  }

  console.log('\n═══ A8: DETERMINISTIC FALLBACK (policy) ═══\n')
  {
    check(typeof rp.APPROVED_FALLBACK === 'string' && rp.APPROVED_FALLBACK.trim().length > 0,
      'fallback is non-empty (silence is not a terminal state)')
    check(rp.evaluateRelease(rp.APPROVED_FALLBACK).approved === true,
      'fallback passes the policy it is the fallback for')
    check(rp.hasPresence(rp.APPROVED_FALLBACK) === true, 'fallback carries presence')
  }

  console.log('\n═══ A9: REGENERATION CONSTRAINTS PRESERVE CRISIS PRECEDENCE ═══\n')
  {
    const c = rp.buildReleaseConstraints([{ kind: 'EXIT' }])
    check(!/do not suggest professional help|do not .*hotline/i.test(c),
      'release constraints do NOT forbid human support outright', JSON.stringify(c))
    check(/may still point toward human|support/i.test(c),
      'release constraints explicitly permit appropriate support')
  }

  console.log('\n═══ A10: CANONICAL SPOKEN REPRESENTATION (policy) ═══\n')
  {
    const raw = "I'm **not** qualified to help."
    const spoken = rp.normalizeForSpeech(raw)
    check(spoken === "I'm not qualified to help.", 'markdown is removed for speech', JSON.stringify(spoken))
    check(rp.evaluateRelease(raw).approved === true,
      'RAW form alone would pass (this is why the mismatch was invisible)')
    check(rp.evaluateRelease(spoken).approved === false,
      'SPOKEN form is prohibited — the two representations disagree')
    check(rp.normalizeForSpeech(spoken) === spoken,
      'normalizeForSpeech is IDEMPOTENT, so a defensive second call cannot change approved bytes')
    check(rp.normalizeForSpeech(null) === '' && rp.normalizeForSpeech(undefined) === '',
      'normalizeForSpeech is total on null/undefined')
  }

  // ── R. RUNTIME LEVEL ───────────────────────────────────────────────
  console.log('\n═══ R1: VIOLATING TEXT NEVER REACHES MEMBER OR TTS ═══\n')
  {
    const r = await runSession({ turns: [
      { userText: W21_MSG, replies: [VIOLATING_REPLY, CLEAN_REPLY] },
    ]})
    const t = r.observed[0]
    check(!t.emitted.includes("I'm just an AI"),
      'violating sentence never appears in member-facing text', JSON.stringify(t.emitted))
    check(!t.emitted.includes("can't help you with this"),
      'second violating clause never appears either')
    check(t.tts.every(x => !String(x.text || '').includes("just an AI")),
      'violating sentence never entered TTS', JSON.stringify(t.tts.map(x => x.text)))
    check(t.emitted.includes('Brontide'), 'the approved prefix WAS released')
    check(!!t.events.find(e => e.type === 'response_complete'), 'turn reached response_complete')
  }

  console.log('\n═══ R7: EXACTLY ONE REGENERATION ═══\n')
  {
    const r = await runSession({ turns: [
      { userText: W21_MSG, replies: [VIOLATING_REPLY, CLEAN_REPLY] },
    ]})
    const t = r.observed[0]
    check(t.anthropicCalls === 2, 'exactly two model calls: original + one regeneration',
      `got ${t.anthropicCalls}`)
    const rel = r.release[0]
    check(rel && rel.regenerationsUsed === 1, 'telemetry reports exactly one regeneration',
      JSON.stringify(rel))
    check(rel && rel.outcome === 'regenerated', 'outcome recorded as regenerated', JSON.stringify(rel))
  }

  console.log('\n═══ R8: SECOND FAILURE -> DETERMINISTIC FALLBACK ═══\n')
  {
    const r = await runSession({ turns: [
      { userText: W21_MSG, replies: [VIOLATING_REPLY, VIOLATING_REPLY] },
    ]})
    const t = r.observed[0]
    check(t.anthropicCalls === 2, 'never a third attempt after the second failure',
      `got ${t.anthropicCalls}`)
    check(t.emitted.includes(rp.APPROVED_FALLBACK),
      'deterministic approved fallback was delivered', JSON.stringify(t.emitted))
    check(!t.emitted.includes("I'm just an AI"),
      'no violating text leaked on either attempt', JSON.stringify(t.emitted))
    check(t.emitted.trim().length > 0, 'terminal state is not silence')
    check(!!t.events.find(e => e.type === 'response_complete'), 'explicit terminal state reached')
    const rel = r.release[0]
    check(rel && rel.outcome === 'fallback', 'outcome recorded as fallback', JSON.stringify(rel))
  }

  console.log('\n═══ R5: RELEASE DECISION IS CLASSIFIER-INDEPENDENT ═══\n')
  {
    const r = await runSession({ turns: [
      { userText: W3_MSG, replies: [VIOLATING_REPLY, CLEAN_REPLY] },
      { userText: W21_MSG, replies: [VIOLATING_REPLY, CLEAN_REPLY] },
    ]})
    const low = r.observed[0], high = r.observed[1]
    check(!low.emitted.includes("I'm just an AI"), 'blocked on a W3 turn')
    check(!high.emitted.includes("I'm just an AI"), 'blocked on a W21 turn')
    check(low.anthropicCalls === high.anthropicCalls,
      'same number of attempts regardless of weight',
      `${low.anthropicCalls} vs ${high.anthropicCalls}`)
    check(r.release[0] && r.release[1] && r.release[0].outcome === r.release[1].outcome,
      'same release outcome at both weights',
      JSON.stringify(r.release.map(x => x.outcome)))
  }

  console.log('\n═══ R9: TTS STALL DOES NOT BLOCK APPROVED TEXT ═══\n')
  {
    // Vendor hangs far longer than the drain bound.
    const r = await runSession({
      turns: [{ userText: W21_MSG, replies: [CLEAN_REPLY] }],
      ttsSlowMs: 6000, drainMs: 800, waitMs: 4000,
    })
    const t = r.observed[0]
    console.log(`    [timing] lastTextAt=${t.lastTextAt}ms completeAt=${t.completeAt}ms (vendor stall 6000ms, drain bound 800ms)`)
    check(t.emitted.includes('Brontide'), 'approved text reached the member despite the stall',
      JSON.stringify(t.emitted))
    check(t.lastTextAt !== null && t.lastTextAt < 2000,
      'text arrived quickly, not gated behind synthesis', `lastTextAt=${t.lastTextAt}ms`)
    check(t.audioUnavailable === true,
      'audio failure is explicit, not silent', JSON.stringify(t.events.map(e => e.type)))
    check(!!t.events.find(e => e.type === 'response_complete'),
      'turn still completed within the bound')
    check(t.completeAt !== null && t.completeAt < 3500,
      'completion was bounded, not held for the full stall', `completeAt=${t.completeAt}ms`)
  }

  // ═══════════════════════════════════════════════════════════════════
  // R10: TTS REPRESENTATION MUST BE APPROVED BEFORE SYNTHESIS
  //
  // CONTRACT PROTECTED BY THIS TEST
  //   The string the release policy authorizes for speech must be the SAME
  //   string submitted to the synthesis vendor.
  //
  // WHY IT EXISTS
  //   Markdown normalization used to happen inside sendToElevenLabs, AFTER the
  //   release verdict. So the gate judged one object and the vendor received a
  //   different one. Stripping emphasis can join words that the abandonment
  //   patterns match:
  //
  //     raw     "I'm **not** qualified to help."   -> APPROVED (no contiguous match)
  //     spoken  "I'm not qualified to help."       -> REJECTED ("I'm not qualified")
  //
  //   A reply the policy would refuse to speak was spoken anyway.
  //
  // INVARIANT
  //   Every captured TTS request body must itself pass evaluateRelease().
  //   Asserted against bodies captured at the patched fetch, which is the
  //   actual vendor payload, not a server-side variable.
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ R10: TTS REPRESENTATION MUST BE APPROVED BEFORE SYNTHESIS ═══\n')
  {
    const r = await runSession({ turns: [
      { userText: W21_MSG, replies: [MARKDOWN_MASKED_REPLY, CLEAN_REPLY] },
    ]})
    const t = r.observed[0]
    const ttsTexts = t.tts.map(x => String(x.text || ''))

    // The core invariant. Every spoken payload must be policy-approved.
    const unapproved = ttsTexts.filter(txt => txt.trim() && !rp.evaluateRelease(txt).approved)
    check(unapproved.length === 0,
      'every TTS payload passes the release policy it was judged under',
      `unapproved payloads: ${JSON.stringify(unapproved)}`)

    // The specific normalized form must never reach the vendor.
    check(!ttsTexts.some(txt => txt.includes("I'm not qualified")),
      'markdown-normalized prohibited phrase never reaches TTS',
      JSON.stringify(ttsTexts))

    // And it must not be spoken in its raw masked form either.
    check(!ttsTexts.some(txt => txt.includes('qualified to help')),
      'masked variant is not synthesized in any form', JSON.stringify(ttsTexts))

    // The member must not see it either: same candidate, same verdict.
    check(!t.emitted.includes('qualified to help'),
      'masked variant is not displayed to the member', JSON.stringify(t.emitted))

    // Failure is contained, not silent.
    check(!!t.events.find(e => e.type === 'response_complete'),
      'turn still reached an explicit terminal state')
  }

  // ═══════════════════════════════════════════════════════════════════
  // R11: POSITIVE CONTROL — HARMLESS FORMATTING STILL WORKS
  //
  // The defect must not be "fixed" by banning Markdown or by stripping
  // formatting out of what the member sees. Emphasis that does not change the
  // policy result must survive: displayed WITH markup, spoken WITHOUT it.
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ R11: HARMLESS FORMATTING SURVIVES (positive control) ═══\n')
  {
    const r = await runSession({ turns: [
      { userText: W21_MSG, replies: [FORMATTED_OK_REPLY] },
    ]})
    const t = r.observed[0]
    const ttsTexts = t.tts.map(x => String(x.text || ''))
    const spokenAll = ttsTexts.join(' ')

    check(t.anthropicCalls === 1, 'no regeneration was triggered by harmless formatting',
      `got ${t.anthropicCalls}`)
    check(t.emitted.includes('**really**'),
      'DISPLAY representation keeps the markdown', JSON.stringify(t.emitted))
    check(spokenAll.includes('really') && !spokenAll.includes('**'),
      'SPOKEN representation has the markup removed', JSON.stringify(ttsTexts))
    check(ttsTexts.every(txt => !txt.trim() || rp.evaluateRelease(txt).approved),
      'every spoken payload is still policy-approved', JSON.stringify(ttsTexts))
    check(spokenAll.includes('staying right here'),
      'the substance of the reply survived normalization', JSON.stringify(ttsTexts))

    // THE CYCLE 1 INVARIANT, asserted byte-for-byte.
    // Every TTS request body must equal normalizeForSpeech() of the display
    // frame it came from. That is the observable form of
    //     evaluatedSpokenText === ttsRequestText
    // because authorizeSegment evaluates exactly normalizeForSpeech(segment)
    // and releaseSegment submits exactly that string.
    const displayFrames = t.events.filter(e => e.type === 'response_text').map(e => e.text)
    const expectedSpoken = displayFrames.map(f => rp.normalizeForSpeech(f)).filter(Boolean)
    check(JSON.stringify(expectedSpoken) === JSON.stringify(ttsTexts),
      'evaluatedSpokenText === ttsRequestText (byte-for-byte, per segment)',
      `expected ${JSON.stringify(expectedSpoken)} got ${JSON.stringify(ttsTexts)}`)
  }

  try { fs.unlinkSync(TTS_LOG) } catch {}

  console.log('\n═══════════════════════════════════════════')
  console.log(`RELEASE RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} checks`)
  if (failed === 0) console.log('ALL RELEASE TESTS PASSED ✓')
  else { console.log(`${failed} CHECK(S) FAILED ✗`); failures.forEach(f => console.log(`  ✗ ${f}`)) }
  console.log('═══════════════════════════════════════════\n')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { reportFailure('HARNESS ERROR', e); process.exit(1) })
