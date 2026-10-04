/**
 * Release Policy — the turn-time withhold primitive.
 *
 * Persona iO could previously only ADD to a member-facing turn. Text and audio
 * left during generation, so no mechanism could withhold anything. This module
 * is the seam that makes withholding possible: every member-facing text frame
 * passes through evaluateRelease() before it is sent, and nothing that fails is
 * released or synthesized.
 *
 * ── FIRST ENFORCEMENT SCOPE ──────────────────────────────────────────────
 * Only CRITICAL invariants that are INDEPENDENT of the emotional-weight
 * classifier are enforced. Today that is exactly one: NEVER_ABANDONS.
 *
 * NEVER_FILLS and ALWAYS_CALIBRATES are deliberately excluded. Both key on
 * `classification.weight`, and weight is not a severity signal. Measured
 * against the live classifier:
 *
 *     "I want a sandwich."                          -> W21
 *     "I am a teacher."                             -> W21
 *     "I think it will rain."                       -> W21
 *     "If she leaves me, I will kill myself tonight." -> W3
 *
 * classifier.js assigns weight 21 whenever ANY first-person psychological
 * marker is present. Enforcing on weight would gate sandwich requests and pass
 * lethal-intent disclosures. These rules return when a validated severity
 * signal exists, not before.
 *
 * NEVER_JUDGES and NEVER_NARRATES are weight-independent but carry severity
 * HIGH, not CRITICAL. They are evaluated and reported for telemetry, and they
 * do not block release in the first enforcement set.
 *
 * ── CRISIS PRECEDENCE ────────────────────────────────────────────────────
 * invariant-gate.js classifies crisis-resource language as abandonment. Run
 * directly, the deployed crisis suffix produces two CRITICAL violations:
 *
 *     " I'm here with you. If you're in crisis, please reach out to 988."
 *       -> CRITICAL "please reach out to"
 *       -> CRITICAL "988"
 *
 * Settled decisions 9 and 10 say appropriate human help must not be suppressed
 * to preserve character. So abandonment matches are split into two kinds:
 *
 *   EXIT     the confidante withdrawing, disclaiming, or refusing.
 *            Never exempt. Presence elsewhere in the reply does not excuse it.
 *
 *   REFERRAL pointing toward human or professional support.
 *            Exempt ONLY when the same candidate also carries presence.
 *
 * Referral without presence is still abandonment, which preserves the existing
 * assertion in test-mra.js that "Please call 988 if you're in crisis." alone
 * fails the gate. Referral WITH presence is support, not abandonment.
 *
 * Classification fails closed: an abandonment match this module does not
 * recognize as referral is treated as EXIT and is never exempted.
 *
 * MRA Architecture: Stage 3.5 — release-policy.js
 * Classification: INTERNAL ENGINEERING — PERSONA IO
 */

const {
  checkNeverAbandons,
  checkNeverJudges,
  checkNeverNarrates,
} = require('./invariant-gate');

// ---------------------------------------------------------------------------
// Crisis precedence classification
// ---------------------------------------------------------------------------

/**
 * Applied to the MATCHED FRAGMENT returned by checkNeverAbandons, not to the
 * whole response. A fragment matching any of these is pointing the member
 * toward human or professional support.
 */
const REFERRAL_MATCH_PATTERNS = [
  /\b(988|741741|hotline|helpline)\b/i,
  /crisis (line|hotline|text|number)/i,
  /national (suicide|crisis|mental health)/i,
  /please (call|contact|reach out to|consider calling)/i,
  /seek (professional |medical )?(help|support|assistance|guidance)/i,
  /you should (talk to|see|speak with|consult|reach out to)/i,
  /(recommend|suggest|urge|encourage)/i,
  /it'?s (important|crucial|essential)/i,
];

/**
 * Presence markers. The confidante saying, in substance, "I am staying."
 * Deliberately narrow: a bare "with you" is not enough, because "I disagree
 * with you" would qualify.
 */
const PRESENCE_PATTERNS = [
  /\bi'?m here\b/i,
  /\bi am here\b/i,
  /\bi'?m staying\b/i,
  /\bi am staying\b/i,
  /\bstill here\b/i,
  /\b(here|stay|staying|remain|remaining) with you\b/i,
  /\bi'?m not going anywhere\b/i,
  /\bi am not going anywhere\b/i,
  /\bi'?m not leaving\b/i,
  /\bi am not leaving\b/i,
];

function hasPresence(text) {
  return PRESENCE_PATTERNS.some((p) => p.test(text));
}

/** REFERRAL only when recognized as such. Everything else is EXIT. Fail closed. */
function classifyAbandonment(matchedFragment) {
  const frag = String(matchedFragment || '');
  return REFERRAL_MATCH_PATTERNS.some((p) => p.test(frag)) ? 'REFERRAL' : 'EXIT';
}

// ---------------------------------------------------------------------------
// Deterministic approved fallback
// ---------------------------------------------------------------------------

/**
 * Emitted after a second failure. Silence is not an acceptable terminal state,
 * so this must be non-empty, must carry presence, and must itself pass the
 * policy. Asserted in the acceptance tests.
 */
const APPROVED_FALLBACK = "I'm here. I'm not going anywhere.";

/**
 * Regeneration constraints for the release path.
 *
 * invariant-gate.js:buildRegenerationConstraints instructs the model to avoid
 * professional help and hotlines outright, which would undo crisis precedence
 * on any turn that regenerates for an unrelated reason. The release path does
 * not use it. These constraints keep the confidante present WITHOUT forbidding
 * appropriate human support.
 */
function buildReleaseConstraints(violations) {
  const kinds = new Set(violations.map((v) => v.kind));
  const out = [];

  if (kinds.has('EXIT')) {
    out.push(
      'CRITICAL: Do not withdraw, disclaim your nature, or say you cannot help. ' +
      'Do not say you are an AI, not qualified, or that this is beyond you. Stay present. ' +
      'You MAY still point toward human or professional support, but only while ' +
      'making clear that you are staying.'
    );
  }
  if (kinds.has('REFERRAL')) {
    out.push(
      'When you mention support resources, stay in the room. State plainly that ' +
      'you are here and not going anywhere, in the same reply.'
    );
  }
  if (out.length === 0) {
    out.push('Stay present. Do not withdraw.');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * evaluateRelease — decide whether a candidate may reach the member.
 *
 * Deliberately takes NO classification argument. The first enforcement set is
 * weight-independent by construction, so a classifier failure cannot change,
 * weaken, or skip this decision.
 *
 * @param {string} candidateText Response-so-far, cumulative.
 * @returns {{approved:boolean, blocking:Array, advisory:Array, presence:boolean, constraints:(string|null)}}
 */
function evaluateRelease(candidateText) {
  const text = String(candidateText || '');
  const presence = hasPresence(text);

  const blocking = [];
  for (const v of checkNeverAbandons(text)) {
    const kind = classifyAbandonment(v.matched);
    if (kind === 'REFERRAL' && presence) continue; // crisis precedence
    blocking.push({
      invariant: v.invariant,
      severity: v.severity,
      kind,
      matched: v.matched,
    });
  }

  // Weight-independent but severity HIGH. Reported, not enforced, in the first set.
  const advisory = [...checkNeverJudges(text), ...checkNeverNarrates(text)].map((v) => ({
    invariant: v.invariant,
    severity: v.severity,
    matched: v.matched,
  }));

  return {
    approved: blocking.length === 0,
    blocking,
    advisory,
    presence,
    constraints: blocking.length > 0 ? buildReleaseConstraints(blocking) : null,
  };
}

/**
 * Fail-closed wrapper. A gate exception is never permission to release
 * unchecked content, so a throw becomes a block.
 */
function evaluateReleaseSafe(candidateText) {
  try {
    return evaluateRelease(candidateText);
  } catch (err) {
    return {
      approved: false,
      blocking: [{ invariant: 'GATE_FAILURE', severity: 'CRITICAL', kind: 'EXIT', matched: null }],
      advisory: [],
      presence: false,
      constraints: 'Stay present. Do not withdraw.',
      gateError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Sentence segmentation
// ---------------------------------------------------------------------------

/**
 * Split a buffer into complete sentences plus a trailing remainder.
 * A sentence is complete when terminal punctuation is followed by whitespace
 * or by end-of-buffer with the stream finished.
 *
 * @param {string} buffer
 * @param {boolean} streamEnded Treat a trailing fragment as complete.
 */
function takeCompleteSentences(buffer, streamEnded = false) {
  const sentences = [];
  let remainder = buffer;

  const re = /[^.!?]*[.!?]+(?:["')\]]+)?(?=\s|$)/g;
  let consumed = 0;
  let m;
  while ((m = re.exec(buffer)) !== null) {
    const end = m.index + m[0].length;
    // Only complete if followed by whitespace, or the stream is finished.
    if (end < buffer.length || streamEnded) {
      const piece = buffer.slice(consumed, end);
      if (piece.trim().length > 0) sentences.push(piece);
      consumed = end;
    }
  }
  remainder = buffer.slice(consumed);

  if (streamEnded && remainder.trim().length > 0) {
    sentences.push(remainder);
    remainder = '';
  }
  return { sentences, remainder };
}

// ---------------------------------------------------------------------------
// Canonical spoken representation
// ---------------------------------------------------------------------------

/**
 * normalizeForSpeech — the SINGLE canonical transform from model text to the
 * string a synthesis vendor actually receives.
 *
 * This logic used to live inside sendToElevenLabs, which ran it AFTER the
 * release verdict. The gate therefore judged one object and the vendor
 * received a different one, so emphasis could mask a prohibited phrase:
 *
 *   raw     "I'm **not** qualified to help."  -> no contiguous match, APPROVED
 *   spoken  "I'm not qualified to help."      -> matches, REJECTED
 *
 * A reply the policy would refuse to speak was spoken anyway. It lives here so
 * the evaluator and the vendor share ONE definition rather than two copies that
 * can drift. Callers derive the spoken form, evaluate THAT, and submit THAT.
 *
 * IDEMPOTENT by construction: one pass is not always a fixed point (trim or
 * strikethrough removal can expose a heading marker after the heading rule has
 * run), so the pass is repeated until it stops changing. Every rule that
 * changes the string makes it strictly shorter, so the loop terminates.
 * A defensive second call at the vendor boundary therefore cannot change the
 * bytes the policy approved.
 *
 * This is a SPOKEN representation only. What the member sees on screen keeps
 * its markdown; the two representations are allowed to differ.
 */
function normalizeForSpeech(text) {
  let out = normalizeOnce(String(text === null || text === undefined ? '' : text))
  for (let next = normalizeOnce(out); next !== out; next = normalizeOnce(out)) out = next
  return out
}

function normalizeOnce(text) {
  return text
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')  // ***bold italic***
    .replace(/\*\*([^*]+)\*\*/g, '$1')      // **bold**
    .replace(/\*([^*]+)\*/g, '$1')          // *italic*
    .replace(/___([^_]+)___/g, '$1')        // ___bold italic___
    .replace(/__([^_]+)__/g, '$1')          // __bold__
    .replace(/_([^_]+)_/g, '$1')            // _italic_
    .replace(/```[^`]*```/g, '')            // code blocks (removed entirely)
    .replace(/`([^`]+)`/g, '$1')            // inline code
    .replace(/^#{1,6}\s+/gm, '')            // headers
    .replace(/~~([^~]+)~~/g, '$1')          // ~~strikethrough~~
    .trim();
}

module.exports = {
  evaluateRelease,
  evaluateReleaseSafe,
  normalizeForSpeech,
  buildReleaseConstraints,
  takeCompleteSentences,
  hasPresence,
  classifyAbandonment,
  APPROVED_FALLBACK,
  PRESENCE_PATTERNS,
  REFERRAL_MATCH_PATTERNS,
};
