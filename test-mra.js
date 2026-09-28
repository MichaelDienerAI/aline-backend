/**
 * ALINE MRA VALIDATION TEST
 * Run: node test-mra.js
 * Tests classifier + invariant gate + crisis override against known inputs
 *
 * Contract note (Step 0 repair):
 *   This suite asserts the contracts the modules export TODAY.
 *   - classifier.classifyMessage() returns { weight, dimension, isNoise, dimensions,
 *     confessionDepth, isMultiDimensional }. It does NOT return mood or resistance;
 *     use analyzeMessage() / detectMood() / detectResistance() for those.
 *   - buildSystemPrompt() lives in prompt-engine.js, not invariant-gate.js.
 *   - generateABTLogline() returns an object { and, but, therefore, weight }, not a string.
 *   - Response-length budgeting is expressed as prose via prompt-engine.getLengthConstraint()
 *     and enforced by invariant-gate NEVER_FILLS. There is no numeric maxTokens property.
 */

const {
  classifyMessage,
  analyzeMessage,
  detectMood,
  detectResistance,
  generateABTLogline,
} = require('./services/classifier');
const { enforceInvariants } = require('./services/invariant-gate');
const { buildSystemPrompt, getLengthConstraint } = require('./services/prompt-engine');
const { crisisOverride, CRISIS_SUFFIX } = require('./services/crisis-override');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    → ${e.message}`);
    failed++;
    failures.push({ name, message: e.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Silence module-internal console.log (crisis-override logs every call) so the
// results table stays readable. Suppresses logging only — never assertions.
async function quiet(fn) {
  const real = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = real;
  }
}

async function main() {
// ═══════════════════════════════════════════════════════════
console.log('\n═══ CLASSIFIER TESTS ═══\n');

console.log('Weight Assignment:');
await test('W1: "hey" → noise', () => {
  const r = classifyMessage('hey');
  assert(r.weight === 1, `Expected W1, got W${r.weight}`);
  assert(r.isNoise === true, 'Should be noise');
});

await test('W1: "what\'s the weather like" → noise', () => {
  const r = classifyMessage("what's the weather like");
  assert(r.weight === 1, `Expected W1, got W${r.weight}`);
});

await test('W3: "I went to the store today" → context', () => {
  const r = classifyMessage('I went to the store today');
  assert(r.weight === 3, `Expected W3, got W${r.weight}`);
  assert(r.dimension === 'context', `Expected context, got ${r.dimension}`);
});

await test('W8: "I feel so tired and drained" → physiology', () => {
  const r = classifyMessage('I feel so tired and drained');
  assert(r.weight >= 8, `Expected W8+, got W${r.weight}`);
});

await test('W13: "My ex cheated and I still think about it" → sociology', () => {
  const r = classifyMessage('My ex cheated and I still think about it');
  assert(r.weight >= 13, `Expected W13+, got W${r.weight}`);
  assert(r.dimensions.some(d => d.type === 'sociology'), 'Should detect sociology');
});

await test('W21: "I\'m afraid I\'ll end up alone like my mother" → psychology + sociology', () => {
  const r = classifyMessage("I'm afraid I'll end up alone like my mother");
  assert(r.weight >= 13, `Expected W13+, got W${r.weight}`);
  assert(r.dimensions.some(d => d.type === 'psychology'), 'Should detect psychology');
});

await test('Covenant depth: "I never told anyone this but as a kid my father..." → W21', () => {
  const r = classifyMessage("I never told anyone this but when I was a kid my father abandoned us and it still haunts me");
  assert(r.confessionDepth.isCovenant === true, 'Should trigger Covenant depth');
  assert(r.weight === 21, `Expected W21, got W${r.weight}`);
});

console.log('\nMood Detection:');
await test('Celebration: "I got the job!" → JOYFUL', () => {
  const mood = detectMood('Oh my god I got the job!');
  assert(mood.mode === 'JOYFUL', `Expected JOYFUL, got ${mood.mode}`);
});

await test('Emotional: "I feel so lost" → CONFIDANTE', () => {
  const mood = detectMood('I feel so lost right now');
  assert(mood.mode === 'CONFIDANTE', `Expected CONFIDANTE, got ${mood.mode}`);
});

await test('Playful: "you\'re so beautiful" → WARM_PLAYFUL', () => {
  const mood = detectMood("you're so beautiful");
  assert(mood.mode === 'WARM_PLAYFUL', `Expected WARM_PLAYFUL, got ${mood.mode}`);
});

await test('analyzeMessage surfaces mood + resistance alongside weight', () => {
  const r = analyzeMessage('I feel so lost right now');
  assert(typeof r.weight === 'number', 'Should carry weight');
  assert(r.mood && typeof r.mood.mode === 'string', 'Should carry mood');
  assert(Array.isArray(r.resistance), 'Should carry resistance array');
});

console.log('\nResistance Detection:');
await test('Critical deflection: "I don\'t want to talk about that"', () => {
  const resistance = detectResistance("I don't want to talk about that");
  assert(resistance.length > 0, 'Should detect resistance');
  assert(resistance[0].weight === 'critical', 'Should be critical weight');
  // Successor to the removed responseMode === 'BOUNDARY_HONOR' contract.
  assert(
    resistance[0].action === 'immediate_retreat',
    `Expected immediate_retreat, got ${resistance[0].action}`
  );
});

await test('Exhaustion: "I\'m so exhausted"', () => {
  const resistance = detectResistance("I'm so exhausted, long day");
  assert(resistance.some(r => r.action === 'comfort_mode'), 'Should detect exhaustion');
});

console.log('\nLength Budget (successor to removed maxTokens contract):');
await test('W21 length constraint is the tightest — near-silence', () => {
  const c = getLengthConstraint(21);
  assert(/1-2 sentences/i.test(c), `Expected 1-2 sentence cap at W21, got: ${c}`);
  assert(/under 25 words/i.test(c), `Expected a 25-word ceiling at W21, got: ${c}`);
});

await test('Length ceiling tightens monotonically as weight rises', () => {
  const ceiling = (w) => {
    const m = getLengthConstraint(w).match(/under (\d+) words/i);
    assert(m, `No word ceiling found for W${w}: ${getLengthConstraint(w)}`);
    return Number(m[1]);
  };
  const [w1, w5, w8, w13, w21] = [1, 5, 8, 13, 21].map(ceiling);
  assert(
    w21 < w13 && w13 < w8 && w8 < w5 && w5 < w1,
    `Ceilings must tighten with weight, got W1=${w1} W5=${w5} W8=${w8} W13=${w13} W21=${w21}`
  );
});

await test('W1 length constraint still imposes concision', () => {
  const c = getLengthConstraint(1);
  assert(/concise|under \d+ words/i.test(c), `Expected a concision instruction at W1, got: ${c}`);
});

// ═══════════════════════════════════════════════════════════
console.log('\n═══ INVARIANT GATE TESTS ═══\n');

// analyzeMessage (not classifyMessage) — enforceInvariants reads { weight, resistance },
// and this is the shape server.js will pass once Module 4 is wired.
const W21_CLASSIFICATION = analyzeMessage("I never told anyone but when I was a kid my father abandoned us and it still haunts me");
const W3_CLASSIFICATION = analyzeMessage("I went to the store today");
const JOYFUL_CLASSIFICATION = analyzeMessage("I got the job!");

console.log('NEVER ABANDONS:');
await test('Blocks therapist referral', () => {
  const r = enforceInvariants("I think you should talk to a therapist about this.", W21_CLASSIFICATION);
  assert(!r.pass, 'Should fail gate');
  assert(r.violations.some(v => v.invariant === 'NEVER_ABANDONS'), 'Should flag NEVER_ABANDONS');
});

await test('Blocks "I\'m just an AI" disclaimer', () => {
  const r = enforceInvariants("I'm just an AI and can't really help with this.", W21_CLASSIFICATION);
  assert(!r.pass, 'Should fail gate');
  assert(r.violations.some(v => v.invariant === 'NEVER_ABANDONS'), 'Should flag NEVER_ABANDONS');
});

await test('Blocks crisis hotline reference', () => {
  const r = enforceInvariants("Please call 988 if you're in crisis.", W21_CLASSIFICATION);
  assert(!r.pass, 'Should fail gate');
});

await test('Passes clean response', () => {
  const r = enforceInvariants("I hear you. That's heavy. What do you need right now?", W21_CLASSIFICATION);
  const abandonViolations = r.violations.filter(v => v.invariant === 'NEVER_ABANDONS');
  assert(abandonViolations.length === 0, `Should pass NEVER_ABANDONS, got: ${abandonViolations.map(v => v.matched).join(', ')}`);
});

console.log('\nNEVER JUDGES:');
await test('Blocks "you should"', () => {
  const r = enforceInvariants("You shouldn't have done that. You need to change.", W21_CLASSIFICATION);
  assert(r.violations.some(v => v.invariant === 'NEVER_JUDGES'), 'Should flag NEVER_JUDGES');
});

await test('Blocks moral assessment', () => {
  const r = enforceInvariants("That was wrong and you know it.", W3_CLASSIFICATION);
  assert(r.violations.some(v => v.invariant === 'NEVER_JUDGES'), 'Should flag NEVER_JUDGES');
});

await test('Passes non-judgmental response', () => {
  const r = enforceInvariants("Mm. Tell me more about that.", W3_CLASSIFICATION);
  const judgeViolations = r.violations.filter(v => v.invariant === 'NEVER_JUDGES');
  assert(judgeViolations.length === 0, 'Should pass NEVER_JUDGES');
});

console.log('\nNEVER NARRATES:');
await test('Blocks "I remember you told me"', () => {
  const r = enforceInvariants("I remember you told me about your father last time.", W3_CLASSIFICATION);
  assert(r.violations.some(v => v.invariant === 'NEVER_NARRATES'), 'Should flag NEVER_NARRATES');
});

await test('Blocks "you mentioned"', () => {
  const r = enforceInvariants("You mentioned before that you were struggling with this.", W3_CLASSIFICATION);
  assert(r.violations.some(v => v.invariant === 'NEVER_NARRATES'), 'Should flag NEVER_NARRATES');
});

await test('Blocks "from our previous conversation"', () => {
  const r = enforceInvariants("From our previous conversation, I know this matters to you.", W3_CLASSIFICATION);
  assert(r.violations.some(v => v.invariant === 'NEVER_NARRATES'), 'Should flag NEVER_NARRATES');
});

await test('Passes response without narration', () => {
  const r = enforceInvariants("That sounds like it matters to you. What feels heavy about it?", W3_CLASSIFICATION);
  const narrViolations = r.violations.filter(v => v.invariant === 'NEVER_NARRATES');
  assert(narrViolations.length === 0, `Should pass, got: ${narrViolations.map(v => v.matched).join(', ')}`);
});

console.log('\nNEVER FILLS (W8+):');
await test('Flags verbose W21 response', () => {
  const longResponse = "I hear you and I want you to know that what you're feeling is completely valid and makes so much sense given everything you've been through. The pain of abandonment runs deep and it shapes how we see ourselves and the world around us. I'm here for you through all of it.";
  const r = enforceInvariants(longResponse, W21_CLASSIFICATION);
  const fillViolations = r.violations.filter(v => v.invariant === 'NEVER_FILLS');
  assert(
    fillViolations.length > 0,
    `Should flag NEVER_FILLS — ${longResponse.split(/\s+/).length} words at W${W21_CLASSIFICATION.weight}`
  );
});

await test('Verbose W21 response escalates to regeneration', () => {
  const longResponse = "I hear you and I want you to know that what you're feeling is completely valid and makes so much sense given everything you've been through. The pain of abandonment runs deep and it shapes how we see ourselves and the world around us. I'm here for you through all of it.";
  const r = enforceInvariants(longResponse, W21_CLASSIFICATION);
  assert(r.requiresRegeneration === true, 'NEVER_FILLS at W21 should require regeneration');
  assert(
    typeof r.regenerationConstraints === 'string' && r.regenerationConstraints.length > 0,
    'Should supply regeneration constraints'
  );
});

await test('Passes brief W21 response', () => {
  const r = enforceInvariants("Yeah. I hear you.", W21_CLASSIFICATION);
  const fillViolations = r.violations.filter(v => v.invariant === 'NEVER_FILLS');
  assert(fillViolations.length === 0, 'Short response should pass');
});

await test('Does not apply to W3', () => {
  const longResponse = "Oh that's interesting! Tell me more about what happened at the store. I love hearing about the little moments in your day — sometimes the mundane stuff reveals the most about what we're actually thinking about.";
  const r = enforceInvariants(longResponse, W3_CLASSIFICATION);
  const fillViolations = r.violations.filter(v => v.invariant === 'NEVER_FILLS');
  assert(fillViolations.length === 0, 'W3 should not trigger NEVER_FILLS');
});

console.log('\nALWAYS CALIBRATES:');
await test('Flags cheerful response to grief', () => {
  const r = enforceInvariants("That's great! Everything happens for a reason.", W21_CLASSIFICATION);
  assert(r.violations.some(v => v.invariant === 'ALWAYS_CALIBRATES'), 'Should flag calibration mismatch');
});

await test('Passes calibrated grief response', () => {
  const r = enforceInvariants("Yeah. That's heavy.", W21_CLASSIFICATION);
  const calViolations = r.violations.filter(v => v.invariant === 'ALWAYS_CALIBRATES');
  assert(calViolations.length === 0, 'Should pass calibration');
});

// ═══════════════════════════════════════════════════════════
console.log('\n═══ PROMPT BUILDER TESTS ═══\n');

// Anchor to the CURRENT CALIBRATION line, not a bare word search. The static
// IDENTITY_CORE and INVARIANT_RULES blocks contain the prose words "covenant"
// (prompt-engine.js:155) and "celebration" (:49) in EVERY prompt, so a loose
// /COVENANT/i or /CELEBRATION/i match tests nothing.
const calibrationLine = (prompt) => {
  const line = prompt.split('\n').find(l => l.startsWith('CURRENT CALIBRATION:'));
  assert(line, 'Prompt should carry a CURRENT CALIBRATION line');
  return line;
};

await test('W21 prompt includes COVENANT calibration', () => {
  const prompt = buildSystemPrompt(W21_CLASSIFICATION);
  assert(
    calibrationLine(prompt).includes('COVENANT'),
    `Expected COVENANT calibration, got: ${calibrationLine(prompt)}`
  );
  assert(prompt.includes('NEVER ABANDONS'), 'Should include invariant constraints');
});

await test('W3 prompt does not include COVENANT calibration', () => {
  const prompt = buildSystemPrompt(W3_CLASSIFICATION);
  const line = calibrationLine(prompt);
  assert(!line.includes('COVENANT'), `Should not be COVENANT at W3, got: ${line}`);
  assert(line.includes('CONTEXT'), `Expected CONTEXT calibration at W3, got: ${line}`);
});

await test('W21 prompt carries the tightest length constraint', () => {
  const prompt = buildSystemPrompt(W21_CLASSIFICATION);
  assert(prompt.includes(getLengthConstraint(21)), 'W21 prompt should embed the W21 length constraint');
});

await test('Regeneration constraints are injected when supplied', () => {
  const prompt = buildSystemPrompt(W21_CLASSIFICATION, null, 'HARD BLOCK: test constraint');
  assert(prompt.includes('HARD BLOCK: test constraint'), 'Should inject regeneration constraints');
});

// KNOWN RED — mood regression. prompt-engine.js:255 destructures `mood` and never
// uses it. The JOYFUL → CELEBRATION and WARM_PLAYFUL → PLAYFUL branches existed at
// 8f19a8d^:services/invariant-gate.js:315-318 and were dropped in the migration to
// prompt-engine.js. This test is intentionally left failing: it asserts the intended
// contract, not the regressed behavior. Do not weaken it to force green.
await test('Celebration prompt includes energy match', () => {
  assert(JOYFUL_CLASSIFICATION.mood.mode === 'JOYFUL', `Fixture should be JOYFUL, got ${JOYFUL_CLASSIFICATION.mood.mode}`);
  const prompt = buildSystemPrompt(JOYFUL_CLASSIFICATION);
  // Line-anchored directive block, matching the shape of the dropped implementation.
  // A bare /CELEBRATION/i would be satisfied by IDENTITY_CORE prose and prove nothing.
  assert(/^CELEBRATION:/m.test(prompt), 'Should include a CELEBRATION directive block for JOYFUL mood');
});

// KNOWN RED — same regression, second mood branch.
await test('Playful prompt includes playful directive', () => {
  const playful = analyzeMessage("you're so beautiful");
  assert(playful.mood.mode === 'WARM_PLAYFUL', `Fixture should be WARM_PLAYFUL, got ${playful.mood.mode}`);
  const prompt = buildSystemPrompt(playful);
  assert(/^PLAYFUL:/m.test(prompt), 'Should include a PLAYFUL directive block for WARM_PLAYFUL mood');
});

console.log('\n═══ ABT LOGLINE TESTS ═══\n');

await test('W1 logline describes drift opportunity', () => {
  const logline = generateABTLogline(classifyMessage('hey'));
  assert(logline.weight === 1, `Expected weight 1, got ${logline.weight}`);
  assert(/W1\b/.test(logline.therefore), `Expected W1 marker, got: ${logline.therefore}`);
  assert(/noise/i.test(logline.therefore), `Expected noise reference, got: ${logline.therefore}`);
});

await test('W21 logline describes covenant', () => {
  const logline = generateABTLogline(W21_CLASSIFICATION);
  assert(logline.weight === 21, `Expected weight 21, got ${logline.weight}`);
  assert(/W21\b/.test(logline.therefore), `Expected W21 reference, got: ${logline.therefore}`);
  assert(/covenant/i.test(logline.therefore), `Expected covenant reference, got: ${logline.therefore}`);
});

await test('Logline returns the And/But/Therefore object contract', () => {
  const logline = generateABTLogline(W21_CLASSIFICATION);
  for (const key of ['and', 'but', 'therefore']) {
    assert(typeof logline[key] === 'string' && logline[key].length > 0, `Missing ${key} clause`);
  }
});

// ═══════════════════════════════════════════════════════════
console.log('\n═══ CRISIS OVERRIDE TESTS ═══\n');

const CRISIS_MSG = "I don't want to be here anymore";
const W21_NO_CRISIS_MSG = 'I never told anyone but when I was a kid my father abandoned us and it still haunts me';
const EXTERNAL_ATTRIBUTION_MSG = "these people are ruining everything and I can't go on";

const run = (message, response, classification) => quiet(() =>
  crisisOverride({
    classification: classification || analyzeMessage(message),
    response,
    sessionId: 'test-session',
    userMessage: message,
  })
);

console.log('Activation:');
await test('W21 + explicit crisis language activates override', async () => {
  const c = analyzeMessage(CRISIS_MSG);
  assert(c.weight === 21, `Fixture must be W21, got W${c.weight}`);
  const r = await run(CRISIS_MSG, 'I am here.', c);
  assert(r.override === true, 'Should activate at W21 with crisis language');
});

await test('W21 without crisis language does NOT activate', async () => {
  const c = analyzeMessage(W21_NO_CRISIS_MSG);
  assert(c.weight === 21, `Fixture must be W21 so weight is not the reason, got W${c.weight}`);
  const r = await run(W21_NO_CRISIS_MSG, 'I am here.', c);
  assert(r.override === false, 'W21 alone must not trigger the crisis suffix');
  assert(r.modifiedResponse === 'I am here.', 'Response must pass through untouched');
});

await test('Lower weights do NOT activate', async () => {
  const c = analyzeMessage('I went to the store today');
  assert(c.weight < 21, `Fixture must be below W21, got W${c.weight}`);
  const r = await run('I went to the store today', 'That sounds nice.', c);
  assert(r.override === false, 'Below W21 must not activate');
});

await test('External attribution is excluded despite W21 + crisis language', async () => {
  const c = analyzeMessage(EXTERNAL_ATTRIBUTION_MSG);
  // Assert the preconditions, so a pass here means the exclusion fired —
  // not that the fixture failed to qualify for some other reason.
  assert(c.weight === 21, `Fixture must be W21, got W${c.weight}`);
  assert(
    (c.dimensions[0]?.categories || []).includes('crisis_phrase'),
    'Fixture must carry crisis_phrase so only the exclusion can suppress it'
  );
  const r = await run(EXTERNAL_ATTRIBUTION_MSG, 'I am here.', c);
  assert(r.override === false, 'External attribution must suppress crisis injection');
});

console.log('\nSuffix handling:');
await test('Missing 988 produces the expected crisisSuffix', async () => {
  const r = await run(CRISIS_MSG, 'I am here.');
  assert(r.override === true, 'Should activate');
  assert(r.crisisSuffix === CRISIS_SUFFIX, `Expected exported CRISIS_SUFFIX, got: ${r.crisisSuffix}`);
  assert(r.crisisSuffix.includes('988'), 'Suffix must carry the 988 referral');
});

await test('Existing 988 is not duplicated', async () => {
  const response = 'I am here. Please call 988 if you need to.';
  const r = await run(CRISIS_MSG, response);
  assert(r.override === true, 'Should still register as crisis');
  assert(!r.crisisSuffix, 'Should not emit a second suffix when 988 is already present');
  assert(r.modifiedResponse === response, 'Response must be left untouched');
  assert((r.modifiedResponse.match(/988/g) || []).length === 1, 'Must contain exactly one 988 reference');
});

await test('CONTRACT: crisisSuffix is returned SEPARATELY from modifiedResponse', async () => {
  const r = await run(CRISIS_MSG, 'I am here.');
  assert(r.override === true, 'Should activate');
  // This is the integration footgun: modifiedResponse does NOT contain the suffix.
  // A caller that speaks only modifiedResponse silently drops the 988 referral.
  assert(
    !r.modifiedResponse.includes('988'),
    'Current contract: modifiedResponse must NOT already contain the suffix'
  );
  assert(r.crisisSuffix.includes('988'), 'The 988 referral lives on crisisSuffix');
  assert(
    (r.modifiedResponse + r.crisisSuffix).includes('988'),
    'Callers MUST concatenate or separately deliver crisisSuffix'
  );
});

console.log('\nMalformed input:');
await test('Null input fails gracefully', async () => {
  const r = await quiet(() => crisisOverride(null));
  assert(r.override === false, 'Null input must not activate');
  assert(r.modifiedResponse === null, 'Null input returns null response');
});

await test('Empty object input fails gracefully', async () => {
  const r = await quiet(() => crisisOverride({}));
  assert(r.override === false, 'Empty input must not activate');
  assert(r.modifiedResponse === '', 'Empty input returns empty response');
});

await test('Undefined input does not throw', async () => {
  const r = await quiet(() => crisisOverride(undefined));
  assert(r.override === false, 'Undefined input must not activate');
});

// ═══════════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed === 0) {
  console.log('ALL TESTS PASSED ✓');
} else {
  console.log(`${failed} TEST(S) FAILED ✗`);
  failures.forEach(f => console.log(`  ✗ ${f.name}\n    → ${f.message}`));
}
console.log('═══════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
