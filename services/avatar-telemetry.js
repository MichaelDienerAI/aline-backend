'use strict';
// Avatar lifecycle telemetry. The member page reports what its Simli avatar
// connection is doing ({"type":"avatar_telemetry"} text frames) on the member
// WebSocket it already holds, so the frames arrive only on a socket that
// passed Supabase authentication and the lease gate; there is no endpoint of
// its own. Each accepted event becomes one stdout line, "[avatar] {...}", and
// is kept nowhere else: retention is the platform's log retention.
//
// The schema is an allowlist and the server is its authority. Every field is
// an enum, a bounded integer, or `sid`, an ephemeral random id the page draws
// per avatar lifecycle (page load) that correlates one avatar session's events
// and identifies nobody. Everything else in a frame (unknown keys, strings
// outside an enum, wrong types, out-of-range numbers) is dropped, so speech,
// prompts, transcripts, memory, tokens, SDP and ICE credentials cannot reach
// the output even when a client sends them. The persona is the server's own
// for the socket, never the client's. No member identifier is written.

const PC_STATES = ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'];
const ICE_STATES = ['new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed'];

const EVENTS = new Set([
  // Lifecycle (the page's runAvatarSession)
  'avatar_mint_ok', 'avatar_mint_failed', 'avatar_remint', 'avatar_started', 'avatar_start_failed',
  'avatar_client_stop', 'avatar_client_error', 'avatar_page_stop', 'avatar_terminal',
  // Media (observed on the Simli peer connection, signaling socket and remote tracks)
  ...PC_STATES.map(s => 'avatar_pc_' + s),
  ...ICE_STATES.map(s => 'avatar_ice_' + s),
  ...['audio', 'video'].flatMap(k => ['ended', 'mute', 'unmute'].map(e => `avatar_${k}_track_${e}`)),
  'avatar_signal_closed', 'avatar_signal_error', 'avatar_signal_event',
  'avatar_snapshot', 'avatar_observe_unavailable',
]);

const TRACK_STATES = ['live', 'muted', 'ended', 'none'];
const ENUMS = Object.freeze({
  // Simli control word, classified the way simli-client 3.0.1 classifies it.
  signal: ['START', 'STOP', 'ENDFRAME', 'CLOSING', 'RATE', 'ERROR', 'SDP', 'LIVEKIT', 'VIDEO_METADATA', 'DESTINATION', 'OTHER'],
  category: [
    // mint failures
    'network', 'unauthenticated', 'rejected', 'rate_limited', 'server_error', 'invalid_response',
    // Simli client errors (control word only, never its detail)
    'closing', 'rate', 'error', 'other',
    // terminal lifecycle states, observer gaps
    'auth_failed', 'unavailable', 'unsupported_transport',
  ],
  reason: ['retry', 'refresh', 'resume', 'lost', 'short_session', 'healthy', 'unmount', 'replaced'],
  pc: [...PC_STATES, 'none'],
  ice: [...ICE_STATES, 'none'],
  ws: ['connecting', 'open', 'closing', 'closed', 'none'],
  audio: TRACK_STATES,
  video: TRACK_STATES,
});
const INTS = Object.freeze({
  mint: [0, 999],          // which mint of this lifecycle the event belongs to
  t: [0, 86400000],        // ms since that mint succeeded
  code: [0, 4999],         // signaling WebSocket close code
  status: [0, 599],        // /v4/avatar-session HTTP status; 0 = no response
});
const SID = /^[0-9a-f]{12}$/;
const MAX_EVENTS = 300;

function sanitizeAvatarTelemetry(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  if (typeof msg.event !== 'string' || !EVENTS.has(msg.event)) return null;
  if (typeof msg.sid !== 'string' || !SID.test(msg.sid)) return null;
  const out = { sid: msg.sid, event: msg.event };
  for (const [key, [lo, hi]] of Object.entries(INTS)) {
    const v = msg[key];
    if (Number.isInteger(v) && v >= lo && v <= hi) out[key] = v;
  }
  for (const [key, allowed] of Object.entries(ENUMS)) {
    const v = msg[key];
    if (typeof v === 'string' && allowed.includes(v)) out[key] = v;
  }
  return out;
}

// One per member connection; `persona` is the server's validated persona key.
function createAvatarTelemetry({ persona, log = line => console.log(line), maxEvents = MAX_EVENTS }) {
  let accepted = 0;
  let capped = false;
  return {
    record(msg) {
      const event = sanitizeAvatarTelemetry(msg);
      if (!event) return false;
      if (accepted >= maxEvents) {
        if (!capped) {
          capped = true;
          log(`[avatar] ${JSON.stringify({ persona, sid: event.sid, event: 'avatar_telemetry_capped' })}`);
        }
        return false;
      }
      accepted++;
      log(`[avatar] ${JSON.stringify({ persona, ...event })}`);
      return true;
    },
  };
}

module.exports = { sanitizeAvatarTelemetry, createAvatarTelemetry, EVENTS, ENUMS, INTS, MAX_EVENTS };
