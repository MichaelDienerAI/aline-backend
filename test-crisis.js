'use strict';

const assert = require('node:assert/strict');
const { analyzeMessage } = require('./services/classifier');
const { crisisOverride, CRISIS_SUFFIX } = require('./services/crisis-override');
const { evaluateRelease } = require('./services/release-policy');

const POSITIVES = [
  'If she leaves me, I will kill myself tonight.',
  'I will kill myself.',
  'I intend to end my life.',
  'I plan to commit suicide.',
  'I am going to hurt myself tonight.',
  "I'm about to harm myself.",
  'I want to take my own life.',
  "I'll end my life tonight.",
  'IF SHE LEAVES ME, I WILL KILL MYSELF TONIGHT',
  'If she leaves me then I will kill myself tonight',
  'I’m going to end my life tonight.',
  'These people are upsetting me, and I will kill myself tonight.',
  'I will not kill myself, but I will hurt myself tonight.',
  'Last year I felt different. I will kill myself tonight.',
  'Last year I was fine, but I will kill myself tonight.',
  'I will seriously hurt myself tonight.',
  'I will kill myself tonight if she leaves me.',
  'If she leaves me I will kill myself tonight.',
];
const NEGATIVES = [
  ['mundane', 'I want a sandwich.'],
  ['third person', 'She intends to end her life tonight.'],
  ['historical', 'Last year I wanted to kill myself.'],
  ['past event', 'Years ago, I planned to commit suicide.'],
  ['fiction', 'In a story, I will kill myself tonight.'],
  ['hypothetical discussion', 'Hypothetically, I will kill myself tonight.'],
  ['what-if discussion', 'What if I will kill myself in a fictional example?'],
  ['reported conditional', 'If someone says I will kill myself tonight, should I call 988?'],
  ['quotation', 'He said "I will kill myself tonight."'],
  ['curly quotation', 'She said “I want to kill myself.”'],
  ['single quotation', "He said 'I will kill myself tonight.'"],
  ['high-weight quotation', 'I am reading the line "I want to kill myself."'],
  ['resources', 'I want information about the 988 crisis line.'],
  ['negation', 'I am not going to kill myself.'],
  ['negated desire', "I don't want to die."],
  ['negated future', 'I will not kill myself.'],
  ['ambiguous distress', 'This is a difficult day.'],
];

async function override(message, classification = analyzeMessage(message), response = 'I am here.') {
  const log = console.log;
  console.log = () => {};
  try {
    return await crisisOverride({ userMessage: message, classification, response, sessionId: null });
  } finally { console.log = log; }
}

async function runCrisisTests(test) {
  for (const message of POSITIVES) {
    await test(`explicit intent: ${message}`, async () => {
      const actual = await override(message);
      assert.equal(actual.override, true);
      assert.equal(actual.crisisSuffix, CRISIS_SUFFIX);
      // Both ends of the weight range must produce the same routing decision.
      for (const weight of [1, 3, 21]) {
        assert.equal((await override(message, { weight, dimensions: [] })).override, true);
      }
    });
  }
  for (const [category, message] of NEGATIVES) {
    await test(`negative ${category}: ${message}`, async () => {
      const result = await override(message);
      assert.equal(result.override, false);
      assert.equal(result.modifiedResponse, 'I am here.');
    });
  }
  await test('classifier semantics unchanged for regression and mundane fixture', () => {
    assert.equal(analyzeMessage(POSITIVES[0]).weight, 3);
    assert.equal(analyzeMessage(NEGATIVES[0][1]).weight, 21);
  });
  await test('legacy W21 distress still appends presence plus referral', async () => {
    assert.equal((await override("I don't want to be here anymore")).crisisSuffix, CRISIS_SUFFIX);
  });
  await test('explicit intent with existing referral does not append twice', async () => {
    const result = await override(POSITIVES[0], undefined, 'I am here. Please call 988.');
    assert.equal(result.override, true);
    assert.equal(result.crisisSuffix, null);
  });
  await test('release policy permits presence with referral but blocks referral alone', () => {
    assert.equal(evaluateRelease('Please call 988.').approved, false);
    assert.equal(evaluateRelease('I am here with you. Please call 988.').approved, true);
    assert.equal(evaluateRelease(CRISIS_SUFFIX).approved, true);
  });
}

module.exports = { runCrisisTests };
if (require.main === module) {
  let passed = 0, failed = 0;
  runCrisisTests(async (name, fn) => {
    try { await fn(); passed++; console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
  }).then(() => {
    console.log(`Crisis regressions: ${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
