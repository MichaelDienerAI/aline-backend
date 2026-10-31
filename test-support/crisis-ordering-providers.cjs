'use strict';
const Module=require('module'),fs=require('fs'),original=Module._load;
const log=x=>fs.appendFileSync(process.env.ORDER_CAPTURE,JSON.stringify(x)+'\n');
let calls=0;
Module._load=function(id){
 if(id==='@deepgram/sdk')return {createClient:()=>({listen:{live:()=>{throw Error('not exercised')}}})};
 if(id==='@anthropic-ai/sdk')return class {constructor(){this.messages={stream:config=>{
  calls++;log({type:'model',call:calls,config});const mode=process.env.ORDER_MODE;
  if(mode==='generation'||mode==='regeneration'&&calls===2)throw Error('synthetic provider failure');
  return {on(){},abort(){log({type:'abort'})},async *[Symbol.asyncIterator](){
   if(mode==='stop')await new Promise(r=>setTimeout(r,350));
   yield {type:'content_block_delta',delta:{type:'text_delta',text:mode==='regeneration'?"I hear you. I'm not qualified to help.":'I hear you.'}};
  }};
 }}}};
 const result=original.apply(this,arguments);
 if(id==='./services/classifier')return {...result,analyzeMessage(text){log({type:'classify'});if(process.env.ORDER_MODE==='classifier')throw Error('synthetic classifier failure');return result.analyzeMessage(text)}};
 if(id==='./services/member-runtime')return {...result,createMemberRuntime(file){const r=result.createMemberRuntime(file);return {connect(...args){const session=r.connect(...args);return {...session,begin(){log({type:'memory'});if(process.env.ORDER_MODE==='memory')throw Error('synthetic memory failure');return session.begin()}}}}}};
 return result;
};
global.fetch=async(url,options)=>{if(!String(url).startsWith('https://api.elevenlabs.io/'))throw Error('network forbidden');log({type:'tts',url,body:JSON.parse(options.body)});return new Response(Buffer.alloc(320),{status:200})};
