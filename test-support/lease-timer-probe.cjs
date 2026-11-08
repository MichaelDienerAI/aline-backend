'use strict';
// Records each authorization lease timer (callback named expireLease): arm,
// clear and fire, to LEASE_TEST_CAPTURE. Synthetic lease tests only.
const fs = require('node:fs');
const log = record => fs.appendFileSync(process.env.LEASE_TEST_CAPTURE, JSON.stringify({ ...record, at: Date.now() }) + '\n');
const live = new Set();
const set = global.setTimeout;
const clear = global.clearTimeout;
let next = 0;
global.setTimeout = function (fn, ms, ...args) {
  if (!fn || fn.name !== 'expireLease') return set(fn, ms, ...args);
  const lease = ++next;
  const timer = set(function () { live.delete(timer); log({ lease, event: 'fire' }); return fn.apply(this, arguments); }, ms, ...args);
  timer.lease = lease;
  live.add(timer);
  log({ lease, event: 'arm', ms });
  return timer;
};
global.clearTimeout = function (timer) {
  if (timer && timer.lease && live.delete(timer)) log({ lease: timer.lease, event: 'clear' });
  return clear(timer);
};
