'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events'),WebSocket=require('ws');
const {openMemoryStore}=require('./services/member-memory');
const profiles=require('./services/cadence-profiles'),rp=require('./services/release-policy');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dual-cadence-')),db=path.join(dir,'members.sqlite'),capture=path.join(dir,'capture.jsonl');
fs.writeFileSync(capture,'');const store=openMemoryStore(db),member=store.enroll();
const fact='The member is seriously considering spending part of next year in Lisbon.';
store.create(member.memberId,'aline','synthetic',{content:fact,scope:'all'});store.close();
const env={ALINE_CADENCE_V2:'1',CHASE_CADENCE_V1:'1'};
const read=()=>fs.readFileSync(capture,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<250;n++){if(fn())return;await sleep(10);}throw Error('timeout');}
let checks=0,child,ws;const test=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
const port=6000+process.pid%1000;
async function connect(persona){ws=new WebSocket(`ws://127.0.0.1:${port}/?persona=${persona}`,{headers:{Authorization:'Bearer '+member.credential}});await once(ws,'open');ws.events=[];ws.audio=[];ws.on('message',(d,b)=>b?ws.audio.push(Buffer.from(d)):ws.events.push(JSON.parse(d)));return ws;}
async function turn(input){const begin=read().length,events=ws.events.length,audio=ws.audio.length;ws.send(JSON.stringify({type:'message',content:input}));await until(()=>ws.events.slice(events).some(e=>e.type==='response_complete'));return {trace:read().slice(begin),events:ws.events.slice(events),audio:ws.audio.slice(audio)};}
(async()=>{try{
 child=spawn(process.execPath,['--require',path.join(__dirname,'test-support/dual-cadence-providers.cjs'),'server.js'],{cwd:__dirname,env:{PATH:process.env.PATH,NODE_OPTIONS:process.env.NODE_OPTIONS||'',PORT:String(port),MODEL_NAME:'synthetic',ANTHROPIC_API_KEY:'synthetic',DEEPGRAM_API_KEY:'synthetic',PERSONA_V4_DB:db,DUAL_CAPTURE:capture,...env},stdio:['ignore','pipe','pipe']});
 let ready=false;child.stdout.on('data',b=>{if(b.toString().includes('Backend v3.3.0'))ready=true;});let errors='';child.stderr.on('data',b=>errors+=b);await until(()=>{if(child.exitCode!==null)throw Error(errors);return ready;});
 const contexts=[];
 for(const persona of ['aline','chase']){
  await connect(persona);
  for(const w of [3,8,13,21]){
   const t=await turn('fixture-w'+w+' What do you make of this move?');
   const model=t.trace.find(e=>e.type==='model').config;contexts.push(JSON.parse(model.messages[0].content).institutional);
   const canonical=t.events.filter(e=>e.type==='response_text').map(e=>rp.normalizeForSpeech(e.text)).filter(Boolean);
   const p=profiles.forTurn(persona,{weight:w},'',false,env);
   const plans=canonical.map(text=>profiles.compileCanonical(text,p));
   test(persona+' W'+w+' real routing, exact TTS and PCM pause budget',()=>{
    assert(model.system.includes(persona==='aline'?'ALINE CADENCE V2':'CHASE CADENCE V1'));
    assert(!model.system.includes(persona==='aline'?'CHASE CADENCE V1':'ALINE CADENCE V2'));
    assert.deepEqual(t.trace.filter(e=>e.type==='tts').map(e=>e.text),plans.flatMap(plan=>plan.segments.map(g=>g.text)));
    const silence=t.audio.filter(b=>b.every(v=>v===0)).reduce((sum,b)=>sum+b.length,0);
    assert.equal(silence,plans.flatMap(plan=>plan.segments).reduce((sum,g)=>sum+32*(g.beforeMs+g.afterMs),0));
    for(let i=0;i<t.trace.length;i++)if(t.trace[i].type==='compile')assert.deepEqual(t.trace[i-1],{type:'authorize',approved:true});
   });
  }
  if(persona==='chase'){
   const veil=await turn('fixture-w3. be blunt'),normal=await turn('fixture-w3 ordinary conversation'),high=await turn('fixture-w13. be blunt');
   test('Chase veil-drop then baseline then high restraint in same connection',()=>{
    assert(veil.trace.some(e=>e.mode==='veil-drop'));assert(normal.trace.some(e=>e.mode==='patrician'));assert(high.trace.some(e=>e.mode==='restrained'));
   });
  }
  const rejected=await turn('fixture-w3 reject-output');test(persona+' spoken rejection never compiles or speaks rejected words',()=>{
   assert(!rejected.trace.some(e=>e.type==='compile'&&e.text.includes('not qualified')));assert(!rejected.trace.some(e=>e.type==='tts'&&e.text.includes('not qualified')));
   for(let i=0;i<rejected.trace.length;i++)if(rejected.trace[i].type==='compile')assert.deepEqual(rejected.trace[i-1],{type:'authorize',approved:true});
   assert(rejected.events.filter(e=>e.type==='response_text').map(e=>e.text).join('').includes(rp.APPROVED_FALLBACK));
  });
  for(const kind of ['slow-model','slow-audio']){
   const first=read().length;ws.events=[];ws.audio=[];ws.send(JSON.stringify({type:'message',content:'fixture-w3 '+kind}));
   await until(()=>kind==='slow-model'?read().slice(first).some(e=>e.type==='model'):ws.audio.some(b=>b[0]===7));
   ws.send(JSON.stringify({type:'stop'}));await until(()=>ws.events.some(e=>e.type==='response_cancelled'));
   const count=ws.audio.length,tts=read().filter(e=>e.type==='tts').length;
   await sleep(450);
   test(persona+' STOP '+kind+' cancels queued/late audio and requests',()=>{
    assert(ws.events.some(e=>e.type==='playback_clear'));assert.equal(ws.audio.length,count);assert.equal(read().filter(e=>e.type==='tts').length,tts);assert(!ws.events.some(e=>e.type==='response_complete'));
   });
   const resumed=await turn('fixture-w3 new turn');test(persona+' new turn after '+kind+' remains playable',()=>assert(resumed.audio.some(b=>b[0]===7)));
  }
  const sttBegin=read().length;ws.events=[];
  ws.send(JSON.stringify({type:'start'}));ws.send(Buffer.from([1,0]));
  await until(()=>read().slice(sttBegin).some(e=>e.type==='stt_send'));
  ws.send(JSON.stringify({type:'stop'}));await until(()=>ws.events.some(e=>e.type==='response_cancelled'));
  ws.send(Buffer.from([1,0]));await sleep(300);
  test(persona+' STOP rejects late STT and microphone bytes until restart',()=>{
    assert(!read().slice(sttBegin).some(e=>e.type==='model'));
    assert.equal(read().slice(sttBegin).filter(e=>e.type==='stt_send').length,1);
    assert(!ws.events.some(e=>e.type==='transcript'));
  });
  ws.close();await once(ws,'close');ws=null;
 }
 test('both confidantes receive byte-identical authorized shared fact records',()=>{for(const c of contexts)assert.deepEqual(c,contexts[0]);assert.equal(contexts[0][0].content,fact);});
 console.log(`${checks}/${checks} passed`);
}finally{ws?.terminate();if(child&&child.exitCode===null){child.kill();await once(child,'exit');}}})().catch(e=>{console.error(e);process.exitCode=1;});
