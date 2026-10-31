'use strict';

// Synthetic fixtures only. Run: node test-cadence.js
const assert = require('node:assert/strict');
const { compile, segment, reconstruct } = require('./services/cadence-compiler');

const texts = (result) => result.segments.map((s) => s.text);
const words = (s) => s.split(/\s+/).filter(Boolean).length;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('exact reconstruction', () => {
  const inputs = [
    'Hello there. How are you?',
    '  Leading and trailing whitespace.  ',
    'Line one.\nLine two!\n\nLine three?  ',
    'Tabs\tand,  double  spaces; colons: fine — dashes too.',
    'Unicode “quotes” and café, naïve résumé.',
    'x',
    '',
  ];
  for (const input of inputs) {
    const result = compile(input);
    assert.equal(reconstruct(result), input, JSON.stringify(input));
    for (const seg of result.segments) assert.ok(seg.text.length > 0);
  }
});

test('Dr. abbreviation', () => {
  const input = 'Dr. Smith will see you now. Please wait.';
  assert.deepEqual(texts(compile(input)), ['Dr. Smith will see you now. ', 'Please wait.']);
  const plan = compile(input, ['Dr. ', 'Smith will see you now. Please wait.']);
  assert.equal(plan.source, 'fallback');
  assert.equal(plan.fallbackReason, 'plan_unsafe_boundary');
});

test('decimals', () => {
  const input = 'The dose is 2.5 mg. Take it twice daily.';
  const out = texts(compile(input));
  assert.deepEqual(out, ['The dose is 2.5 mg. ', 'Take it twice daily.']);
  assert.ok(out.every((s) => !/\d\.$/.test(s.trim())));
});

test('conditionals', () => {
  const input = 'If the pain gets worse, call your doctor.';
  const out = texts(compile(input));
  assert.deepEqual(out, ['If the pain gets worse, ', 'call your doctor.']);
});

test('negation', () => {
  const input = 'You should not, under any circumstances, stop the medication.';
  const out = texts(compile(input));
  assert.deepEqual(out, ['You should not, under any circumstances, ', 'stop the medication.']);
  for (const s of out) assert.ok(!/\b(not|never|no)[,]?\s*$/i.test(s), s);
  const plan = compile(input, ['You should not, ', 'under any circumstances, stop the medication.']);
  assert.equal(plan.source, 'fallback');
  const contraction = "I don't think that we should rush the recovery because the tissue still needs a lot more time to heal.";
  for (const s of texts(compile(contraction))) assert.ok(!/n't\s*$/.test(s), s);
});

test('quotations', () => {
  const input = 'She said, "Stop. Wait, please." Then she left.';
  const out = texts(compile(input));
  assert.deepEqual(out, ['She said, ', '"Stop. Wait, please." ', 'Then she left.']);
  for (const s of out) assert.equal((s.match(/"/g) || []).length % 2, 0, s);
  const curly = 'He wrote “do not stop, ever.” Then he slept.';
  assert.deepEqual(texts(compile(curly)), ['He wrote “do not stop, ever.” ', 'Then he slept.']);
});

test('parentheticals', () => {
  const input = 'Take the pill (one tablet, not two. Really) with water.';
  assert.deepEqual(texts(compile(input)), [input]);
  const two = 'Rest today (if you can). Walk tomorrow.';
  const out = texts(compile(two));
  assert.deepEqual(out, ['Rest today (if you can). ', 'Walk tomorrow.']);
  for (const s of out) assert.equal((s.match(/\(/g) || []).length, (s.match(/\)/g) || []).length, s);
});

test('dependent clauses', () => {
  const input = 'Although the results were promising, which surprised everyone, the team waited.';
  assert.deepEqual(texts(compile(input)), [
    'Although the results were promising, ',
    'which surprised everyone, ',
    'the team waited.',
  ]);
  const short = 'We left early because the road was closed.';
  assert.deepEqual(texts(compile(short)), [short]);
});

test('long explanatory sentence', () => {
  const input =
    'The reason we recommend a gradual increase in activity is that the body needs time to adapt to new demands ' +
    'because muscles and tendons strengthen at different rates and rushing the process often leads to injury.';
  const result = compile(input);
  const out = texts(result);
  assert.equal(reconstruct(result), input);
  assert.ok(out.length > 1);
  assert.deepEqual(out, [
    'The reason we recommend a gradual increase in activity is ',
    'that the body needs time to adapt to new demands ',
    'because muscles and tendons strengthen at different rates and rushing the process often leads to injury.',
  ]);
  for (const s of out) assert.ok(words(s) <= 16 && words(s) >= 4, s);
});

test('malformed-plan fallback', () => {
  const input = 'If it rains, we stay inside. "Stay dry," she said.';
  const expected = segment(input);
  const cases = [
    ['not an array', 'plan_not_array'],
    [{ segments: 'nope' }, 'plan_not_array'],
    [null, 'plan_not_array'],
    [[], 'plan_empty'],
    [['If it rains, ', '', 'we stay inside. "Stay dry," she said.'], 'plan_bad_segment'],
    [['If it rains, ', 42], 'plan_bad_segment'],
    [['If it rains, ', 'we stay inside.'], 'plan_not_lossless'],
    [['If it rains, we stay inside. "Stay ', 'dry," she said.'], 'plan_unsafe_boundary'],
    [['If it rains,', ' we stay inside. "Stay dry," she said.'], 'plan_unsafe_boundary'],
  ];
  for (const [plan, reason] of cases) {
    const result = compile(input, plan);
    assert.equal(result.source, 'fallback', JSON.stringify(plan));
    assert.equal(result.fallbackReason, reason, JSON.stringify(plan));
    assert.deepEqual(texts(result), expected);
    assert.equal(reconstruct(result), input);
  }
  const good = compile(input, { segments: ['If it rains, we stay inside. ', '"Stay dry," she said.'] });
  assert.equal(good.source, 'plan');
  assert.equal(good.fallbackReason, null);
  assert.equal(reconstruct(good), input);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message.split('\n').join('\n      ')}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
