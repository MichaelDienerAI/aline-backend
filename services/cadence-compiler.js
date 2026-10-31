'use strict';

// Pure, lossless cadence compiler. Splits text into spoken segments whose
// concatenation is byte-for-byte identical to the input. No I/O, no network.

const ABBREVIATIONS = new Set([
  'dr.', 'mr.', 'mrs.', 'ms.', 'prof.', 'st.', 'jr.', 'sr.', 'vs.', 'etc.',
  'e.g.', 'i.e.', 'no.', 'inc.', 'ltd.', 'approx.', 'fig.', 'mt.',
]);
const NEGATIONS = new Set(['not', 'no', 'never', 'nor', 'cannot']);
const CLAUSE_MARKERS = new Set([
  'because', 'although', 'though', 'which', 'while', 'whereas', 'unless',
  'since', 'so', 'but', 'and', 'if', 'when', 'where', 'that', 'until',
  'after', 'before',
]);
const PAUSE_MS = { '.': 400, '!': 400, '?': 400, ';': 250, ':': 250, ',': 150, '—': 200 };
const DEFAULT_PAUSE_MS = 80;
// Metadata only: offsets are half-open JavaScript UTF-16 source spans.
// CONTINUE: connected development; SUSPEND: punctuation leaves a relation open;
// BREATH: semicolon respite; LAND: terminal punctuation; HANDOFF: explicit
// end-of-turn context only. These conservative heuristics are not acoustic timing.
// A sentence boundary alone cannot establish that the speaker is yielding.
const BOUNDARIES = Object.freeze(['CONTINUE', 'SUSPEND', 'BREATH', 'LAND', 'HANDOFF']);
function boundaryFor(text, final, endOfTurn) {
  if (final && endOfTurn === true) return 'HANDOFF';
  const core = text.trimEnd().replace(/["”'’)\]]+$/, '');
  if (/[.!?]$/.test(core)) return 'LAND';
  if (/[,:—]$/.test(core)) return 'SUSPEND';
  if (/;$/.test(core)) return 'BREATH';
  return 'CONTINUE';
}
const DEFAULTS = { maxWords: 16, minWords: 4 };

const isSpace = (ch) => /\s/.test(ch);

// top[i] is true when position i (before char i) is outside quotes and brackets.
function topLevelMap(text) {
  const top = new Array(text.length + 1);
  let inQuote = false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    top[i] = !inQuote && depth === 0;
    const ch = text[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '“') inQuote = true;
    else if (ch === '”') inQuote = false;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
  }
  top[text.length] = !inQuote && depth === 0;
  return top;
}

// The token immediately before boundary b, stripped of surrounding quote/bracket marks.
function tokenBefore(text, b) {
  let e = b;
  while (e > 0 && isSpace(text[e - 1])) e--;
  let s = e;
  while (s > 0 && !isSpace(text[s - 1])) s--;
  return text.slice(s, e).replace(/^["“'‘(\[]+/, '').replace(/["”'’)\]]+$/, '');
}

function tokenAfter(text, b) {
  let e = b;
  while (e < text.length && !isSpace(text[e])) e++;
  return text.slice(b, e).replace(/^["“'‘(\[]+/, '').toLowerCase().replace(/[^a-z']/g, '');
}

function isAbbreviation(core) {
  return ABBREVIATIONS.has(core.toLowerCase()) || /^[A-Z]\.$/.test(core);
}

function isNegation(core) {
  const word = core.toLowerCase().replace(/[^a-z']/g, '');
  return NEGATIONS.has(word) || word.endsWith("n't");
}

// A boundary is an offset at the end of a whitespace run, at top level, that does
// not detach an abbreviation from its noun or a negation from what it negates.
function isSafeBoundary(text, b, top) {
  if (b <= 0 || b >= text.length) return false;
  if (!isSpace(text[b - 1]) || isSpace(text[b])) return false;
  if (!top[b]) return false;
  const core = tokenBefore(text, b);
  if (isAbbreviation(core) || isNegation(core)) return false;
  return true;
}

function wordCount(text, a, b) {
  return text.slice(a, b).split(/\s+/).filter(Boolean).length;
}

function splitLong(text, start, end, top, opts) {
  const total = wordCount(text, start, end);
  if (total <= opts.maxWords) return [[start, end]];
  let best = -1;
  let bestDistance = Infinity;
  for (let b = start + 1; b < end; b++) {
    if (!isSafeBoundary(text, b, top)) continue;
    if (!CLAUSE_MARKERS.has(tokenAfter(text, b))) continue;
    const left = wordCount(text, start, b);
    const right = total - left;
    if (left < opts.minWords || right < opts.minWords) continue;
    const distance = Math.abs(left - total / 2);
    if (distance < bestDistance) {
      best = b;
      bestDistance = distance;
    }
  }
  if (best === -1) return [[start, end]];
  return [...splitLong(text, start, best, top, opts), ...splitLong(text, best, end, top, opts)];
}

// Deterministic segmentation: break after clause punctuation, then split overlong
// segments before clause markers. Returns an array of strings.
function segment(text, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  if (typeof text !== 'string' || text.length === 0) return [];
  const top = topLevelMap(text);
  const cuts = [0];
  for (let b = 1; b < text.length; b++) {
    if (!isSafeBoundary(text, b, top)) continue;
    const core = tokenBefore(text, b);
    if (core && Object.prototype.hasOwnProperty.call(PAUSE_MS, core[core.length - 1])) cuts.push(b);
  }
  cuts.push(text.length);
  const ranges = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    ranges.push(...splitLong(text, cuts[i], cuts[i + 1], top, opts));
  }
  return ranges.map(([a, b]) => text.slice(a, b));
}

function pauseFor(segmentText) {
  const core = segmentText.trimEnd().replace(/["”'’)\]]+$/, '');
  const last = core[core.length - 1];
  return Object.prototype.hasOwnProperty.call(PAUSE_MS, last) ? PAUSE_MS[last] : DEFAULT_PAUSE_MS;
}

// Returns null when the plan is usable, otherwise a reason string.
function validatePlan(text, plan) {
  const parts = Array.isArray(plan) ? plan : plan && plan.segments;
  if (!Array.isArray(parts)) return 'plan_not_array';
  if (parts.length === 0) return 'plan_empty';
  if (!parts.every((p) => typeof p === 'string' && p.length > 0)) return 'plan_bad_segment';
  if (parts.join('') !== text) return 'plan_not_lossless';
  const top = topLevelMap(text);
  let offset = 0;
  for (let i = 0; i < parts.length - 1; i++) {
    offset += parts[i].length;
    if (!isSafeBoundary(text, offset, top)) return 'plan_unsafe_boundary';
  }
  return null;
}

// compile(text, plan?) -> { segments: [{ text, start, end, boundary, pauseMs }], source, fallbackReason }
// pauseMs is legacy advisory metadata only; never a production timing instruction.
// A supplied plan (array of strings, or { segments }) is used only if it is valid;
// otherwise the deterministic segmentation is used.
function compile(text, plan, options = {}) {
  if (typeof text !== 'string') throw new TypeError('compile: text must be a string');
  let parts;
  let source = 'deterministic';
  let fallbackReason = null;
  if (plan !== undefined) {
    fallbackReason = validatePlan(text, plan);
    if (fallbackReason === null) {
      parts = Array.isArray(plan) ? plan : plan.segments;
      source = 'plan';
    } else {
      source = 'fallback';
    }
  }
  if (!parts) parts = segment(text, options);
  let offset = 0;
  return {
    segments: parts.map((p, i) => {
      const start = offset;
      offset += p.length;
      return { text: p, start, end: offset,
        boundary: boundaryFor(p, i === parts.length - 1, options.endOfTurn),
        pauseMs: pauseFor(p) };
    }),
    source,
    fallbackReason,
  };
}

function reconstruct(result) {
  return result.segments.map((s) => s.text).join('');
}

module.exports = { BOUNDARIES, compile, segment, validatePlan, reconstruct, isSafeBoundary, topLevelMap };
