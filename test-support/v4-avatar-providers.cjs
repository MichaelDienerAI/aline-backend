'use strict';
// Simli double for synthetic avatar-session runtime fixtures only.
// Serves compose/token and compose/ice (synthetic STUN/TURN with per-request-style
// credentials). Records each provider call to AVATAR_TEST_CAPTURE; the response mode is read
// from AVATAR_TEST_MODE_FILE on every call. All other outbound requests fail.
const fs = require('node:fs');
const log = record => fs.appendFileSync(process.env.AVATAR_TEST_CAPTURE, JSON.stringify(record) + '\n');
const mode = () => { try { return fs.readFileSync(process.env.AVATAR_TEST_MODE_FILE, 'utf8').trim(); } catch { return 'ok'; } };
const ICE = [{ urls: 'stun:stun.synthetic.test:3478', username: 'synthetic-ice-user-0123', credential: 'synthetic-ice-credential-NEVER-LOGGED-0123' }, { urls: 'turn:turn.synthetic.test:3478?transport=udp', username: 'synthetic-ice-user-0123', credential: 'synthetic-ice-credential-NEVER-LOGGED-0123' }, { urls: 'turns:turn.synthetic.test:5349?transport=tcp', username: 'synthetic-ice-user-0123', credential: 'synthetic-ice-credential-NEVER-LOGGED-0123' }];
global.fetch = async (url, opts = {}) => {
  if (String(url) === 'https://api.simli.ai/compose/ice') {
    log({ type: 'simli_ice', keyHeaderMatches: opts.headers['x-simli-api-key'] === process.env.SIMLI_API_KEY });
    if (mode() === 'ice-fail') return new Response('provider-ice-detail-SHOULD-NEVER-REACH-CLIENT', { status: 500 });
    return new Response(JSON.stringify(ICE), { status: 200 });
  }
  if (String(url) !== 'https://api.simli.ai/compose/token') throw Error('Unexpected outbound request blocked');
  const body = JSON.parse(opts.body);
  log({ type: 'simli', faceId: body.faceId, keys: Object.keys(body).sort(), keyHeaderMatches: opts.headers['x-simli-api-key'] === process.env.SIMLI_API_KEY });
  if (mode() === '401') return new Response('provider-detail-SHOULD-NEVER-REACH-CLIENT', { status: 401 });
  return new Response(JSON.stringify({ session_token: process.env.AVATAR_TEST_TOKEN, warnings: [] }), { status: 200 });
};
