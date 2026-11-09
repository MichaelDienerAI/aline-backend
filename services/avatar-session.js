'use strict';
// v4 avatar-session boundary. An authenticated member asks for one short-lived
// Simli session token for a confidante, plus the ICE servers (STUN and TURN
// relays with per-request credentials) its peer connection needs. The
// long-lived SIMLI_API_KEY never leaves the server; the browser receives only
// the session token and the ICE list.
//
// Order of checks is the contract: origin → method → credential format →
// member identity → body (bounded, deadline) → confidante → rate limit →
// provider. Nothing before the provider step contacts Simli, and no request
// body is read for an unauthenticated caller. memberRuntime.authenticate may
// be async (Supabase identity, services/member-identity).

const { validPersona } = require('./member-memory');

const PATH = '/v4/avatar-session';
// Exact production frontend origin (Vercel custom domain). Endpoint-only;
// the global wildcard CORS used by other routes does not apply here.
const ALLOWED_ORIGINS = Object.freeze(['https://personaio.app']);
// Extra exact origins (e.g. one approved preview) come from configuration:
// https scheme, host only, no wildcard, port, path or trailing slash.
const EXACT_ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
function parseAllowedOrigins(extra = '') {
  const added = String(extra).split(',').map(o => o.trim()).filter(Boolean);
  return Object.freeze([...new Set([...ALLOWED_ORIGINS, ...added.filter(o => EXACT_ORIGIN.test(o))])]);
}
const SIMLI_TOKEN_URL = 'https://api.simli.ai/compose/token';
const SIMLI_ICE_URL = 'https://api.simli.ai/compose/ice';
const MAX_ICE_SERVERS = 10;
const ICE_URL = /^(stun|turn|turns):[^\s]{1,256}$/;
// Product limits for Persona iO v4 avatar sessions. Simli's idle timer resets
// only on detected speech, and the avatar is silent while the member speaks or
// the model thinks; 60 s ended live sessions mid-conversation. 300 s is
// Simli's documented default.
const SESSION_LIMITS = Object.freeze({ maxSessionLength: 900, maxIdleTime: 300 });
const TOKEN_TTL_SECONDS = 300;
const MAX_BODY_BYTES = 4096;
const MAX_PROVIDER_BODY_BYTES = 16_384;

// Bounded failure literals. Logged alone with the HTTP status; never the
// provider body, the key, the token, or any credential.
const FAILURE = {
  AUTH: 'simli_auth_failure',
  RATE: 'simli_rate_limited',
  HTTP: 'simli_http_failure',
  MALFORMED: 'simli_malformed_response',
  ICE: 'simli_ice_failure',
  TIMEOUT: 'simli_timeout',
  TRANSPORT: 'simli_transport_failure',
  KEY_MISSING: 'simli_key_missing',
  MEMBER_STORE: 'member_store_failure',
  INTERNAL: 'avatar_internal_failure',
};

// In-memory limiter for the single-replica deployment. Replaceable by any
// object with the same take(key) → {ok, retryAfterSeconds} shape.
function createRateLimiter({ minIntervalMs = 10_000, maxPerWindow = 20, windowMs = 3_600_000, now = Date.now } = {}) {
  const history = new Map();
  return {
    take(key) {
      const t = now();
      const recent = (history.get(key) || []).filter(at => t - at < windowMs);
      const last = recent.at(-1);
      let waitMs = 0;
      if (last !== undefined && t - last < minIntervalMs) waitMs = minIntervalMs - (t - last);
      if (recent.length >= maxPerWindow) waitMs = Math.max(waitMs, windowMs - (t - recent[0]));
      if (waitMs > 0) { history.set(key, recent); return { ok: false, retryAfterSeconds: Math.ceil(waitMs / 1000) }; }
      recent.push(t);
      history.set(key, recent);
      return { ok: true };
    },
  };
}

// Read a provider response body under a byte cap. Throws on overflow after
// cancelling the stream so the connection is released. Abort cancels the
// reader directly, which settles a pending read even if the stream itself
// ignores the signal.
async function readLimited(response, maxBytes, signal) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const onAbort = () => { reader.cancel().catch(() => {}); };
  if (signal.aborted) onAbort();
  signal.addEventListener('abort', onAbort, { once: true });
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { reader.cancel().catch(() => {}); throw Object.assign(Error('provider body too large'), { code: 'too_large' }); }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  return Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
}

function createAvatarSession({ memberRuntime, faceIds, getApiKey, fetch, timeoutMs = 10_000, bodyTimeoutMs = 5_000, limiter = createRateLimiter(), log = console.error, allowedOrigins = ALLOWED_ORIGINS }) {
  const logFailure = (failure, status = null) => log(`[avatar] ${JSON.stringify({ component: 'avatar-session', failure, status })}`);

  function send(res, status, body, extra = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
    res.end(JSON.stringify(body));
  }

  // Resolves {body} | {error: 'invalid' | 'timeout' | 'aborted'}; always settles.
  function readBody(req) {
    return new Promise(resolve => {
      let size = 0;
      let settled = false;
      const chunks = [];
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        req.removeListener('data', onData);
        resolve(result);
      };
      const timer = setTimeout(() => finish({ error: 'timeout' }), bodyTimeoutMs);
      const onData = chunk => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) { finish({ error: 'invalid' }); req.resume(); return; }
        chunks.push(chunk);
      };
      req.on('data', onData);
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          finish(body && typeof body === 'object' && !Array.isArray(body) ? { body } : { error: 'invalid' });
        } catch { finish({ error: 'invalid' }); }
      });
      req.on('error', () => finish({ error: 'aborted' }));
      req.on('close', () => finish({ error: 'aborted' }));
    });
  }

  async function mint(apiKey, faceId) {
    const controller = new AbortController();
    // One deadline covers headers and body.
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetch(SIMLI_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-simli-api-key': apiKey },
          body: JSON.stringify({ faceId, apiVersion: 'v2', ...SESSION_LIMITS }),
          signal: controller.signal,
        });
      } catch (err) {
        return err && err.name === 'AbortError' ? { failure: FAILURE.TIMEOUT, status: 504 } : { failure: FAILURE.TRANSPORT, status: 502 };
      }
      const providerStatus = response.status;
      const failed = providerStatus === 401 || providerStatus === 403 ? FAILURE.AUTH
        : providerStatus === 429 ? FAILURE.RATE
        : !response.ok ? FAILURE.HTTP
        : null;
      if (failed) {
        // Unread error bodies would pin the connection; release it.
        if (response.body) response.body.cancel().catch(() => {});
        return { failure: failed, status: 502, providerStatus };
      }
      let text;
      try {
        text = await readLimited(response, MAX_PROVIDER_BODY_BYTES, controller.signal);
      } catch (err) {
        if (controller.signal.aborted || (err && err.name === 'AbortError')) return { failure: FAILURE.TIMEOUT, status: 504, providerStatus };
        return { failure: FAILURE.MALFORMED, status: 502, providerStatus };
      }
      if (controller.signal.aborted) return { failure: FAILURE.TIMEOUT, status: 504, providerStatus };
      let data;
      try { data = JSON.parse(text); } catch { return { failure: FAILURE.MALFORMED, status: 502, providerStatus }; }
      const token = data && data.session_token;
      if (typeof token !== 'string' || token.length < 16 || /^FAIL/i.test(token)) return { failure: FAILURE.MALFORMED, status: 502, providerStatus };
      return { token };
    } finally {
      clearTimeout(timer);
    }
  }

  // Simli's ICE list: STUN plus TURN relays whose username/credential Simli
  // issues per request. Only urls/username/credential of well-formed entries
  // are passed on; anything else fails the avatar session (no silent
  // degradation to a browser-side key path).
  async function ice(apiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetch(SIMLI_ICE_URL, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'x-simli-api-key': apiKey },
          signal: controller.signal,
        });
      } catch (err) {
        return { failure: FAILURE.ICE, status: err && err.name === 'AbortError' ? 504 : 502 };
      }
      const providerStatus = response.status;
      if (!response.ok) {
        if (response.body) response.body.cancel().catch(() => {});
        return { failure: FAILURE.ICE, status: 502, providerStatus };
      }
      let list;
      try {
        list = JSON.parse(await readLimited(response, MAX_PROVIDER_BODY_BYTES, controller.signal));
      } catch {
        return { failure: FAILURE.ICE, status: controller.signal.aborted ? 504 : 502, providerStatus };
      }
      if (!Array.isArray(list) || list.length === 0 || list.length > MAX_ICE_SERVERS) return { failure: FAILURE.ICE, status: 502, providerStatus };
      const iceServers = [];
      for (const entry of list) {
        const urls = entry && (Array.isArray(entry.urls) ? entry.urls : [entry.urls]);
        if (!urls || urls.length === 0 || !urls.every(u => typeof u === 'string' && ICE_URL.test(u))) return { failure: FAILURE.ICE, status: 502, providerStatus };
        const server = { urls };
        for (const field of ['username', 'credential']) {
          if (entry[field] === undefined) continue;
          if (typeof entry[field] !== 'string' || entry[field].length > 512) return { failure: FAILURE.ICE, status: 502, providerStatus };
          server[field] = entry[field];
        }
        iceServers.push(server);
      }
      return { iceServers };
    } finally {
      clearTimeout(timer);
    }
  }

  // String comparison only: req.url is attacker-controlled and new URL() can
  // throw on it, which here would sit outside the fault boundary below.
  function matches(req) {
    return typeof req.url === 'string' && req.url.split('?')[0] === PATH;
  }

  // Contain every fault here. An unhandled rejection would terminate the
  // process and drop live WebSocket conversations with it.
  async function handle(req, res) {
    try {
      return await handleRequest(req, res);
    } catch {
      logFailure(FAILURE.INTERNAL);
      if (!res.headersSent) return send(res, 500, { error: 'internal_error' });
      res.destroy();
    }
  }

  async function handleRequest(req, res) {
    // The global handler has already set wildcard CORS; this endpoint replaces it.
    res.removeHeader('Access-Control-Allow-Origin');
    res.removeHeader('Access-Control-Allow-Methods');
    res.removeHeader('Access-Control-Allow-Headers');
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !allowedOrigins.includes(origin)) return send(res, 403, { error: 'origin_not_allowed' });
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, { ...cors, Allow: 'POST, OPTIONS' });

    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer \S+$/.test(authorization)) return send(res, 401, { error: 'unauthenticated' }, { ...cors, Connection: 'close' });

    // Credential is a header, so it is checked before any body byte is read.
    let memberId;
    try {
      memberId = await memberRuntime.authenticate(authorization);
    } catch (err) {
      const code = err && (err.code || err.message);
      if (code === 'unauthenticated') return send(res, 401, { error: 'unauthenticated' }, { ...cors, Connection: 'close' });
      if (code === 'membership_required') return send(res, 403, { error: 'membership_required' }, { ...cors, Connection: 'close' });
      if (code === 'identity_unavailable') return send(res, 503, { error: 'identity_unavailable' }, { ...cors, Connection: 'close' });
      logFailure(FAILURE.MEMBER_STORE);
      return send(res, 500, { error: 'internal_error' }, cors);
    }

    const read = await readBody(req);
    if (read.error === 'aborted') return res.destroy();
    if (read.error === 'timeout') {
      // Flush the 408, then drop the stalled connection.
      res.once('finish', () => req.destroy());
      return send(res, 408, { error: 'request_timeout' }, { ...cors, Connection: 'close' });
    }
    if (read.error) return send(res, 400, { error: 'invalid_request' }, { ...cors, Connection: 'close' });
    const { persona } = read.body;

    const faceId = validPersona(persona) && Object.prototype.hasOwnProperty.call(faceIds, persona) ? faceIds[persona] : null;
    if (!faceId) return send(res, 400, { error: 'invalid_confidante' }, cors);

    const slot = limiter.take(memberId);
    if (!slot.ok) return send(res, 429, { error: 'rate_limited' }, { ...cors, 'Retry-After': String(slot.retryAfterSeconds) });

    const apiKey = getApiKey();
    if (!apiKey) { logFailure(FAILURE.KEY_MISSING); return send(res, 503, { error: 'avatar_unavailable' }, cors); }

    const [result, relay] = await Promise.all([mint(apiKey, faceId), ice(apiKey)]);
    if (!result.token) { logFailure(result.failure, result.providerStatus ?? null); return send(res, result.status, { error: 'avatar_unavailable' }, cors); }
    if (!relay.iceServers) { logFailure(relay.failure, relay.providerStatus ?? null); return send(res, relay.status, { error: 'avatar_unavailable' }, cors); }
    return send(res, 200, { provider: 'simli', sessionToken: result.token, expiresInSeconds: TOKEN_TTL_SECONDS, iceServers: relay.iceServers }, cors);
  }

  return { matches, handle };
}

module.exports = { createAvatarSession, createRateLimiter, parseAllowedOrigins, ALLOWED_ORIGINS, PATH, SESSION_LIMITS };
