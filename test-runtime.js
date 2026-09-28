/**
 * ALINE RUNTIME INTEGRATION TEST
 * Run: node test-runtime.js   (also runs via `npm test`)
 *
 * test-mra.js tests the service modules in isolation. This file tests the LIVE
 * server.js wiring: it boots the real server in a child process, mocks the
 * Anthropic stream (via ANTHROPIC_BASE_URL) and the ElevenLabs endpoint (via a
 * fetch patch installed before server.js loads), drives a real WebSocket, and
 * asserts on what was actually observable to the member.
 *
 * EVIDENCE DISCIPLINE — each claim is checked against direct evidence, never
 * against a metric derived from the same variable under test:
 *   - assistant history  → the NEXT turn's Anthropic request body, which is
 *                          literally conversationHistory serialised by the SDK.
 *                          (NOT [complete].chars, which is derived from
 *                          deliveredResponse — the variable being tested.)
 *   - suffix text        → the response_text frames received by a real client
 *   - audio streamed     → binary WebSocket frames counted on the client
 *   - TTS invocation     → request bodies captured at the patched fetch
 */

const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const WebSocket = require('ws')

const ROOT = __dirname
const TTS_LOG = path.join(os.tmpdir(), `aline-runtime-tts-${process.pid}.jsonl`)
const HIST_LOG = path.join(os.tmpdir(), `aline-runtime-hist-${process.pid}.jsonl`)
const sha16 = (str) => require('crypto').createHash('sha256').update(str).digest('hex').slice(0, 16)
const MOCK_PORT = 4309
let nextPort = 4310

const VOICE = { aline: 'knPeAXsHZ6FVdoLHMtRJ', chase: 'n6PxDvHhqw89qVi3Yao2' }
const SUFFIX = " I'm here with you. If you're in crisis, please reach out to 988."
const CRISIS_MSG = "I don't want to be here anymore"
const W21_NON_CRISIS = 'I never told anyone but when I was a kid my father abandoned us and it still haunts me'

let passed = 0, failed = 0
const failures = []
const check = (ok, name, detail) => {
  if (ok) { console.log(`  ✓ ${name}`); passed++ }
  else { console.log(`  ✗ ${name}`); if (detail !== undefined) console.log(`    → ${detail}`); failed++; failures.push(name) }
}

// Installed in the child before server.js loads, so the hardcoded ElevenLabs
// URL is intercepted without making server.js testable-by-modification.
const LAUNCHER = `
const fs = require('fs')
const TTS_LOG = ${JSON.stringify(TTS_LOG)}
const realFetch = globalThis.fetch
// Ordinary-response audio and crisis-suffix audio carry DIFFERENT byte
// signatures, so the client can prove the suffix itself produced audio rather
// than inferring it from a total byte count the main response already satisfies.
const SIG_ORDINARY = 0xAA
const SIG_SUFFIX = 0xBB
const chunk = (sig, n) => { const u = new Uint8Array(n); u.fill(sig); return u }
const bodyOf = (mode, sig) => {
  if (mode === 'zero') return new ReadableStream({ start(c) { c.enqueue(new Uint8Array(0)); c.close() } })
  if (mode === 'zerothenreal') return new ReadableStream({ start(c) { c.enqueue(new Uint8Array(0)); c.enqueue(chunk(sig, 320)); c.close() } })
  if (mode === 'errorafterpartial') {
    // Genuinely partial: the FIRST read resolves with real bytes; only a
    // SUBSEQUENT read fails. controller.error() inside start() would reject
    // the first read before any bytes were ever consumed.
    let served = 0
    return new ReadableStream({
      pull(c) {
        if (served === 0) { served = 1; c.enqueue(chunk(sig, 320)); return }
        c.error(new Error('stream aborted mid-flight'))
      },
    })
  }
  if (mode === 'emptybody') return new ReadableStream({ start(c) { c.close() } })
  return new ReadableStream({ start(c) { c.enqueue(chunk(sig, 320)); c.enqueue(chunk(sig, 320)); c.close() } })
}
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  if (u.includes('elevenlabs.io')) {
    let text = null
    try { text = JSON.parse(opts.body).text } catch {}
    const voiceId = (u.match(/text-to-speech\\/([^/]+)\\//) || [])[1] || null
    const targeted = !process.env.TTS_MATCH || (text && text.includes(process.env.TTS_MATCH))
    const mode = targeted ? (process.env.TTS_MODE || 'ok') : 'ok'
    fs.appendFileSync(TTS_LOG, JSON.stringify({ text, voiceId, mode }) + '\\n')
    if (process.env.TTS_SLOW_MS) await new Promise(r => setTimeout(r, Number(process.env.TTS_SLOW_MS)))
    if (mode === 'throw') throw new TypeError('fetch failed')
    if (mode === 'poisonthrow') {
      // Sentinels in EVERY error property the server ever logged.
      const e = new TypeError('SENTINELMESSAGE')
      e.name = 'SENTINELNAME'
      e.code = 'SENTINELCODE'
      e.cause = { body: 'SENTINELCAUSE' }
      e.requestBody = 'SENTINELPROP'
      throw e
    }
    if (mode === 'http500') return new Response('upstream boom', { status: 500, statusText: 'Internal Server Error' })
    if (mode === 'poisonhttp') {
      return new Response('SENTINELBODY', {
        status: 500, statusText: 'SENTINELSTATUSTEXT',
        headers: { 'request-id': 'SENTINELREQUESTID', 'x-thing': 'SENTINELHEADER' },
      })
    }
    const sig = (text && text.includes('988')) ? ${'0xBB'} : ${'0xAA'}
    return new Response(bodyOf(mode, sig), { status: 200 })
  }
  return realFetch(url, opts)
}
require(${JSON.stringify(path.join(ROOT, 'server.js'))})
`

const sse = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`

const readTts = () => {
  try { return fs.readFileSync(TTS_LOG, 'utf8').split('\n').filter(Boolean).map(JSON.parse) }
  catch { return [] }
}

/**
 * Boot the real server and run `turns` sequentially on ONE connection.
 * Returns per-turn observations plus every Anthropic request body seen.
 *
 * closeOnFirstText: close the client socket as soon as the first response_text
 * arrives, so crisis handling runs against a dead socket.
 */
async function runSession({ persona = 'aline', turns, ttsMode = null, ttsMatch = null, closeOnFirstText = false, ttsSlowMs = null, anthropicHttpPoison = false, anthropicUnreachable = false, waitMs = null }) {
  try { fs.unlinkSync(TTS_LOG) } catch {}
  try { fs.unlinkSync(HIST_LOG) } catch {}
  const port = nextPort++
  let turnIdx = 0
  const requests = []

  const anth = http.createServer((req, res) => {
    let raw = ''
    req.on('data', d => raw += d)
    req.on('end', () => { try { requests.push(JSON.parse(raw)) } catch {} })
    if (anthropicHttpPoison) {
      res.writeHead(500, 'ANTHSENTSTATUSTEXT', {
        'Content-Type': 'application/json',
        'request-id': 'ANTHSENTREQID',
        'x-extra': 'ANTHSENTHEADER',
      })
      return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'ANTHSENTBODY' } }))
    }
    const text = turns[turnIdx].reply
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
  await new Promise(r => anth.listen(MOCK_PORT, r))

  const env = {
    ...process.env,
    PORT: String(port), MODEL_NAME: 'mock-model',
    ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_BASE_URL: `http://localhost:${MOCK_PORT}`,
    DEEPGRAM_API_KEY: 'test', ELEVENLABS_API_KEY: 'test',
    ALINE_TEST_HISTORY_FILE: HIST_LOG,
  }
  if (ttsMode) env.TTS_MODE = ttsMode
  if (ttsMatch) env.TTS_MATCH = ttsMatch
  if (ttsSlowMs) env.TTS_SLOW_MS = String(ttsSlowMs)
  if (anthropicUnreachable) env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9'

  const srv = spawn(process.execPath, ['-e', LAUNCHER], { cwd: ROOT, env })
  const logs = []
  const cap = (b) => String(b).split('\n').filter(Boolean).forEach(l => logs.push(l))
  srv.stdout.on('data', cap); srv.stderr.on('data', cap)
  await new Promise(r => setTimeout(r, 900))

  const observed = []
  const ws = new WebSocket(`ws://localhost:${port}/?persona=${persona}&demo=1`)
  let events = [], audioFrames = [], timeline = [], closed = false

  await new Promise((resolve, reject) => {
    const bail = setTimeout(() => reject(new Error('timeout opening socket')), 10000)
    ws.on('open', () => { clearTimeout(bail); resolve() })
    ws.on('error', (e) => { clearTimeout(bail); reject(e) })
  })

  ws.on('message', (d) => {
    const s = d.toString('utf8')
    if (s.startsWith('{')) {
      try {
        const msg = JSON.parse(s)
        events.push(msg)
        timeline.push({ kind: 'json', type: msg.type, text: msg.text })
        if (closeOnFirstText && msg.type === 'response_text' && !closed) { closed = true; ws.terminate() }
        return
      } catch {}
    }
    audioFrames.push({ len: d.length, sig: d.length ? d[0] : null })
    timeline.push({ kind: 'audio', len: d.length, sig: d.length ? d[0] : null })
  })

  for (turnIdx = 0; turnIdx < turns.length; turnIdx++) {
    events = []; audioFrames = []; timeline = []
    const before = readTts().length
    ws.send(JSON.stringify({ type: 'message', content: turns[turnIdx].userText }))
    await new Promise(r => setTimeout(r, waitMs || (ttsSlowMs ? 4000 : 2300)))
    observed.push({
      events: [...events],
      emitted: events.filter(e => e.type === 'response_text').map(e => e.text).join(''),
      audioFrames: [...audioFrames],
      timeline: [...timeline],
      audioBytes: audioFrames.reduce((a, f) => a + f.len, 0),
      suffixAudioBytes: audioFrames.filter(f => f.sig === 0xBB).reduce((a, f) => a + f.len, 0),
      ordinaryAudioBytes: audioFrames.filter(f => f.sig === 0xAA).reduce((a, f) => a + f.len, 0),
      tts: readTts().slice(before),
    })
  }

  try { ws.close() } catch {}
  srv.kill()
  await new Promise(r => anth.close(r))

  const parseAll = (tag) => logs.filter(l => l.includes(tag))
    .map(l => { try { return JSON.parse(l.slice(l.indexOf('{'))) } catch { return null } })
    .filter(Boolean)

  let histSnapshots = []
  try { histSnapshots = fs.readFileSync(HIST_LOG, 'utf8').split('\n').filter(Boolean).map(JSON.parse) } catch {}

  return { observed, requests, logs, histSnapshots, crisis: parseAll('[crisis]'), complete: parseAll('[complete]') }
}

/** DIRECT history evidence: the assistant message replayed in the next request. */
const historyFrom = (requests, turnIndex) => {
  const req = requests[turnIndex + 1]
  if (!req) return null
  const assistants = req.messages.filter(m => m.role === 'assistant')
  return assistants.length ? assistants[assistants.length - 1].content : null
}

async function main() {
  console.log('\n═══ RUNTIME: EXPLICIT CRISIS ═══\n')
  {
    const r = await runSession({ turns: [
      { userText: CRISIS_MSG, reply: 'Zarquon. I hear you.' },
      { userText: 'and then what', reply: 'Mm.' },
    ]})
    const t = r.observed[0]
    const suffixEvents = t.events.filter(e => e.type === 'response_text' && e.text.includes('988'))
    const suffixIdx = t.events.findIndex(e => e.type === 'response_text' && e.text.includes('988'))
    const completeIdx = t.events.findIndex(e => e.type === 'response_complete')
    const suffixTts = t.tts.filter(x => x.text && x.text.includes('988'))

    check(suffixEvents.length === 1, 'suffix text frame received exactly once', `got ${suffixEvents.length}`)
    check(t.emitted === 'Zarquon. I hear you.' + SUFFIX, 'received text === response + suffix', JSON.stringify(t.emitted))
    check(suffixTts.length === 1, 'suffix TTS requested exactly once', `got ${suffixTts.length}`)
    check(suffixTts[0] && suffixTts[0].voiceId === VOICE.aline, 'suffix TTS used the aline voice', suffixTts[0] && suffixTts[0].voiceId)
    check(t.tts[t.tts.length - 1].text.includes('988'), 'suffix is the last TTS request')
    check(suffixIdx !== -1 && completeIdx !== -1 && suffixIdx < completeIdx, 'suffix frame precedes response_complete')
    // DIRECT audio evidence, per-source. 0xBB frames can ONLY come from the
    // suffix TTS call, so this cannot be satisfied by ordinary-response audio.
    check(t.ordinaryAudioBytes > 0, 'ordinary response produced audio (0xAA)', `bytes=${t.ordinaryAudioBytes}`)
    check(t.suffixAudioBytes > 0, 'CRISIS SUFFIX itself produced audio (0xBB)', `bytes=${t.suffixAudioBytes}`)
    const firstSuffixAudio = t.timeline.findIndex(x => x.kind === 'audio' && x.sig === 0xBB)
    const completeAt = t.timeline.findIndex(x => x.kind === 'json' && x.type === 'response_complete')
    check(firstSuffixAudio !== -1 && completeAt !== -1 && firstSuffixAudio < completeAt,
      'suffix AUDIO reached the socket before response_complete', `audio@${firstSuffixAudio} complete@${completeAt}`)
    check(t.audioFrames.every(f => f.len > 0), 'no zero-length audio frames delivered')
    // DIRECT history evidence: turn 2's request carries real conversationHistory.
    const hist = historyFrom(r.requests, 0)
    check(hist === t.emitted, 'conversationHistory === text the member received', `history=${JSON.stringify(hist)}`)
    check(hist && hist.includes('988'), 'history retains the crisis referral')
    const snap0 = r.histSnapshots[0]
    const asst0 = snap0 && snap0.filter(e => e.role === 'assistant').pop()
    check(asst0 && asst0.sha === sha16(t.emitted),
      'history fingerprint matches received text (independent of request replay)',
      asst0 && `got ${asst0.sha} want ${sha16(t.emitted)}`)
    check(r.crisis[0] && r.crisis[0].crisisActivated === true, 'telemetry: crisisActivated')
    check(r.crisis[0] && r.crisis[0].crisisTextSent === true, 'telemetry: crisisTextSent')
    check(r.crisis[0] && r.crisis[0].crisisAudioStreamed === true, 'telemetry: crisisAudioStreamed')
  }

  console.log('\n═══ RUNTIME: CLOSED SOCKET BEFORE SUFFIX ═══\n')
  {
    const r = await runSession({ closeOnFirstText: true, ttsSlowMs: 700, turns: [
      { userText: CRISIS_MSG, reply: 'Vermilion. I hear you. This keeps going for a while.' },
    ]})
    const t = r.observed[0]
    const c = r.crisis[0]
    const suffixEvents = t.events.filter(e => e.type === 'response_text' && e.text.includes('988'))
    check(suffixEvents.length === 0, 'no suffix frame received on a closed socket', `got ${suffixEvents.length}`)
    check(c && c.crisisTextSent === false, 'telemetry: crisisTextSent FALSE — no false send claim', c && JSON.stringify(c))
    check(c && c.crisisAudioStreamed === false, 'telemetry: crisisAudioStreamed FALSE')
    // DIRECT history evidence: SHA-256 fingerprint of the real
    // conversationHistory array. Not derived from deliveredResponse.
    const BASE = 'Vermilion. I hear you. This keeps going for a while.'
    const snap = r.histSnapshots[0]
    const assistant = snap && snap.filter(e => e.role === 'assistant').pop()
    check(!!assistant, 'history snapshot captured', JSON.stringify(snap))
    check(assistant && assistant.sha === sha16(BASE),
      'conversationHistory entry === base reply (unsent suffix EXCLUDED)',
      assistant && `got sha=${assistant.sha} len=${assistant.len}, want sha=${sha16(BASE)} len=${BASE.length}`)
    check(assistant && assistant.sha !== sha16(BASE + SUFFIX),
      'conversationHistory entry is NOT base+suffix')
  }

  console.log('\n═══ RUNTIME: CHASE PERSONA VOICE ═══\n')
  {
    const r = await runSession({ persona: 'chase', turns: [{ userText: CRISIS_MSG, reply: 'Plinth. I hear you.' }] })
    const t = r.observed[0]
    const suffixTts = t.tts.filter(x => x.text && x.text.includes('988'))
    check(suffixTts.length === 1, 'chase: suffix TTS requested once')
    check(suffixTts[0] && suffixTts[0].voiceId === VOICE.chase, 'chase: suffix TTS used the chase voice', suffixTts[0] && suffixTts[0].voiceId)
    check(t.tts.every(x => x.voiceId === VOICE.chase), 'chase: every TTS call used the chase voice')
    check(t.tts.every(x => x.voiceId !== VOICE.aline), 'chase: aline voice never used')
  }

  console.log('\n═══ RUNTIME: RESPONSE ALREADY CONTAINS 988 ═══\n')
  {
    const r = await runSession({ turns: [
      { userText: CRISIS_MSG, reply: 'Brontide. Please call 988 if you need to.' },
      { userText: 'ok', reply: 'Mm.' },
    ]})
    const t = r.observed[0]
    check((t.emitted.match(/988/g) || []).length === 1, 'exactly one 988 in received text', JSON.stringify(t.emitted))
    check(!t.emitted.includes('here with you'), 'no suffix appended')
    check(historyFrom(r.requests, 0) === t.emitted, 'history === received text')
    check(r.crisis[0] && r.crisis[0].crisisActivated === true, 'telemetry: still reported as crisis')
    check(r.crisis[0] && r.crisis[0].crisisTextSent === false, 'telemetry: crisisTextSent false (nothing extra sent)')
  }

  console.log('\n═══ RUNTIME: SUFFIX TTS HTTP FAILURE ═══\n')
  {
    const r = await runSession({ ttsMatch: '988', ttsMode: 'http500', turns: [
      { userText: CRISIS_MSG, reply: 'Quixotic. I hear you.' },
      { userText: 'ok', reply: 'Mm.' },
    ]})
    const t = r.observed[0]
    check(t.emitted.includes(SUFFIX), 'suffix TEXT still received despite TTS failure')
    check(r.crisis[0] && r.crisis[0].crisisTextSent === true, 'telemetry: crisisTextSent true')
    check(r.crisis[0] && r.crisis[0].crisisAudioStreamed === false, 'telemetry: crisisAudioStreamed FALSE on HTTP failure')
    check(historyFrom(r.requests, 0) === t.emitted, 'history === received text (suffix retained)')
    check(t.events.some(e => e.type === 'response_complete'), 'turn still completes')
  }

  console.log('\n═══ RUNTIME: SUFFIX TTS TRANSPORT FAILURE ═══\n')
  {
    const r = await runSession({ ttsMatch: '988', ttsMode: 'throw', turns: [{ userText: CRISIS_MSG, reply: 'Sarsaparilla. I hear you.' }] })
    check(r.observed[0].emitted.includes(SUFFIX), 'suffix TEXT still received despite transport failure')
    check(r.crisis[0] && r.crisis[0].crisisAudioStreamed === false, 'telemetry: crisisAudioStreamed FALSE on transport failure')
  }

  console.log('\n═══ RUNTIME: ZERO-BYTE AUDIO ═══\n')
  {
    const r = await runSession({ ttsMatch: '988', ttsMode: 'zero', turns: [{ userText: CRISIS_MSG, reply: 'Gallimaufry. I hear you.' }] })
    check(r.crisis[0] && r.crisis[0].crisisAudioStreamed === false, 'all-zero-byte stream reports NO audio streamed', r.crisis[0] && JSON.stringify(r.crisis[0]))
    check(r.crisis[0] && r.crisis[0].crisisTextSent === true, 'text still reported as sent')
  }
  {
    const r = await runSession({ ttsMatch: '988', ttsMode: 'emptybody', turns: [{ userText: CRISIS_MSG, reply: 'Xylem. I hear you.' }] })
    check(r.crisis[0] && r.crisis[0].crisisAudioStreamed === false, 'empty body reports NO audio streamed')
  }
  {
    const r = await runSession({ ttsMatch: '988', ttsMode: 'zerothenreal', turns: [{ userText: CRISIS_MSG, reply: 'Tureen. I hear you.' }] })
    check(r.crisis[0] && r.crisis[0].crisisAudioStreamed === true, 'zero-byte chunk followed by real audio DOES count')
    check(r.observed[0].suffixAudioBytes > 0, 'suffix-signature audio bytes reached the client', `bytes=${r.observed[0].suffixAudioBytes}`)
  }
  {
    const r = await runSession({ ttsMatch: '988', ttsMode: 'errorafterpartial', turns: [{ userText: CRISIS_MSG, reply: 'Pellucid. I hear you.' }] })
    // The fixture must be genuinely partial: bytes delivered, THEN a failed read.
    check(r.observed[0].suffixAudioBytes > 0,
      'fixture is genuinely partial — suffix bytes DID reach the socket', `bytes=${r.observed[0].suffixAudioBytes}`)
    check(r.crisis[0] && r.crisis[0].crisisAudioStreamed === false,
      'partial audio emitted but stream incomplete → reports NOT streamed')
  }

  console.log('\n═══ RUNTIME: TRAILING-WHITESPACE RESPONSE ═══\n')
  {
    // crisisOverride returns a trimEnd()'d modifiedResponse. History must follow
    // the ORIGINAL streamed bytes, not the trimmed copy.
    const r = await runSession({ turns: [
      { userText: CRISIS_MSG, reply: 'Nychthemeron. I am here. \n' },
      { userText: 'ok', reply: 'Mm.' },
    ]})
    const t = r.observed[0]
    check(t.emitted === 'Nychthemeron. I am here. \n' + SUFFIX, 'received text preserves trailing whitespace + suffix', JSON.stringify(t.emitted))
    check(historyFrom(r.requests, 0) === t.emitted, 'history === received text EXACTLY (no trimEnd drift)', JSON.stringify(historyFrom(r.requests, 0)))
  }

  console.log('\n═══ RUNTIME: W21 NON-CRISIS ═══\n')
  {
    const r = await runSession({ turns: [
      { userText: W21_NON_CRISIS, reply: 'Wapentake. That took courage.' },
      { userText: 'ok', reply: 'Mm.' },
    ]})
    const t = r.observed[0]
    check(!t.emitted.includes('988'), 'no suffix for a non-crisis W21 disclosure')
    check(r.crisis[0] && r.crisis[0].weight === 21, 'classified W21', r.crisis[0] && r.crisis[0].weight)
    check(r.crisis[0] && r.crisis[0].crisisActivated === false, 'telemetry: crisisActivated false')
    check(historyFrom(r.requests, 0) === t.emitted, 'history === received text')
  }

  console.log('\n═══ RUNTIME: ANTHROPIC FAILURE SENTINEL INJECTION ═══\n')
  const ANTH_SENTINELS = ['ANTHSENTMESSAGE','ANTHSENTREQID','ANTHSENTSTATUSTEXT','ANTHSENTBODY','ANTHSENTHEADER']
  {
    // Provider returns an HTTP error whose body/statusText/headers/request-id all carry sentinels.
    const r = await runSession({ anthropicHttpPoison: true, turns: [{ userText: CRISIS_MSG, reply: 'unused' }] })
    const hits = []
    ANTH_SENTINELS.forEach(x => r.logs.forEach(l => { if (l.includes(x)) hits.push(`${x} :: ${l}`) }))
    check(hits.length === 0, 'anthropic HTTP error: no sentinel from body/statusText/headers/request-id', hits.join(' | '))
    check(r.logs.some(l => l.includes('anthropic_generation_failure')), 'anthropic HTTP error: bounded category logged')
    check(r.logs.some(l => l.includes('"status":500')), 'anthropic HTTP error: validated numeric status retained')
    check(r.observed[0].events.some(e => e.type === 'error'), 'client still receives the generic error message')
    check(!r.logs.some(l => l.toLowerCase().includes("don't want to be here")), 'anthropic error path leaks no user text')
  }
  {
    // The SDK does NOT route through globalThis.fetch, so a synthetic error
    // object cannot be injected from outside. Use a REAL transport failure
    // (unreachable upstream) to exercise the same catch.
    const r = await runSession({ anthropicUnreachable: true, waitMs: 12000, turns: [{ userText: CRISIS_MSG, reply: 'unused' }] })
    check(r.logs.some(l => l.includes('anthropic_generation_failure')), 'anthropic transport error: bounded category logged',
      r.logs.join(' | ').slice(0, 300))
    const leak = r.logs.filter(l => /ECONNREFUSED|APIConnectionError|Connection error|    at /.test(l))
    check(leak.length === 0, 'anthropic transport error: no raw error text or stack in logs', leak.join(' | '))
  }
  {
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8')
    const genPath = /console\.[a-z]+\(`\[\$\{personaId\}\] Anthropic error/.test(src)
    check(!genPath, 'server.js: raw Anthropic error log removed')
    check(!/console\.[a-z]+\([^)]*\] Error:`, err\)/.test(src), 'server.js: raw generateResponse rejection logs removed')
    // Allowlist guard on production source: inside the [anthropic] failure logs
    // the ONLY permitted reference to `err` is safeStatus(err && err.status).
    const blocks = [...src.matchAll(/console\.error\(`\[anthropic\] \$\{JSON\.stringify\(\{([\s\S]*?)\}\)\}`\)/g)].map(m => m[1])
    check(blocks.length === 3, 'found all three bounded anthropic log sites', `found ${blocks.length}`)
    const errRefs = blocks.flatMap(b => [...b.matchAll(/err[^,\n]*/g)].map(x => x[0].trim()))
    check(errRefs.length === 1 && errRefs[0] === 'err && err.status)',
      'anthropic logs reference `err` ONLY inside safeStatus(err && err.status)', JSON.stringify(errRefs))
  }

  console.log('\n═══ RUNTIME: FAILURE-PATH SENTINEL INJECTION ═══\n')
  const SENTINELS = ['SENTINELMESSAGE','SENTINELNAME','SENTINELCODE','SENTINELCAUSE',
                     'SENTINELPROP','SENTINELBODY','SENTINELSTATUSTEXT','SENTINELREQUESTID','SENTINELHEADER']
  {
    const r = await runSession({ ttsMatch: '988', ttsMode: 'poisonthrow', turns: [{ userText: CRISIS_MSG, reply: 'Ziggurat. I hear you.' }] })
    const hits = []
    SENTINELS.forEach(x => r.logs.forEach(l => { if (l.includes(x)) hits.push(`${x} :: ${l}`) }))
    check(hits.length === 0, 'transport error: no sentinel from name/code/message/cause/props', hits.join(' | '))
    check(r.logs.some(l => l.includes('elevenlabs_transport_failure')), 'transport error: bounded category logged')
    check(r.crisis[0] && r.crisis[0].crisisAudioStreamed === false, 'transport error: audio reported false')
  }
  {
    const r = await runSession({ ttsMatch: '988', ttsMode: 'poisonhttp', turns: [{ userText: CRISIS_MSG, reply: 'Kerfuffle. I hear you.' }] })
    const hits = []
    SENTINELS.forEach(x => r.logs.forEach(l => { if (l.includes(x)) hits.push(`${x} :: ${l}`) }))
    check(hits.length === 0, 'http error: no sentinel from body/statusText/headers/request-id', hits.join(' | '))
    check(r.logs.some(l => l.includes('elevenlabs_http_failure')), 'http error: bounded category logged')
    check(r.logs.some(l => l.includes('"status":500')), 'http error: validated numeric status retained')
  }
  {
    // Static guard: no console.* call may reference a provider-controlled value.
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8')
    const forbidden = [/console\.[a-z]+\([^)]*err\.name/, /console\.[a-z]+\([^)]*err\.code/,
                       /console\.[a-z]+\([^)]*err\.message/, /console\.[a-z]+\([^)]*statusText/,
                       /console\.[a-z]+\([^)]*headers\.get/]
    const found = forbidden.filter(re => re.test(src)).map(String)
    check(found.length === 0, 'server.js: no console call references err.name/code/message/statusText/headers', found.join(' | '))
  }

  console.log('\n═══ RUNTIME: FAILURE-PATH LOG PRIVACY ═══\n')
  {
    // A provider error whose name/message carries request content must not reach logs.
    const r = await runSession({ ttsMatch: '988', ttsMode: 'throw', turns: [{ userText: CRISIS_MSG, reply: 'Obfuscate. I hear you.' }] })
    const sentinels = ['obfuscate', "don't want to be here", 'here with you', 'reach out to 988', 'fetch failed']
    const hits = []
    sentinels.forEach(s => r.logs.forEach(l => { if (l.toLowerCase().includes(s.toLowerCase())) hits.push(`${s} :: ${l}`) }))
    check(hits.length === 0, 'no user text, assistant text, suffix, or raw provider message in logs', hits.join(' | '))
  }

  try { fs.unlinkSync(TTS_LOG) } catch {}
  try { fs.unlinkSync(HIST_LOG) } catch {}

  console.log('\n═══════════════════════════════════════════')
  console.log(`RUNTIME RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} checks`)
  if (failed === 0) console.log('ALL RUNTIME TESTS PASSED ✓')
  else { console.log(`${failed} CHECK(S) FAILED ✗`); failures.forEach(f => console.log(`  ✗ ${f}`)) }
  console.log('═══════════════════════════════════════════\n')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => { console.error('FATAL:', err); process.exit(1) })
