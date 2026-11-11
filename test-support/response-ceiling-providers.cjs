'use strict';
// Provider doubles for test-response-ceiling.js. The Anthropic double streams
// the SDK's raw events (message_start, text deltas, message_delta with
// stop_reason and usage, message_stop) for the scenario in CEILING_MODE; the
// ElevenLabs double records what would be spoken. No network.
const Module=require('module'),fs=require('fs'),original=Module._load;
const log=x=>fs.appendFileSync(process.env.CEILING_CAPTURE,JSON.stringify(x)+'\n');
const words=n=>Array.from({length:n},(_,i)=>`Sentence ${i+1} carries a measured thought about decisions and their weight.`).join(' ');
const SCENARIOS={
 short:{text:['Confidence is a feeling. ','Certainty is a claim about the world.'],stop:'end_turn',tokens:24},
 long:{text:words(25).match(/[^.]+\.\s*/g),stop:'end_turn',tokens:380,delayMs:15},
 ceiling:{text:['The first point is finished. ','Is the second one finished? ','Yes! ','He said "it holds." ','And she wrote “not quite.” ','Then the model ran out in the middle of'],stop:'max_tokens',tokens:400},
 ceilingAtBoundary:{text:['Everything here is finished. ','The last sentence closes exactly at the ceiling.'],stop:'max_tokens',tokens:400},
 ceilingNoSentence:{text:['an answer that never reaches its own end because the ceiling arrives first and'],stop:'max_tokens',tokens:400},
};
Module._load=function(id){
 if(id==='@deepgram/sdk')return {createClient:()=>({listen:{live:()=>{throw Error('not exercised')}}})};
 if(id==='@anthropic-ai/sdk')return class {constructor(){this.messages={stream:config=>{
  const s=SCENARIOS[process.env.CEILING_MODE];log({type:'model',config:{max_tokens:config.max_tokens,model:config.model,tools:(config.tools||[]).map(t=>t.type),messages:config.messages}});
  return {on(){},abort(){log({type:'abort'})},async *[Symbol.asyncIterator](){
   yield {type:'message_start',message:{usage:{input_tokens:100,output_tokens:1}}};
   for(const text of s.text){log({type:'chunk_emitted',at:Date.now()});yield {type:'content_block_delta',delta:{type:'text_delta',text}};if(s.delayMs)await new Promise(r=>setTimeout(r,s.delayMs));}
   yield {type:'message_delta',delta:{stop_reason:s.stop,stop_sequence:null},usage:{output_tokens:s.tokens}};
   yield {type:'message_stop'};
  }};
 }}}};
 return original.apply(this,arguments);
};
global.fetch=async(url,options)=>{if(!String(url).startsWith('https://api.elevenlabs.io/'))throw Error('network forbidden');log({type:'tts',text:JSON.parse(options.body).text});return new Response(Buffer.alloc(320),{status:200})};
