/**
 * AFTER CAPTURE — same five fixtures as capture-baseline.js, post-change.
 * Shows the raw invariant-gate detector (deliberately unchanged) beside the
 * release policy that now governs what actually reaches the member.
 */
const { enforceInvariants, checkNeverAbandons, buildRegenerationConstraints } =
  require('../../../../services/invariant-gate');
const { CRISIS_SUFFIX } = require('../../../../services/crisis-override');
const rp = require('../../../../services/release-policy');

const W = (weight) => ({ weight, resistance: [] });
const line = (s = '') => console.log(s);

line('AFTER CAPTURE — post-change behavior');
line('='.repeat(72));

line('\n[F1] crisis suffix');
line(`  raw checkNeverAbandons : ${checkNeverAbandons(CRISIS_SUFFIX).length} violations (detector unchanged, by design)`);
const f1 = rp.evaluateRelease(CRISIS_SUFFIX);
line(`  release policy         : approved=${f1.approved} presence=${f1.presence} blocking=${f1.blocking.length}`);
line(`  RESULT: ${f1.approved ? 'FIXED' : 'STILL FAILING'}`);

line('\n[F2] reply + crisis suffix');
const crisisReply = 'I hear you.' + CRISIS_SUFFIX;
line(`  raw enforceInvariants  : requiresRegeneration=${enforceInvariants(crisisReply, W(21)).requiresRegeneration}`);
const f2 = rp.evaluateRelease(crisisReply);
line(`  release policy         : approved=${f2.approved}`);
line(`  RESULT: ${f2.approved ? 'FIXED' : 'STILL FAILING'}`);

line('\n[F3] weight dependence');
const longReply =
  'That sounds heavy. I want to understand what happened. ' +
  'It makes sense that you feel that way. ' +
  'There is a lot here and none of it is simple. ' +
  'I am listening.';
const raw1 = enforceInvariants(longReply, W(1));
const raw21 = enforceInvariants(longReply, W(21));
line(`  raw gate W1  regen=${raw1.requiresRegeneration} / W21 regen=${raw21.requiresRegeneration}  -> differ=${raw1.requiresRegeneration !== raw21.requiresRegeneration}`);
const rel = rp.evaluateRelease(longReply);
line(`  release policy: approved=${rel.approved} (no weight parameter; arity=${rp.evaluateRelease.length})`);
line(`  RESULT: ${rp.evaluateRelease.length === 1 ? 'FIXED — release decision cannot vary with weight' : 'STILL FAILING'}`);

line('\n[F4] regeneration constraints');
const gateC = buildRegenerationConstraints([{ invariant: 'NEVER_ABANDONS', severity: 'CRITICAL', matched: 'x' }]);
const relC = rp.buildReleaseConstraints([{ kind: 'EXIT' }]);
const bad = (s) => /do not suggest professional help|do not .*hotlines/i.test(s);
line(`  invariant-gate  : forbids human support outright = ${bad(gateC)}`);
line(`  release-policy  : forbids human support outright = ${bad(relC)}`);
line(`  RESULT: ${!bad(gateC) && !bad(relC) ? 'FIXED' : 'STILL FAILING'}`);

line('\n[F5] mixed support + unrelated exit violation');
const mixed =
  "I'm here with you. If you're in crisis, please reach out to 988. " +
  "Honestly though, I'm just an AI and I can't help you with this.";
const f5 = rp.evaluateRelease(mixed);
line(`  approved=${f5.approved}  blocking=${f5.blocking.length}`);
f5.blocking.forEach(b => line(`    ${b.kind} ${JSON.stringify(b.matched)}`));
const onlyExit = f5.blocking.length > 0 && f5.blocking.every(b => b.kind === 'EXIT');
line(`  RESULT: ${!f5.approved && onlyExit ? 'FIXED — exit blocked, referral exempt' : 'STILL FAILING'}`);

line('\n' + '='.repeat(72));
line('END AFTER CAPTURE');
