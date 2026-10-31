'use strict';
const Module=require('node:module'),fs=require('node:fs');
const log=r=>fs.appendFileSync(process.env.DUAL_CAPTURE,JSON.stringify(r)+'\n');
const original=Module._load;
const canonical='There is room for both parts of this decision, because the place can change before your obligations change, and neither fact cancels the other.';
let slowAudio=false;
Module._load=function(id,parent,isMain){
 if(id==='@deepgram/sdk')return {createClient:()=>({listen:{live:()=>{
  const c=new (require('node:events').EventEmitter)();c.getReadyState=()=>1;c.finish=()=>{};
  c.send=()=>{log({type:'stt_send'});setTimeout(()=>{c.emit('Results',{is_final:true,channel:{alternatives:[{transcript:'fixture-w3 stale microphone turn'}]}});c.emit('UtteranceEnd');},150);};
  return c;
 }}})};
 if(id==='@anthropic-ai/sdk')return class {constructor(){this.messages={stream:config=>{
  log({type:'model',config});const user=config.messages.filter(m=>m.role==='user'&&!m.content.startsWith('Continue the response')&&!m.content.startsWith('Provide a replacement')).at(-1).content;slowAudio=user.includes('slow-audio');
  const text=user.includes('reject-output')?"I'm **not** qualified to help.":canonical;
  return {abort(){},on(){},async *[Symbol.asyncIterator](){if(user.includes('slow-model'))await new Promise(r=>setTimeout(r,300));yield {type:'content_block_delta',delta:{type:'text_delta',text}};}};
 }}}};
 const value=original.apply(this,arguments);
 if(id==='./services/classifier')return {...value,analyzeMessage:text=>({...value.analyzeMessage(text),weight:Number(text.match(/fixture-w(\d+)/)?.[1]||3)})};
 if(id==='./services/cadence-profiles')return {...value,compileCanonical:(text,profile)=>{log({type:'compile',profile:profile.name,mode:profile.mode,text});return value.compileCanonical(text,profile);}};
 if(id==='./services/release-policy')return {...value,evaluateReleaseSafe:text=>{const v=value.evaluateReleaseSafe(text);log({type:'authorize',approved:v.approved});return v;}};
 return value;
};
global.fetch=async(url,opts)=>{
 if(!String(url).startsWith('https://api.elevenlabs.io/'))throw Error('Unexpected outbound request blocked');
 const text=JSON.parse(opts.body).text;log({type:'tts',text});const slow=slowAudio;
 // Deliberately ignore abort to prove the runtime discards late provider bytes.
 return new Response(new ReadableStream({async start(c){c.enqueue(new Uint8Array([7,0]));if(slow)await new Promise(r=>setTimeout(r,300));c.enqueue(new Uint8Array([8,0]));c.close();}}),{status:200});
};
