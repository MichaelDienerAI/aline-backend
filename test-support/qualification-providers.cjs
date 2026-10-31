'use strict';
const Module=require('module'),fs=require('fs'),original=Module._load;
const log=x=>fs.appendFileSync(process.env.QUAL_CAPTURE,JSON.stringify(x)+'\n');
let n=0;
function validate(config){if(config.messages.at(-1).role==='assistant')throw Error('assistant_prefill_rejected');if(config.model==='claude-sonnet-5-5'&&('temperature' in config||config.max_tokens!==400))throw Error('invalid configuration');}
Module._load=function(id){
 if(id==='@deepgram/sdk')return {createClient:()=>({listen:{live:()=>{throw Error('unused')}}})};
 if(id==='@anthropic-ai/sdk')return class{constructor(){this.messages={stream:config=>{
  validate(config);n++;log({type:'model',n,config});const mode=process.env.QUAL_MODE;
  if(n===2&&['retry_error','retry_error_empty'].includes(mode))throw Error('synthetic');
  return {on(){},abort(){log({type:'abort'})},async *[Symbol.asyncIterator](){
   const emit=text=>({type:'content_block_delta',delta:{type:'text_delta',text}});
   if(mode==='ordinary'){yield emit('I hear you.');return;}
   if(n===1){yield emit(mode==='retry_error_empty'?"I'm not qualified to help.":"I hear you. I'm not qualified to help.");return;}
   if(mode==='duplicate'){yield emit('I hear');yield emit(' you. Repeated.');return;}
   if(mode==='retry_rejected'){yield emit("I'm not qualified to help.");return;}
   if(mode==='retry_partial_error'){yield emit(' There is room here. ');throw Error('synthetic');}
   yield emit(' There is room here.');
  }};
 }}}};return original.apply(this,arguments);
};
global.fetch=async(url,opts)=>{if(!String(url).startsWith('https://api.elevenlabs.io/'))throw Error('network forbidden');log({type:'tts',text:JSON.parse(opts.body).text});return new Response(Buffer.alloc(320),{status:200})};
module.exports={validate};
