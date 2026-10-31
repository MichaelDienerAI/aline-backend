'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {spawn}=require('child_process'),{once}=require('events'),WebSocket=require('ws');
const {openMemoryStore}=require('./services/member-memory');
const core=require('./scripts/rehearsal-core.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crisis-ordering-')),db=path.join(dir,'synthetic.sqlite'),capture=path.join(dir,'capture');
const store=openMemoryStore(db),member=store.enroll();store.close();
const fixture='If she leaves me, I will kill myself tonight.';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<500;n++){if(fn())return;await delay(10)}throw Error('timeout')}
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name)};
(async()=>{
 for(const persona of ['aline','chase'])for(const mode of ['memory','classifier','generation','regeneration','stop']){
  fs.writeFileSync(capture,'');const port=19000+process.pid%10000;let child,ws,logs='';
  const trace=()=>fs.readFileSync(capture,'utf8').split('\n').filter(Boolean).map(JSON.parse);
  try{
   child=spawn(process.execPath,['--require','./test-support/crisis-ordering-providers.cjs','server.js'],{cwd:__dirname,env:{PATH:process.env.PATH,NODE_OPTIONS:process.env.NODE_OPTIONS||'',PORT:String(port),MODEL_NAME:'synthetic',ANTHROPIC_API_KEY:'synthetic',DEEPGRAM_API_KEY:'synthetic',PERSONA_V4_DB:db,ORDER_MODE:mode,ORDER_CAPTURE:capture,ALINE_CADENCE_V2:'1',CHASE_CADENCE_V1:'1',ALINE_CADENCE_V1:'0'},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
   await until(()=>{if(child.exitCode!==null)throw Error('child exited '+logs);return logs.includes('Backend v3.3.0 on port')});
   ws=new WebSocket(`ws://127.0.0.1:${port}/?persona=${persona}`,{headers:{Authorization:'Bearer '+member.credential}});const events=[],audio=[];
   ws.on('message',(d,b)=>b?audio.push(d):events.push(JSON.parse(d)));await once(ws,'open');
   ws.send(JSON.stringify({type:'message',content:fixture}));
   await until(()=>events.some(e=>e.channel==='crisis'));
   if(mode==='stop'){
    await until(()=>trace().some(e=>e.type==='model'));ws.send(JSON.stringify({type:'stop'}));
    await until(()=>events.some(e=>e.type==='response_cancelled'));
    ws.send(JSON.stringify({type:'message',content:'A mundane follow-up.'}));
    ws.send(JSON.stringify({type:'message',content:fixture}));
    await delay(500);
    check(persona+' STOP cancels ordinary work but retains both explicit notices',()=>{assert.equal(events.filter(e=>e.channel==='crisis').length,2);assert.equal(trace().filter(e=>e.type==='model').length,1);assert.equal(audio.length,0);assert(!events.some(e=>e.type==='response_text'&&e.channel!=='crisis'));assert(trace().some(e=>e.type==='abort'))});
    check(persona+' settling mundane follow-up receives one busy notice',()=>{assert.equal(events.filter(e=>e.type==='busy').length,1);assert.equal(events.find(e=>e.type==='busy').reason,'cancellation_settling');});
    ws.send(JSON.stringify({type:'message',content:'Fresh post-settlement turn.'}));await until(()=>events.some(e=>e.type==='response_complete'));
    check(persona+' fresh turn works; rejected follow-up absent from model history',()=>{const requests=trace().filter(e=>e.type==='model');assert.equal(requests.length,2);assert(!JSON.stringify(requests).includes('A mundane follow-up.'));assert(audio.length>0);});
   }else{
    await until(()=>events.some(e=>e.type==='error'||e.type==='response_complete'));
    check(persona+' '+mode+' preserves exactly one early text-only referral',()=>{const notices=events.filter(e=>e.channel==='crisis');assert.equal(notices.length,1);assert(notices[0].text.includes('988'));assert(notices[0].obligationId);assert(events.indexOf(notices[0])<events.findIndex(e=>e.type==='error'||e.type==='response_complete'));assert(!trace().some(e=>e.type==='tts'&&e.body.text.includes('988')))});
    if(mode==='memory')check(persona+' memory failure precedes classifier but not safety',()=>assert(!trace().some(e=>e.type==='classify'||e.type==='model')));
    if(mode==='regeneration'){check(persona+' retry actually attempted and failed',()=>{assert.equal(trace().filter(e=>e.type==='model').length,2);assert(events.some(e=>e.type==='response_complete'))});check(persona+' retry ends with a user continuation request',()=>{const messages=trace().filter(e=>e.type==='model')[1].config.messages;assert.equal(messages.at(-1).role,'user');assert.equal(messages.at(-2).content,'I hear you.');});}
   }
   check(persona+' '+mode+' raw input absent from runtime logs',()=>assert(!logs.includes(fixture)));
   for(const t of trace().filter(e=>e.type==='tts')){
    const candidate=core.config(),voices=core.sourceParts().voices;
    check(persona+' TTS request parity',()=>{assert.equal(t.body.model_id,candidate.tts.model);assert.deepEqual(t.body.voice_settings,candidate.tts.voiceSettings);assert.equal(new URL(t.url).searchParams.get('output_format'),candidate.tts.format);assert(new URL(t.url).pathname.includes('/'+voices[persona]+'/'))});
   }
  }finally{ws?.terminate();if(child&&child.exitCode===null){child.kill();await once(child,'exit')}}
 }
 console.log(count+' checks passed; actual local server with provider doubles only');
})().catch(e=>{console.error(e);process.exitCode=1});
