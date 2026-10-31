'use strict';
// Per-connection epochs cover queued, active, and late-arriving work.
function createSpeechLifecycle() {
  let epoch = 0;
  const active = new Set();
  function cancel() {
    epoch++;
    for (const stop of active) { try { stop(); } catch {} }
    active.clear();
  }
  return {
    begin() { cancel(); return epoch; },
    cancel,
    current(token) { return token === epoch; },
    track(token, stop) {
      if (token !== epoch) { stop(); return () => {}; }
      active.add(stop); return () => active.delete(stop);
    }
  };
}
module.exports = {createSpeechLifecycle};
