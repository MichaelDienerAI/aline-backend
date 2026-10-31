'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const policy = require('./services/release-policy');
const cadence = require('./services/cadence-pass1');
const compiler = require('./services/cadence-compiler');
const source = fs.readFileSync('server.js', 'utf8');
const queue = source.slice(source.indexOf('      let ttsChain ='), source.indexOf('      const stream = await anthropic.messages.stream(streamConfig)'));
const sender = source.slice(source.indexOf('  async function sendToElevenLabs('), source.indexOf('  // ── MESSAGE HANDLER'));
const text = 'Keep the original file, because the backup may still be needed.';
async function run({ flag = '1', persona = 'aline', input = text, compile = compiler.compile, rejectSpoken = false } = {}) {
  const payloads = [], events = [], evaluations = [];
  let active = 0, peak = 0;
  const lifecycle = require('./services/speech-lifecycle').createSpeechLifecycle();
  const context = { speechLifecycle:lifecycle,turnToken:lifecycle.begin(),turnProfile:null,memberSession: null, ...policy, cadenceEnabled: cadence.isEnabled(persona, { ALINE_CADENCE_V1: flag }),
    cadencePass1: { compileCanonical: s => cadence.compileCanonical(s, compile) },
    evaluateReleaseSafe: s => { evaluations.push(s); return rejectSpoken && evaluations.length === 2 ? { approved: false } : policy.evaluateReleaseSafe(s); },
    voiceId: 'test', personaKey: persona, process: { env: { ELEVENLABS_API_KEY: 'synthetic' } },
    TTS_REQUEST_TIMEOUT_MS: 1000, AbortController, setTimeout, clearTimeout,
    WebSocket: { OPEN: 1 }, ws: { readyState: 1, send: () => {} }, console,
    sendTextTracked: async s => { events.push(JSON.parse(s)); return true; },
    fetch: async (_url, options) => {
      active++; peak = Math.max(peak, active); payloads.push(JSON.parse(options.body).text);
      let read = false;
      return { ok: true, body: { getReader: () => ({ read: async () => {
        await new Promise(r => setTimeout(r, 2));
        if (read) { active--; return { done: true }; }
        read = true; return { done: false, value: new Uint8Array([1, 0]) };
      } }) } };
    },
  };
  vm.createContext(context);
  vm.runInContext('let releasedText = "", spokenSoFar = "";\n' + sender + queue + '\nglobalThis.drive = async stream => { const result = await streamWithGate(stream); await ttsChain; return {result, spokenSoFar, ttsFailed}; };', context);
  async function* stream() { yield { type: 'content_block_delta', delta: { type: 'text_delta', text: input } }; }
  const result = await context.drive(stream());
  return { payloads, peak, events, evaluations, ...result };
}
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
test('flag OFF sends exactly one canonical sentence unit', async () => {
  for (const flag of ['0', undefined, 'true']) assert.deepEqual((await run({ flag: flag ?? '' })).payloads, [text]);
});
test('flag ON preserves exact groups, boundary whitespace and source order through actual vendor sender', async () => {
  const r = await run();
  assert.deepEqual(r.payloads, ['Keep the original file, ', 'because the backup may still be needed.']);
  assert.equal(r.payloads.join(''), text); assert.equal(r.spokenSoFar, text); assert.equal(r.peak, 1);
  assert.equal(r.ttsFailed, false); assert.equal(r.events.map(e => e.text).join(''), text);
});
test('multiple sentence groups and trailing fragment remain serial and ordered', async () => {
  const input = text + ' Check the copy, before deletion';
  const r = await run({ input });
  const expected = policy.takeCompleteSentences(input, true).sentences.flatMap(s => cadence.compileCanonical(policy.normalizeForSpeech(s)).segments.map(g => g.text));
  assert.deepEqual(r.payloads, expected); assert.equal(r.peak, 1);
});
test('normalization precedes compilation, authorization and unchanged TTS slices', async () => {
  const input = 'Keep the **original** file, because the backup may still be needed.';
  const r = await run({ input }); assert.equal(r.payloads.join(''), text); assert.equal(r.evaluations[1], text);
});
test('malformed, throwing, reordered and altered compiler output always falls back', async () => {
  for (const compile of [() => null, () => { throw Error('fault'); }, () => ({segments: []}),
    s => { const p = compiler.compile(s); p.segments.reverse(); return p; },
    s => { const p = compiler.compile(s); p.segments[0].text += ' changed'; return p; },
    s => { const p = compiler.compile(s); p.segments[0].boundary = 'BAD'; return p; }]) {
    assert.deepEqual((await run({ compile })).payloads, [text]);
  }
});
test('Chase and unknown personas retain one canonical sentence unit', async () => {
  for (const persona of ['chase', 'unknown']) assert.deepEqual((await run({ persona })).payloads, [text]);
});
test('display and spoken release failures prevent any synthesis or display', async () => {
  for (const config of [{input: "I'm not qualified to help."}, {input: "I'm **not** qualified to help."}, {rejectSpoken:true}]) {
    const r = await run(config); assert.equal(r.result.blocked, true); assert.deepEqual(r.payloads, []); assert.deepEqual(r.events, []);
  }
});
test('advisory pauseMs never delays or enters the vendor request', async () => {
  const r = await run({ compile: s => { const p = compiler.compile(s); for (const g of p.segments) g.pauseMs = 999999; return p; } });
  assert.equal(r.payloads.join(''), text);
});
test('crisis block and deterministic fallback call remain unchanged from pre-change snapshot', () => {
  const before = require('node:child_process').execFileSync('git', ['show', 'c99d01f490e23c957a426fe34a74ea6c37e3923a:server.js'], {encoding:'utf8'});
  const block = s => s.slice(s.indexOf('      let crisisActivated ='), s.indexOf('      // ── BOUNDED TTS DRAIN'));
  const cancellationOnly = block(source)
    .replace('      if (!speechLifecycle.current(turnToken)) return\n', '')
    .replace('sendToElevenLabs(crisisResult.crisisSuffix, voiceId, false, turnToken)', 'sendToElevenLabs(crisisResult.crisisSuffix, voiceId)');
  assert.equal(cancellationOnly, block(before));
  assert(block(source).includes('sendToElevenLabs(crisisResult.crisisSuffix, voiceId, false, turnToken)'));
  assert(source.includes('await releaseSegment(prefix + APPROVED_FALLBACK)'));
});
(async () => {
  let failed = 0;
  for (const {name,fn} of tests) { try { await fn(); console.log('PASS ' + name); } catch(e) { failed++; console.error('FAIL ' + name, e); } }
  console.log(`${tests.length-failed}/${tests.length} passed`); process.exitCode = failed ? 1 : 0;
})();
