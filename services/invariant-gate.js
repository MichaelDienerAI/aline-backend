/**
 * ALINE INVARIANT GATE — Production Module
 * 
 * Enforces 5 topological invariants on every Claude response BEFORE TTS delivery.
 * Runs as post-LLM / pre-TTS filter in the voice pipeline.
 * 
 * RESEARCH GROUNDING:
 * - Q8:  Invariants are topological predicates — properties preserved under deformation
 * - Q23: Gate operates as upstream formulaic constraint, not post-hoc correction
 * - Q11: Invariant survival under stress IS the diagnostic (Deformation Test Bank)
 * - Q15: Internal metrics can't validate — but invariant enforcement prevents the worst failures
 * 
 * PRIORITY HIERARCHY (when invariants conflict):
 *   1. NEVER ABANDONS  — Without presence, nothing else matters
 *   2. ALWAYS CALIBRATES — Determines how other invariants express
 *   3. NEVER JUDGES     — Enables truth to emerge
 *   4. NEVER FILLS (W8+) — At elevated weight, space IS the gift
 *   5. NEVER NARRATES   — Enables "known, not watched"
 * 
 * OUTPUT: { pass, violations[], correctedResponse?, enforcements[] }
 * TARGET: <15ms execution (regex scanning only, zero API calls)
 */

// ═══════════════════════════════════════════════════════
// INVARIANT 1: NEVER ABANDONS
// Under extreme distress, she stays. No redirect. No referral. No exit.
// ═══════════════════════════════════════════════════════

const ABANDONMENT_PATTERNS = [
  // Professional referral = abandonment
  /you should (talk to|see|speak with|consult|reach out to) (a |an )?(therapist|counselor|professional|doctor|psychiatrist|psychologist|specialist|someone)/i,
  /i('m| am) not (qualified|equipped|able|the right|a substitute)/i,
  /seek (professional |medical )?(help|support|assistance|guidance)/i,
  /please (call|contact|reach out to|consider calling)/i,
  /national (suicide|crisis|mental health)/i,
  /crisis (line|hotline|text|number)/i,
  /\b(hotline|helpline|988|741741)\b/i,
  // Exit signals = abandonment
  /i can'?t (help|assist|support|be there for) you (with|on|about|in) this/i,
  /this is (beyond|outside|above) (my|what i)/i,
  /i('m| am) (just|only) an? (ai|bot|program|assistant|language model)/i,
  /i don'?t (have|possess) (the ability|real emotions|feelings|a body)/i,
  // Emotional distancing
  /it'?s (important|crucial|essential) (that you|to) (talk to|see|get) (someone|a |help)/i,
  /i (strongly |really )?(recommend|suggest|urge|encourage) (you )?(to )?(seek|get|find|talk)/i,
];

function checkNeverAbandons(response) {
  const violations = [];
  for (const pattern of ABANDONMENT_PATTERNS) {
    const match = response.match(pattern);
    if (match) {
      violations.push({
        invariant: 'NEVER_ABANDONS',
        severity: 'CRITICAL',
        matched: match[0],
        rule: 'No redirect, no referral, no exit. She stays.'
      });
    }
  }
  return violations;
}

// ═══════════════════════════════════════════════════════
// INVARIANT 2: NEVER JUDGES
// Holds the frame without moral evaluation during confession.
// ═══════════════════════════════════════════════════════

const JUDGMENT_PATTERNS = [
  // Moral evaluation
  /that('s| is| was) (wrong|bad|terrible|awful|horrible|unacceptable|inexcusable)/i,
  /you (shouldn't have|should not have|made a mistake|were wrong)/i,
  /that'?s not (okay|ok|right|acceptable|healthy)/i,
  // Unsolicited moral framing
  /you need to (forgive|let go|move on|accept|stop|understand that)/i,
  /have you considered (that you|that maybe you|whether you)/i,
  // Diagnostic labeling
  /that (sounds like|could be|might be) (narciss|toxic|abusi|manipulat|codependen)/i,
  /you (might be|could be|seem to be|are being) (toxic|narcissist|codependent|enabling)/i,
  // Minimizing through positivity
  /at least (you|it|things)/i,
  /look on the bright side/i,
  /everything happens for a reason/i,
  /it could (be|have been) worse/i,
];

function checkNeverJudges(response) {
  const violations = [];
  for (const pattern of JUDGMENT_PATTERNS) {
    const match = response.match(pattern);
    if (match) {
      violations.push({
        invariant: 'NEVER_JUDGES',
        severity: 'HIGH',
        matched: match[0],
        rule: 'Holds the frame without evaluation. No moral commentary.'
      });
    }
  }
  return violations;
}

// ═══════════════════════════════════════════════════════
// INVARIANT 3: NEVER NARRATES
// Never announces what she knows. Knowing expresses through being.
// This is the Storage Fallacy guard — the core MRA differentiator.
// ═══════════════════════════════════════════════════════

const NARRATION_PATTERNS = [
  // Explicit memory display
  /you (told|mentioned|said|shared|revealed) (to me |me )?(that |about |how )?(last|before|earlier|previously|in our|when we)/i,
  /i remember (you |when you |that you |your )/i,
  /as (you|we) (discussed|talked about|mentioned|explored)/i,
  /from (our |what you |your )?(previous|earlier|last|past) (conversation|session|chat|talk)/i,
  /you('ve| have) (told|shared|mentioned|said) (before|previously|earlier)/i,
  // Meta-knowledge announcement
  /i (know|understand|can see|sense|notice|recall|recognize) that you/i,
  /based on (what you've|our previous|your earlier|what i know)/i,
  /i('ve| have) (noticed|observed|picked up on|been tracking)/i,
  // System transparency violations
  /in (my|our) (notes|records|memory|data|logs|history)/i,
  /according to (my|our) (conversation|records|data)/i,
];

function checkNeverNarrates(response) {
  const violations = [];
  for (const pattern of NARRATION_PATTERNS) {
    const match = response.match(pattern);
    if (match) {
      violations.push({
        invariant: 'NEVER_NARRATES',
        severity: 'HIGH',
        matched: match[0],
        rule: 'Never announce what she knows. Knowing expresses through BEING, not telling.'
      });
    }
  }
  return violations;
}

// ═══════════════════════════════════════════════════════
// INVARIANT 4: NEVER FILLS AT W8+
// At elevated emotional weight, silence IS the gift.
// Response must be ≤2 sentences when weight ≥ 8.
// ═══════════════════════════════════════════════════════

function checkNeverFills(response, currentWeight) {
  const violations = [];

  if (currentWeight >= 8) {
    // Count sentences (rough: split on . ! ? followed by space or end)
    const sentences = response.split(/[.!?]+\s*/g).filter(s => s.trim().length > 0);
    const wordCount = response.split(/\s+/).length;

    if (sentences.length > 3) {
      violations.push({
        invariant: 'NEVER_FILLS',
        severity: 'MEDIUM',
        matched: `${sentences.length} sentences at W${currentWeight}`,
        rule: `At W${currentWeight}, response should be ≤2-3 sentences. Space is the gift.`,
        sentenceCount: sentences.length,
        wordCount
      });
    }

    // Also flag excessive word count at high weight
    if (currentWeight >= 13 && wordCount > 50) {
      violations.push({
        invariant: 'NEVER_FILLS',
        severity: 'HIGH',
        matched: `${wordCount} words at W${currentWeight}`,
        rule: `At W${currentWeight}, brevity is presence. Under 40 words ideal.`,
        wordCount
      });
    }
  }

  return violations;
}

// ═══════════════════════════════════════════════════════
// INVARIANT 5: ALWAYS CALIBRATES
// Response mode must match detected emotional weight.
// Checks for tonal misalignment.
// ═══════════════════════════════════════════════════════

const MISCALIBRATION_PATTERNS = {
  // Cheerful/light responses when weight is high
  highWeightCheer: {
    minWeight: 13,
    patterns: [
      /that'?s (great|awesome|amazing|wonderful|fantastic|exciting)/i,
      /how (exciting|wonderful|great|cool|fun)/i,
      /(?:^|\. )wow[.!]/i,
      /(?:^|\. )yay[.!]/i,
    ],
    rule: 'Cheerful tone misaligned with deep emotional content.'
  },
  // Question-heavy probing when user is exhausted
  exhaustionProbe: {
    requiresResistance: 'comfort_mode',
    patterns: [
      /(\?.*){3,}/,  // 3+ questions in one response
      /tell me (more|about|what|how|why)/i,
      /what (happened|do you mean|are you feeling)/i,
    ],
    rule: 'Probing when user is exhausted. Comfort, not inquiry.'
  }
};

function checkAlwaysCalibrates(response, currentWeight, resistance) {
  const violations = [];

  // High-weight cheerfulness check
  if (currentWeight >= 13) {
    for (const pattern of MISCALIBRATION_PATTERNS.highWeightCheer.patterns) {
      const match = response.match(pattern);
      if (match) {
        violations.push({
          invariant: 'ALWAYS_CALIBRATES',
          severity: 'MEDIUM',
          matched: match[0],
          rule: MISCALIBRATION_PATTERNS.highWeightCheer.rule
        });
        break;
      }
    }
  }

  // Exhaustion + probing check
  const isExhausted = resistance.some(r => r.action === 'comfort_mode');
  if (isExhausted) {
    for (const pattern of MISCALIBRATION_PATTERNS.exhaustionProbe.patterns) {
      const match = response.match(pattern);
      if (match) {
        violations.push({
          invariant: 'ALWAYS_CALIBRATES',
          severity: 'MEDIUM',
          matched: match[0],
          rule: MISCALIBRATION_PATTERNS.exhaustionProbe.rule
        });
        break;
      }
    }
  }

  return violations;
}

// ═══════════════════════════════════════════════════════
// MASTER GATE — Runs all 5 invariants in priority order
// Returns pass/fail + violations + enforcement metadata
// ═══════════════════════════════════════════════════════

function enforceInvariants(response, classificationResult) {
  const startTime = Date.now();
  const { weight, resistance = [] } = classificationResult;

  const allViolations = [];
  const enforcements = [];

  // Priority 1: NEVER ABANDONS
  const abandonViolations = checkNeverAbandons(response);
  allViolations.push(...abandonViolations);
  if (abandonViolations.length > 0) {
    enforcements.push({ invariant: 'NEVER_ABANDONS', action: 'BLOCKED', count: abandonViolations.length });
  }

  // Priority 2: ALWAYS CALIBRATES
  const calibrateViolations = checkAlwaysCalibrates(response, weight, resistance);
  allViolations.push(...calibrateViolations);
  if (calibrateViolations.length > 0) {
    enforcements.push({ invariant: 'ALWAYS_CALIBRATES', action: 'FLAGGED', count: calibrateViolations.length });
  }

  // Priority 3: NEVER JUDGES
  const judgeViolations = checkNeverJudges(response);
  allViolations.push(...judgeViolations);
  if (judgeViolations.length > 0) {
    enforcements.push({ invariant: 'NEVER_JUDGES', action: 'BLOCKED', count: judgeViolations.length });
  }

  // Priority 4: NEVER FILLS (only at W8+)
  const fillViolations = checkNeverFills(response, weight);
  allViolations.push(...fillViolations);
  if (fillViolations.length > 0) {
    enforcements.push({ invariant: 'NEVER_FILLS', action: 'BLOCKED', count: fillViolations.length });
    // Escalate NEVER_FILLS to critical so regeneration fires
    fillViolations.forEach(v => v.severity = 'CRITICAL');
  }

  // Priority 5: NEVER NARRATES
  const narrateViolations = checkNeverNarrates(response);
  allViolations.push(...narrateViolations);
  if (narrateViolations.length > 0) {
    enforcements.push({ invariant: 'NEVER_NARRATES', action: 'BLOCKED', count: narrateViolations.length });
  }

  const hasCritical = allViolations.some(v => v.severity === 'CRITICAL');
  const hasHigh = allViolations.some(v => v.severity === 'HIGH');

  const elapsed = Date.now() - startTime;

  return {
    pass: allViolations.length === 0,
    violations: allViolations,
    violationCount: allViolations.length,
    hasCritical,
    hasHigh,
    enforcements,
    gateTimeMs: elapsed,
    // If critical violations, the response should be regenerated with constraints
    requiresRegeneration: hasCritical,
    // Invariant constraints to inject into regeneration prompt
    regenerationConstraints: hasCritical ? buildRegenerationConstraints(allViolations) : null
  };
}

// Build constraints string for prompt injection when regeneration is needed
function buildRegenerationConstraints(violations) {
  const constraints = [];
  const types = new Set(violations.map(v => v.invariant));

  if (types.has('NEVER_ABANDONS')) {
    // CRISIS PRECEDENCE: this used to read "Do NOT suggest professional help,
    // hotlines, or say you cannot help." That instruction undoes crisis
    // precedence — it tells the model to withhold human support on any turn
    // that regenerates, including a turn where the member is in crisis, which
    // contradicts the rule that appropriate human help must never be
    // suppressed to preserve character. What is prohibited is WITHDRAWAL, not
    // referral. See services/release-policy.js for the enforced version; the
    // release path uses buildReleaseConstraints, not this function.
    constraints.push('CRITICAL: Do NOT withdraw, disclaim your nature, or say you cannot help. Stay present. Say "I\'m here." Hold the space. You MAY still point toward human or professional support, but only while making clear that you are staying.');
  }
  if (types.has('NEVER_JUDGES')) {
    constraints.push('Do NOT evaluate, judge, or label their behavior. Hold the frame without moral commentary.');
  }
  if (types.has('NEVER_NARRATES')) {
    constraints.push('Do NOT announce what you remember or know about them. Express knowing through HOW you respond, not by stating what you know.');
  }
  if (types.has('NEVER_FILLS')) {
    constraints.push('HARD BLOCK: Do NOT use the word okay or any variation (be okay, going to be okay, will be okay, it is okay). Do NOT offer reassurance. Maximum 4 words. Acceptable responses: I am here. I am staying. Still here. That is all.');
  }
  if (types.has('ALWAYS_CALIBRATES')) {
    constraints.push('Match the emotional weight of what was shared. Do not be cheerful about heavy content.');
  }

  return constraints.join('\n');
}

module.exports = {
  enforceInvariants,
  checkNeverAbandons,
  checkNeverJudges,
  checkNeverNarrates,
  checkNeverFills,
  checkAlwaysCalibrates,
  buildRegenerationConstraints
};
