'use strict';
// Persona iO answers are bounded by max_tokens. When the model stops at that
// ceiling (stop_reason 'max_tokens') the text after the last finished sentence
// is an unfinished fragment: it is never shown and never spoken. Finished
// sentences are kept, including one whose terminal punctuation is the last
// thing the model wrote. Closing straight or curly quotes and brackets belong
// to the sentence they close.

const FINISHED = /[^.!?]*[.!?]+(?:["'”’)\]]+)?(?=\s|$)/g;

function takeFinishedSentences(buffer) {
  const sentences = [];
  let consumed = 0;
  let m;
  FINISHED.lastIndex = 0;
  while ((m = FINISHED.exec(buffer)) !== null) {
    const end = m.index + m[0].length;
    const piece = buffer.slice(consumed, end);
    if (piece.trim().length > 0) sentences.push(piece);
    consumed = end;
  }
  return { sentences, fragment: buffer.slice(consumed) };
}

// One line per model response. Metadata only: persona, stop reason and output
// token count, never message content.
function modelResponseLog(persona, stopReason, outputTokens) {
  return `[model] ${JSON.stringify({
    persona,
    stopReason: typeof stopReason === 'string' ? stopReason : null,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
  })}`;
}

module.exports = { takeFinishedSentences, modelResponseLog };
