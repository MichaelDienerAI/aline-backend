'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {spawn}=require('child_process'),{once}=require('events'),WebSocket=require('ws');
const {openMemoryStore}=require('./services/member-memory'),rp=require('./services/release-policy');
const {continuationMessages,modelOptions}=require('./services/model-request');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qualification-')),db=path.join(dir,'member.sqlite'),capture=path.join(dir,'capture');
const store=openMemoryStore(db),member=store.enroll();store.close();
let checks=0;const test=(name,fn)=>{fn();checks++;console.log('PASS '+name)};
const delay=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){for(let n=0;n<500;n++){if(fn())return;await delay(10)}throw Error('timeout')}
// Same validation used by the provider double: the old shape really is rejected.
const {validate}=require('./test-support/qualification-providers.cjs');
test('old final assistant prefill rejected',()=>assert.throws(()=>validate({messages:[{role:'assistant',content:'Approved. '}]}),/prefill/));
test('new continuation is user-terminated and request-only trim preserves source',()=>{const p='Approved. \n';const m=continuationMessages([{role:'user',content:'Synthetic'}],p);assert.equal(m.at(-1).role,'user');assert.equal(m.at(-2).content,'Approved.');assert.equal(p,'Approved. \n');});
test('existing fallback is approved',()=>assert(rp.evaluateReleaseSafe(rp.APPROVED_FALLBACK).approved));
(async()=>{
 for(const mode of ['ordinary','retry_ok','retry_rejected','retry_error','retry_error_empty','retry_partial_error','duplicate']){
  fs.writeFileSync(capture,'');const port=21000+process.pid%10000;let child,ws,logs='';
  try{
   child=spawn(process.execPath,['--require','./test-support/qualification-providers.cjs','server.js'],{cwd:__dirname,env:{PATH:process.env.PATH,NODE_OPTIONS:process.env.NODE_OPTIONS||'',PORT:String(port),MODEL_NAME:'claude-sonnet-5-5',ANTHROPIC_API_KEY:'synthetic',DEEPGRAM_API_KEY:'synthetic',PERSONA_V4_DB:db,QUAL_MODE:mode,QUAL_CAPTURE:capture,ALINE_CADENCE_V2:'1',CHASE_CADENCE_V1:'1'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
   await until(()=>{if(child.exitCode!==null)throw Error(logs);return logs.includes('Backend v3.3.0 on port')});
   ws=new WebSocket(`ws://127.0.0.1:${port}/?persona=chase`,{headers:{Authorization:'Bearer '+member.credential}});const events=[];ws.on('message',(d,b)=>{if(!b)events.push(JSON.parse(d))});await once(ws,'open');ws.send(JSON.stringify({type:'message',content:'A synthetic ordinary question.'}));await until(()=>events.some(e=>e.type==='response_complete'||e.type==='error'));
   const t=fs.readFileSync(capture,'utf8').trim().split('\n').map(JSON.parse),models=t.filter(x=>x.type==='model'),text=events.filter(e=>e.type==='response_text').map(e=>e.text).join('');
   test(mode+' bounded model calls and supported request shape',()=>{assert.equal(models.length,mode==='ordinary'?1:2);for(const m of models){assert.equal(m.config.messages.at(-1).role,'user');assert.equal(m.config.max_tokens,400);assert.deepEqual(m.config.thinking,modelOptions('claude-sonnet-5-5').thinking)}});
   test(mode+' no rejected speech or duplicate prefix',()=>{assert(!text.includes('not qualified'));assert.equal(text.split('I hear you.').length-1,mode==='retry_error_empty'?0:1);assert(!t.some(e=>e.type==='tts'&&e.text.includes('not qualified')))});
   test(mode+' completes with approved continuation or bounded fallback',()=>{assert(events.some(e=>e.type==='response_complete'));assert(rp.evaluateReleaseSafe(text).approved);if(!['ordinary','retry_ok'].includes(mode))assert.equal(text.split(rp.APPROVED_FALLBACK).length-1,1);if(mode==='retry_ok'||mode==='retry_partial_error')assert(text.includes('There is room here.'))});
  }finally{ws?.terminate();if(child&&child.exitCode===null){child.kill();await once(child,'exit')}}
 }
 console.log(checks+' qualification runtime checks passed');
})().catch(e=>{console.error(e);process.exitCode=1});
