'use strict';

const compiler = require('./cadence-compiler');

// One opt-in switch covers both Aline composition and metadata compilation.
// Unknown persona IDs and Chase retain the baseline path.
const isEnabled = (persona, env = process.env) =>
  persona === 'aline' && env.ALINE_CADENCE_V1 === '1';

const COMPOSITION_RULES = `
ALINE CADENCE V1 — PRE-APPROVAL COMPOSITION
Prioritize: required safety/task content; direct answer or response; minimum explanation necessary; optional elaboration. Preserve every required proposition and qualifier.
Before adding a sentence, ask silently: Has the point landed? Would another sentence merely explain what timing can carry? Would another sentence enlarge the user's disclosure? Would more explicitness bleach useful ambiguity? Does the next sentence materially change understanding? Is this the right moment to say it?
JO → HA → KYŪ is directional: establish relevance; develop only what is needed; land and yield. Do not force three sections.
Do not add filler, fake hesitation, stammers, accent spelling, random pauses, theatrical ellipses, or artificial slowness. Do not automatically play reserved elaboration.
Do not overcompress factual, technical, legal, medical, instructional, or explicitly requested long-form answers. Preserve needed detail even when brevity guidance would otherwise shorten it. These composition rules do not change safety or crisis policy.
`;

// Untrusted metadata cannot supply spoken words or an authorization verdict.
// Any malformed output is discarded; the caller retains canonical speech.
function compileCanonical(canonical, compile = compiler.compile) {
  try {
    const plan = compile(canonical);
    if (!plan || !Array.isArray(plan.segments)) return null;
    let offset = 0;
    for (const part of plan.segments) {
      if (!part || typeof part.text !== 'string' || !part.text.length ||
          !Number.isInteger(part.start) || !Number.isInteger(part.end) ||
          part.start !== offset || part.end <= part.start ||
          part.end > canonical.length ||
          part.text !== canonical.slice(part.start, part.end) ||
          !compiler.BOUNDARIES.includes(part.boundary)) return null;
      offset = part.end;
    }
    if (offset !== canonical.length || compiler.reconstruct(plan) !== canonical) return null;
    if (canonical && compiler.validatePlan(canonical, plan.segments.map(p => p.text))) return null;
    return plan;
  } catch {
    return null;
  }
}

module.exports = { isEnabled, compileCanonical, COMPOSITION_RULES };
