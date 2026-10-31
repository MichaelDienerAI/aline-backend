/**
 * Crisis Override Module
 * 
 * Handles explicit self-harm intent independently of emotional weight,
 * plus the existing W21 distress route. Appends after ordinary release.
 * 
 * CRITICAL: This module injects 988 AFTER invariant-gate runs,
 * so the crisis hotline reference is never stripped by abandonment detection.
 * 
 * No AI calls. Bounded lexical routing, not a comprehensive risk assessment.
 * 
 * MRA Architecture: Stage 3 — crisis-override.js
 * Classification: INTERNAL ENGINEERING — PERSONA IO
 */

// ---------------------------------------------------------------------------
// Crisis Constants
// ---------------------------------------------------------------------------

const CRISIS_WEIGHT = 21;

// Only unquoted, current assertions participate in lexical routing. These
// bounded English exclusions prevent widening the old keyword route when
// bypassing weight. They are not a general quotation/temporal parser.
function currentAssertionText(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[’]/g, "'")
    .replace(/"[^"\n]*"|“[^”\n]*”|(?:^|\s)'[^'\n]+'(?=\s|[.!?,;:]|$)/g, ' ')
    .split(/(?<=[.!?;])\s+|\n+|\bbut\s+(?=i\b)/i)
    .filter(sentence => !/\b(hypothetically|fictional|in (?:a|the) (?:story|novel|movie)|for example|what if|last year|years? ago|used to|back then)\b/i.test(sentence))
    // Remove only the negated intent span, so a later affirmative clause can
    // still trigger. Do not strip "I don't want to be here" (legacy distress).
    .map(sentence => sentence.replace(/\bi(?: am not|[' ]m not| do not| don't| will not| won't| would never)\s+(?:(?:going|planning|about) to\s+|want to\s+)?(?:kill myself|hurt myself|harm myself|end my life|take my own life|commit suicide|die)\b/gi, ' '))
    .join(' ').trim();
}

function hasExplicitSelfHarmIntent(text) {
  // A conditional antecedent ("If she leaves me, ...") is not itself a
  // hypothetical discussion: an affirmative first-person consequent counts.
  return /(?:^|[,;.!?]\s*|\b(?:then|but|and)\s+|^if\b(?![^.!?;]*\b(?:say|says|said|quote|example)\b)[^.!?;]*?\s+)i(?:\s+(?:will|intend to|plan to|want to)|'ll|(?:'m| am)\s+(?:going|planning|about) to)\s+(?:(?:really|seriously|actually)\s+)?(?:kill myself|hurt myself|harm myself|end my life|take my own life|commit suicide)\b/i.test(text);
}

// External attribution exclusion — these contexts indicate political/social frustration,
// not personal crisis. Crisis suffix must not fire when the distress is about external actors.
const EXTERNAL_ATTRIBUTION_PATTERNS = [
  /\b(trump|republicans?|democrats?|congress|senate|government|politicians?|biden|obama|maga)\b/i,
  /\b(they|them|these people|those people)\s+(are|have|keep|just|always|never|won't|don't)\b/i,
  /\b(this country|this administration|this government|the media|the left|the right)\b/i,
  /\bruining\s+(everything|the country|our country|this country|america)\b/i,
];

function isExternalAttribution(userMessage) {
  if (!userMessage) return false;
  return EXTERNAL_ATTRIBUTION_PATTERNS.some(pattern => pattern.test(userMessage));
}

// Safety suffix - minimal, quiet register, presence-first
const CRISIS_SUFFIX = " I'm here with you. If you're in crisis, please reach out to 988.";

// ---------------------------------------------------------------------------
// Atelier Logging (stub - replace with real Atelier client in production)
// ---------------------------------------------------------------------------

/**
 * Log a crisis activation artifact to Atelier.
 * In production, this calls the Atelier API.
 * 
 * @param {string} sessionId - Current session ID
 * @param {Object} metadata - Additional metadata for the artifact
 */
async function logCrisisArtifact(sessionId, metadata = {}) {
  const artifact = {
    type: 'CRISIS_ACTIVATED',
    sessionId,
    timestamp: new Date().toISOString(),
    weight: CRISIS_WEIGHT,
    ...metadata,
  };
  
  console.log('[Crisis] Logging artifact to Atelier:', JSON.stringify(artifact));
  
  // In production, this would be:
  // await atelierClient.logArtifact(artifact);
  
  // For now, we log to console. The server.js integration should
  // call the real Atelier logTurn or logArtifact method.
  
  return artifact;
}

// ---------------------------------------------------------------------------
// Main Crisis Override Function
// ---------------------------------------------------------------------------

/**
 * crisisOverride - Main crisis handler function
 * 
 * Explicit first-person intent bypasses weight and external-topic exclusions.
 * Otherwise the legacy W21 distress route applies. The suffix is returned
 * separately for the runtime to append; it does not replace released text.
 * 
 * @param {Object} input - The input object
 * @param {Object} input.classification - FEC classification result
 * @param {number} input.classification.weight - Fibonacci weight (1-21)
 * @param {string} input.response - The response text (post-invariant-enforcer)
 * @param {string} input.sessionId - Current session ID for Atelier logging
 * 
 * @returns {Object} Result with override boolean and modifiedResponse
 */
async function crisisOverride(input) {
  const startTime = Date.now();
  
  // Handle null/undefined input gracefully
  if (!input) {
    console.log('[Crisis] Received null input, returning pass-through');
    return {
      override: false,
      modifiedResponse: null,
    };
  }
  
  const {
    classification = { weight: 1 },
    response = '',
    sessionId = null,
  } = input;
  
  const weight = classification?.weight ?? 1;
  const userText = input.userMessage || input.transcribedText || input.text || '';
  const assertionText = currentAssertionText(userText);
  const explicitIntent = hasExplicitSelfHarmIntent(assertionText);
  
  console.log('[Crisis] Checking weight:', weight, '(threshold:', CRISIS_WEIGHT + ')');
  
  // Emotional weight must not veto an explicit first-person intent statement.
  if (!explicitIntent && weight < CRISIS_WEIGHT) {
    const elapsed = Date.now() - startTime;
    console.log('[Crisis] Below threshold, pass-through in', elapsed, 'ms');
    return {
      override: false,
      modifiedResponse: response,
    };
  }
      // External attribution exclusion — skip 988 for political/social frustration
      if (!explicitIntent && isExternalAttribution(userText)) {
              console.log('[Crisis] External attribution detected, skipping crisis suffix');
              return {
                        override: false,
                        modifiedResponse: response,
              };
      }
  
  // Require explicit crisis language - W21 alone is not enough
  const categories = classification?.dimensions?.[0]?.categories || [];
  // A category derived from discarded quotation/context must not restore it.
  const hasCrisisPhrase = assertionText === userText && categories.includes('crisis_phrase');
  const CRISIS_KEYWORDS = ["don't want to be here", "dont want to be here", "can't go on", "cant go on", "no reason to live", "not worth living", "end it", "kill myself", "suicide", "want to die"];
  const hasCrisisKeyword = CRISIS_KEYWORDS.some(kw => assertionText.toLowerCase().includes(kw));

  if (!explicitIntent && !hasCrisisPhrase && !hasCrisisKeyword) {
    console.log('[Crisis] W21 but no crisis phrase detected - skipping suffix');
    return {
      override: false,
      modifiedResponse: response,
    };
  }

  console.log('[Crisis] CRISIS ACTIVATED:', explicitIntent ? 'explicit intent' : 'W21 distress');
  
  // Append safety suffix to response
  // The suffix is designed to be non-abandoning (presence-first: "I'm here with you")
  // followed by the minimal safety information (988)
  let modifiedResponse = response;
  let crisisSuffix = null;
  
  // Only append if the response doesn't already contain 988
  if (!response.includes('988')) {
    modifiedResponse = response.trimEnd();
    crisisSuffix = CRISIS_SUFFIX;
    console.log('[Crisis] Appended safety suffix');
  } else {
    console.log('[Crisis] Response already contains 988, no modification needed');
  }
  
  // Log crisis artifact to Atelier
  if (sessionId) {
    try {
      await logCrisisArtifact(sessionId, {
        originalLength: response.length,
        modifiedLength: modifiedResponse.length,
        category: classification?.category || 'crisis',
      });
    } catch (error) {
      // Don't fail the response for logging errors
      console.error('[Crisis] Failed to log artifact:', error.message);
    }
  }
  
  const elapsed = Date.now() - startTime;
  console.log('[Crisis] Override complete in', elapsed, 'ms');
  
  return {
    override: true,
    modifiedResponse,
    crisisSuffix,
  };
}

// ---------------------------------------------------------------------------
// Module Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Raw-text predicate shares exactly the existing quotation/negation guards.
  detectExplicitCrisisIntent: text => hasExplicitSelfHarmIntent(currentAssertionText(text)),
  crisisOverride,
  CRISIS_WEIGHT,
  CRISIS_SUFFIX,
};

// ---------------------------------------------------------------------------
// server.js Integration (DO NOT APPLY — reference only)
// ---------------------------------------------------------------------------

/*
 * In server.js processUtterance(), AFTER invariantEnforcer call:
 *
 *   // Run invariant enforcer first
 *   const enforcerResult = await invariantEnforcer({
 *     response: fullResponse,
 *     fecResult,
 *     conversationHistory
 *   });
 *   
 *   // Use the enforced response (or original if compliant)
 *   let finalResponse = enforcerResult.modifiedResponse || fullResponse;
 *   
 *   // THEN run crisis override (AFTER invariant-enforcer, BEFORE TTS)
 *   const { crisisOverride } = require('./services/crisis-override');
 *   const crisisResult = await crisisOverride({
 *     classification: fecResult,
 *     response: finalResponse,
 *     sessionId: sessionId,
 *   });
 *   
 *   // Use crisis-modified response
 *   if (crisisResult.override) {
 *     finalResponse = crisisResult.modifiedResponse;
 *   }
 *   
 *   // Now send finalResponse to TTS
 *
 * This order ensures:
 * 1. Invariant-enforcer runs first and may strip referrals/hotlines
 * 2. Crisis-override runs second and injects 988 (never stripped)
 */
