'use strict';
// Verified external identity → one Persona member. Supabase decides who the
// caller is and whether their membership is active; the member store decides
// which Persona member that person is. Both v4 entry points (/v4/avatar-session
// and the WebSocket) resolve through resolveToken, so one person is one member
// everywhere.
//
// Order is the contract: token shape → local expiry → Supabase user (server
// side) → active membership → find-or-enroll. Any failure is fail-closed and
// never falls back to the shared demo member. Tokens, keys and provider bodies
// are never logged; failures log a bounded literal and status only.

const PROVIDER = 'supabase';
const SUBPROTOCOL = 'persona.v1';
const MAX_TOKEN_BYTES = 4096;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const coded = code => Object.assign(Error(code), { code });

// Persona member credentials are base64url without dots, so the two credential
// kinds cannot be confused.
const isSupabaseToken = token => typeof token === 'string' && token.length <= MAX_TOKEN_BYTES && JWT_SHAPE.test(token);

// Rejects early without a network call. Not an acceptance check: only
// Supabase can accept a token.
function expiredOrUnreadable(token, now) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp !== 'number' || payload.exp * 1000 <= now();
  } catch {
    return true;
  }
}

function createSupabaseVerifier({ url, serviceKey, fetch, timeoutMs = 5_000 }) {
  const base = String(url).replace(/\/+$/, '');

  async function call(path, bearer) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(base + path, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${bearer}` },
        signal: controller.signal,
      });
      let body = null;
      if (response.ok) { try { body = await response.json(); } catch { body = null; } }
      else if (response.body) response.body.cancel().catch(() => {});
      return { status: response.status, body };
    } catch {
      throw coded('identity_unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    // The user comes only from Supabase's answer, never from the token payload.
    async user(token) {
      const { status, body } = await call('/auth/v1/user', token);
      if (status === 401 || status === 403) throw coded('unauthenticated');
      if (status !== 200) throw coded('identity_unavailable');
      if (!body || typeof body.id !== 'string' || !UUID.test(body.id)) throw coded('unauthenticated');
      return { id: body.id };
    },
    // Mirrors the frontend middleware: exactly one memberships row, active.
    async activeMembership(userId) {
      if (!UUID.test(userId)) throw coded('unauthenticated');
      const { status, body } = await call(`/rest/v1/memberships?select=status&user_id=eq.${userId}`, serviceKey);
      if (status !== 200 || !Array.isArray(body)) throw coded('identity_unavailable');
      return body.length === 1 && !!body[0] && body[0].status === 'active';
    },
  };
}

function createMemberIdentity({ runtime, verifier, now = Date.now, log = console.error }) {
  const logFailure = (failure, status) => log(`[identity] ${JSON.stringify({ component: 'member-identity', failure, status })}`);

  async function resolveToken(token) {
    if (!isSupabaseToken(token) || expiredOrUnreadable(token, now)) throw coded('unauthenticated');
    if (!verifier) { logFailure('identity_not_configured', 503); throw coded('identity_unavailable'); }
    let user;
    let active;
    try {
      user = await verifier.user(token);
      active = await verifier.activeMembership(user.id);
    } catch (err) {
      if (err && err.code === 'unauthenticated') throw coded('unauthenticated');
      logFailure('supabase_unavailable', 503);
      throw coded('identity_unavailable');
    }
    if (!active) throw coded('membership_required');
    try {
      return runtime.externalMember(PROVIDER, user.id);
    } catch {
      logFailure('member_store_failure', 500);
      throw coded('member_store_failure');
    }
  }

  return {
    // HTTP: a Supabase access token, or a Persona member credential (tests,
    // rehearsal harness). The shape decides; there is no fallback between them.
    async authenticate(authorization) {
      if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) throw coded('unauthenticated');
      const credential = authorization.slice(7);
      if (isSupabaseToken(credential)) return resolveToken(credential);
      return runtime.authenticate(authorization);
    },
    // WebSocket upgrade. Browsers cannot set headers on a WebSocket, so the
    // token is offered as the subprotocol after SUBPROTOCOL. Returns null when
    // no Supabase proof was offered (the existing credential and bridge paths
    // then apply), otherwise {memberId} or {error}.
    async verifyUpgrade(req) {
      const header = req.headers['sec-websocket-protocol'];
      if (typeof header !== 'string') return null;
      const offered = header.split(',').map(p => p.trim()).filter(Boolean);
      if (!offered.includes(SUBPROTOCOL)) return null;
      const tokens = offered.filter(p => p !== SUBPROTOCOL);
      try {
        if (tokens.length !== 1) throw coded('unauthenticated');
        return { memberId: await resolveToken(tokens[0]) };
      } catch (err) {
        return { error: (err && err.code) || 'member_store_failure' };
      }
    },
  };
}

// The only subprotocol the server ever echoes. Echoing the token would hand
// it back in a response header.
function selectProtocol(protocols) {
  return protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false;
}

module.exports = { createMemberIdentity, createSupabaseVerifier, selectProtocol, isSupabaseToken, PROVIDER, SUBPROTOCOL };
