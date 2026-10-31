'use strict';
// Deterministic vendor doubles for synthetic local fixtures only.
const Module = require('node:module');
const fs = require('node:fs');
const log = record => fs.appendFileSync(process.env.V4_TEST_CAPTURE, JSON.stringify(record)+'\n');
const original = Module._load;
Module._load = function(id,parent,isMain) {
  if (id === '@deepgram/sdk') return {createClient:()=>({listen:{live:()=>{throw Error('Audio input not exercised');}}})};
  if (id === '@anthropic-ai/sdk') return class {
    constructor() { this.messages={stream: config => {
      log({type:'model',config});
      const input = config.messages.filter(m=>m.role==='user'&&!m.content.startsWith('Continue the response')&&!m.content.startsWith('Provide a replacement')).at(-1).content;
      const chase = config.system.startsWith('You are Chase Ellsworth Whitford III.');
      // These are controlled lens fixtures, not evidence of live model adherence.
      let reply = chase
        ? 'Lisbon next year creates room to separate your own decision from what your position asks of you.'
        : 'Lisbon next year holds two registers: the place you might inhabit and the belonging you would carry there.';
      const retained = JSON.parse(config.messages[0].content);
      if (!retained.institutional.some(m => m.content.includes('Lisbon'))) {
        reply = chase ? 'There is room here for your private deliberation.' : 'There is room here for the different registers you carry.';
      }
      if (input.includes('release-block')) reply="I'm not qualified to help.";
      return {async *[Symbol.asyncIterator]() {
        if (input.includes('slow-turn')) await new Promise(r=>setTimeout(r,350));
        yield {type:'content_block_delta',delta:{type:'text_delta',text:reply}};
      },abort(){},on(){}};
    }}; }
  };
  const result=original.apply(this,arguments);
  if (id === './services/classifier' && process.env.V4_TEST_CLASSIFIER_FAIL === '1') return {...result,analyzeMessage:()=>{throw Error('synthetic');}};
  if (id === './services/release-policy') return {...result,evaluateReleaseSafe:text=>{
    const verdict=result.evaluateReleaseSafe(text); log({type:'authorization',approved:verdict.approved});return verdict;
  }};
  if (id === './services/cadence-pass1') return {...result,compileCanonical:text=>{log({type:'cadence'});return result.compileCanonical(text);}};
  return result;
};
global.fetch=async (url,opts)=>{
  if (!String(url).startsWith('https://api.elevenlabs.io/')) throw Error('Unexpected outbound request blocked');
  log({type:'tts',text:JSON.parse(opts.body).text});
  return new Response(new Uint8Array(320).fill(1),{status:200});
};
