'use strict';
// Supabase + Simli doubles for synthetic identity runtime fixtures only.
// Fixture file (IDENTITY_TEST_FIXTURE, re-read on every call):
//   { users: {<token>: <userId>}, memberships: {<userId>: <status>}, down: bool }
// Every call is recorded to IDENTITY_TEST_CAPTURE. All other outbound requests fail.
const fs = require('node:fs');
const SUPABASE = 'https://synthetic-supabase.test';
const log = record => fs.appendFileSync(process.env.IDENTITY_TEST_CAPTURE, JSON.stringify(record) + '\n');
const fixture = () => JSON.parse(fs.readFileSync(process.env.IDENTITY_TEST_FIXTURE, 'utf8'));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
global.fetch = async (url, opts = {}) => {
  const target = String(url);
  if (target === 'https://api.simli.ai/compose/token') {
    const body = JSON.parse(opts.body);
    log({ type: 'simli', body });
    return json({ session_token: process.env.AVATAR_TEST_TOKEN });
  }
  if (!target.startsWith(SUPABASE + '/')) throw Error('Unexpected outbound request blocked');
  const f = fixture();
  const serviceKeyOk = opts.headers.apikey === process.env.SUPABASE_SERVICE_KEY;
  if (f.down) { log({ type: 'supabase', path: 'down' }); return new Response('raw-supabase-outage-detail', { status: 503 }); }
  if (target === SUPABASE + '/auth/v1/user') {
    const token = (opts.headers.Authorization || '').slice(7);
    log({ type: 'supabase', path: 'user', serviceKeyOk });
    return f.users[token] ? json({ id: f.users[token], aud: 'authenticated' }) : new Response('raw-supabase-jwt-detail', { status: 401 });
  }
  const m = /^\/rest\/v1\/memberships\?select=status&user_id=eq\.([0-9a-f-]{36})$/.exec(target.slice(SUPABASE.length));
  if (m) {
    log({ type: 'supabase', path: 'memberships', serviceKeyOk, serviceBearer: opts.headers.Authorization === 'Bearer ' + process.env.SUPABASE_SERVICE_KEY });
    const status = f.memberships[m[1]];
    return json(status ? [{ status }] : []);
  }
  throw Error('Unexpected Supabase path blocked');
};
