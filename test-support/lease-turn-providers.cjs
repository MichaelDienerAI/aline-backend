'use strict';
// Model, speech-to-text and TTS doubles for lease turn tests only. Load after
// v4-identity-providers.cjs. Events go to LEASE_TEST_CAPTURE with a timestamp.
//   model input containing 'hold-across-expiry': the stream stays pending until
//     aborted (logs model_abort) or 2500 ms pass, then yields one sentence;
//     'hold-until-<epoch ms>' holds until that time instead.
//   Deepgram: each binary frame is a Float64LE epoch-ms for UtteranceEnd; a
//     final transcript is emitted at once, or at a second Float64LE if present.
const Module = require('node:module');
const fs = require('node:fs');
const log = record => fs.appendFileSync(process.env.LEASE_TEST_CAPTURE, JSON.stringify({ ...record, at: Date.now() }) + '\n');
const original = Module._load;
Module._load = function (id) {
  if (id === '@anthropic-ai/sdk') return class {
    constructor() {
      this.messages = { stream: config => {
        const input = config.messages.filter(m => m.role === 'user').at(-1).content;
        const until = /hold-until-(\d+)/.exec(input);
        const hold = input.includes('hold-across-expiry') || !!until;
        log({ type: 'model_start', hold });
        let release;
        const held = new Promise(r => { release = r; setTimeout(r, until ? Math.max(0, +until[1] - Date.now()) : 2500); });
        let aborted = false;
        return {
          async *[Symbol.asyncIterator]() {
            if (hold) await held;
            if (aborted) return;
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'A synthetic reply sentence.' } };
          },
          abort() { log({ type: 'model_abort' }); if (!aborted) { aborted = true; release(); } },
          on() {},
        };
      } };
    }
  };
  if (id === '@deepgram/sdk') return { createClient: () => ({ listen: { live: () => {
    const handlers = {};
    const emit = (event, data) => (handlers[event] || []).forEach(fn => fn(data));
    return {
      on(event, fn) { (handlers[event] = handlers[event] || []).push(fn); },
      getReadyState: () => 1,
      send(data) {
        const due = Buffer.from(data).readDoubleLE(0);
        const results = () => emit('Results', { is_final: true, channel: { alternatives: [{ transcript: 'Synthetic deadline turn' }] } });
        if (data.length >= 16) setTimeout(results, Math.max(0, Buffer.from(data).readDoubleLE(8) - Date.now()));
        else results();
        setTimeout(() => { log({ type: 'utterance_end' }); emit('UtteranceEnd'); }, Math.max(0, due - Date.now()));
      },
      finish() { log({ type: 'deepgram_finish' }); },
    };
  } } }) };
  return original.apply(this, arguments);
};
const previous = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.elevenlabs.io/')) {
    log({ type: 'tts' });
    return new Response(new Uint8Array(320).fill(1), { status: 200 });
  }
  return previous(url, opts);
};
