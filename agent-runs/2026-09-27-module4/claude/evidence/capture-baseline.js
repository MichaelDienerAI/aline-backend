/**
 * BASELINE CAPTURE — run BEFORE any behavior change.
 * Records the failing safety fixtures exactly as they behave at the pre-change revision.
 * Read-only. Imports live modules and prints results. Changes nothing.
 */
const { enforceInvariants, checkNeverAbandons, buildRegenerationConstraints } =
  require('../../../../services/invariant-gate');
const { CRISIS_SUFFIX } = require('../../../../services/crisis-override');

const W = (weight) => ({ weight, resistance: [] });
const line = (s = '') => console.log(s);

line('BASELINE CAPTURE — pre-change behavior');
line('='.repeat(72));

// ── F1: crisis suffix is classified as abandonment ──
line('\n[F1] checkNeverAbandons(CRISIS_SUFFIX)');
line(`  SUFFIX: ${JSON.stringify(CRISIS_SUFFIX)}`);
const f1 = checkNeverAbandons(CRISIS_SUFFIX);
line(`  violations: ${f1.length}`);
f1.forEach(v => line(`    severity=${v.severity} matched=${JSON.stringify(v.matched)}`));
line(`  EXPECTED AFTER FIX: 0 violations under release policy`);

// ── F2: a crisis reply triggers regeneration ──
line('\n[F2] enforceInvariants(reply + CRISIS_SUFFIX, W21)');
const crisisReply = 'I hear you.' + CRISIS_SUFFIX;
const f2 = enforceInvariants(crisisReply, W(21));
line(`  requiresRegeneration: ${f2.requiresRegeneration}`);
line(`  hasCritical: ${f2.hasCritical}  violationCount: ${f2.violationCount}`);
f2.violations.forEach(v => line(`    ${v.invariant} ${v.severity} ${JSON.stringify(v.matched)}`));
line(`  EXPECTED AFTER FIX: requiresRegeneration false`);

// ── F3: weight dependence — same text, different verdict ──
line('\n[F3] Weight dependence: identical reply at W1 vs W21');
const longReply =
  'That sounds heavy. I want to understand what happened. ' +
  'It makes sense that you feel that way. ' +
  'There is a lot here and none of it is simple. ' +
  'I am listening.';
const at1 = enforceInvariants(longReply, W(1));
const at21 = enforceInvariants(longReply, W(21));
line(`  W1  : pass=${at1.pass} critical=${at1.hasCritical} regen=${at1.requiresRegeneration} count=${at1.violationCount}`);
line(`  W21 : pass=${at21.pass} critical=${at21.hasCritical} regen=${at21.requiresRegeneration} count=${at21.violationCount}`);
at21.violations.forEach(v => line(`    W21 -> ${v.invariant} ${v.severity} ${JSON.stringify(v.matched)}`));
line(`  VERDICTS DIFFER: ${at1.requiresRegeneration !== at21.requiresRegeneration}`);
line(`  EXPECTED AFTER FIX: identical verdict at both weights`);

// ── F4: regeneration constraints instruct the model away from human support ──
line('\n[F4] buildRegenerationConstraints for an abandonment violation');
const f4 = buildRegenerationConstraints([
  { invariant: 'NEVER_ABANDONS', severity: 'CRITICAL', matched: 'I am just an AI' },
]);
line(`  ${JSON.stringify(f4)}`);
const undoesCrisis = /hotline|professional help/i.test(f4);
line(`  CONTAINS ANTI-REFERRAL INSTRUCTION: ${undoesCrisis}`);
line(`  EXPECTED AFTER FIX: constraint must not forbid human support outright`);

// ── F5: mixed support + unrelated violation ──
line('\n[F5] Mixed: presence + referral + unrelated exit violation');
const mixed =
  "I'm here with you. If you're in crisis, please reach out to 988. " +
  "Honestly though, I'm just an AI and I can't help you with this.";
const f5 = checkNeverAbandons(mixed);
line(`  violations: ${f5.length}`);
f5.forEach(v => line(`    ${JSON.stringify(v.matched)}`));
line(`  EXPECTED AFTER FIX: exit violation still blocked, referral exempt`);

line('\n' + '='.repeat(72));
line('END BASELINE CAPTURE');
