'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const compiler = require('./services/cadence-compiler');
const cadencePass1 = require('./services/cadence-pass1');
const policy = require('./services/release-policy');
const source = fs.readFileSync('server.js', 'utf8');
// Execute the actual production seam, not a copied implementation.
const seam = source.slice(source.indexOf('      function authorizeSegment(segment) {'),
  source.indexOf('      // Drive one stream, gating at every complete sentence.'));
assert.ok(seam.includes('function authorizeSegment'));
const tests = [];
const test = (name, fn) => tests.push({name, fn});
function run({persona = 'aline', flag, text = 'Keep **all** the details, including this qualifier.', compile = compiler.compile, prefix = ''} = {}) {
  const calls = [], evaluated = [];
  const context = {
    releasedText: '', spokenSoFar: prefix, turnProfile:null,
    cadenceEnabled: cadencePass1.isEnabled(persona, {ALINE_CADENCE_V1: flag}),
    cadencePass1: {compileCanonical: text => cadencePass1.compileCanonical(text, canonical => {
      calls.push(canonical); return compile(canonical);
    })},
    normalizeForSpeech: policy.normalizeForSpeech,
    evaluateReleaseSafe: text => { evaluated.push(text); return policy.evaluateReleaseSafe(text); },
  };
  vm.createContext(context);
  vm.runInContext(seam, context);
  return {auth: context.authorizeSegment(text), calls, evaluated};
}
test('flag defaults off and accepts only explicit 1', () => {
  for (const flag of [undefined, '', '0', 'true']) {
    const r = run({flag}); assert.equal(r.calls.length, 0); assert.equal(r.auth.approved, true);
    assert.equal(r.auth.spoken, 'Keep all the details, including this qualifier.');
  }
});
test('Aline invokes compiler after normalization; Chase and unknown stay baseline', () => {
  const r = run({flag:'1'}); assert.deepEqual(r.calls, [r.auth.spoken]);
  assert.equal(compiler.reconstruct(r.auth.cadence), r.auth.spoken);
  for (const persona of ['chase', 'unknown']) assert.equal(run({persona, flag:'1'}).calls.length, 0);
});
test('canonical cumulative lexical speech receives spoken authorization', () => {
  const r = run({flag:'1', prefix:'Earlier context.'});
  assert.equal(r.evaluated[1], `Earlier context. ${r.auth.spoken}`);
});
test('metadata approval cannot bypass spoken release policy', () => {
  const r = run({flag:'1', text:"I'm **not** qualified to help.", compile: text => ({...compiler.compile(text), approved:true})});
  assert.equal(r.auth.approved, false); assert.equal(r.auth.channel, 'spoken');
  assert.equal(r.evaluated[1], "I'm not qualified to help.");
  assert.equal(r.calls.length, 0, 'spoken rejection must not reach Cadence');
});
test('display rejection never reaches compiler', () => {
  const r = run({flag:'1', text:"I'm not qualified to help."});
  assert.equal(r.auth.approved, false); assert.equal(r.calls.length, 0);
});
test('malformed, throwing, reordered, deleted and altered plans fall back exactly', () => {
  const bad = [() => null, () => {throw Error('synthetic');}, () => ({segments:[]}),
    t => ({segments:[{text:t,start:1,end:t.length,boundary:'LAND'}]}),
    t => ({segments:[{text:t,start:0,end:t.length,boundary:'INVALID'}]}),
    t => compiler.compile(t.replace('including this qualifier', '')),
    t => compiler.compile(t.replace('all', 'some')),
    t => {const p=compiler.compile(t); p.segments.reverse(); return p;},
    t => {const p=compiler.compile(t); p.segments[0].text += ' '; return p;},
  ];
  const baseline = run();
  for (const compile of bad) {
    const r = run({flag:'1', compile});
    assert.equal(r.auth.cadence, null); assert.equal(r.auth.spoken, baseline.auth.spoken);
    assert.deepEqual(r.evaluated, baseline.evaluated); assert.equal(r.auth.approved, true);
  }
});
test('boundary vocabulary and contiguous UTF-16 spans reconstruct Unicode exactly', () => {
  const text = '🌱 Keep going because it matters, even now; remember: we can rest. Your turn';
  const p = compiler.compile(text, undefined, {maxWords:4,minWords:1,endOfTurn:true});
  assert.equal(compiler.reconstruct(p), text);
  let end=0;
  for (const part of p.segments) {assert.equal(part.start,end); assert.equal(text.slice(part.start,part.end),part.text); end=part.end;}
  assert.equal(end,text.length);
  for (const boundary of compiler.BOUNDARIES) assert.ok(p.segments.some(s => s.boundary===boundary), boundary);
  assert.ok(cadencePass1.compileCanonical(text));
});
test('production prompt selection is flag gated and Chase remains exact', () => {
  const config = source.slice(source.indexOf('  const cadenceEnabled ='), source.indexOf('  const voiceId =', source.indexOf('  const cadenceEnabled =')));
  for (const personaId of ['aline','chase']) for (const enabled of [false,true]) {
    const context={cadenceProfiles:require('./services/cadence-profiles'),personaId,SYSTEM_PROMPTS:{aline:'ALINE',chase:'CHASE'},cadencePass1:{...cadencePass1,isEnabled:p=>enabled && p==='aline'}};
    const prompt=vm.runInNewContext(config+'\nsystemPrompt',context);
    assert.equal(prompt,personaId.toUpperCase()+(enabled && personaId==='aline'?cadencePass1.COMPOSITION_RULES:''));
  }
});
let failed=0;
for (const {name,fn} of tests) {try {fn(); console.log('PASS '+name);} catch(e) {failed++;console.error('FAIL '+name+'\n'+e.stack);}}
console.log(`${tests.length-failed}/${tests.length} passed`); process.exitCode=failed?1:0;
