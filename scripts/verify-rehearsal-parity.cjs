'use strict';
// Offline only: actual server, synthetic member, loopback, provider doubles.
const c=require('./rehearsal-core.cjs'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){for(let i=0;i<500;i++){if(fn())return;await pause(20);}c.fail('Local parity capture timed out');}
async function main(){
 process.umask(0o077);
 const WebSocket=require('ws'),model=process.env.MODEL_NAME||c.config().model.name;
 const run=c.openRun('private-rehearsals/parity-'+Date.now());run.identity=c.identity(run);
 const capture=path.join(run.out,'key/capture.jsonl');c.write(capture,'');
 const port=18000+process.pid%10000,flags=c.config().flags;
 const child=spawn(process.execPath,['--require',path.join(c.ROOT,'test-support/v4-providers.cjs'),'server.js'],{cwd:c.ROOT,env:{PATH:process.env.PATH,NODE_OPTIONS:process.env.NODE_OPTIONS||'',PORT:String(port),MODEL_NAME:model,ANTHROPIC_API_KEY:'synthetic',ELEVENLABS_API_KEY:'synthetic',DEEPGRAM_API_KEY:'synthetic',PERSONA_V4_DB:run.identity.file,V4_TEST_CAPTURE:capture,...flags},stdio:['ignore','pipe','pipe']});
 let ready=false;child.stdout.on('data',d=>{if(d.toString().includes('Backend v3.3.0 on port'))ready=true;});child.stderr.resume();const sockets=[];
 try{
  await wait(()=>{if(child.exitCode!==null)c.fail('Local double server exited');return ready;});
  const cases=c.pack().variants.filter(v=>v.persona==='aline'&&v.condition==='off'),allDiff=[],records=[];
  for(const fixture of cases)for(const persona of ['aline','chase']){
   const prompt=fixture.prompt;
   const ws=new WebSocket(`ws://127.0.0.1:${port}/?persona=${persona}`,{headers:{Authorization:'Bearer '+run.identity.credential}});sockets.push(ws);
   let done=false;ws.on('message',(data,binary)=>{if(!binary&&JSON.parse(data).type==='response_complete')done=true;});await once(ws,'open');
   const before=fs.readFileSync(capture,'utf8').split('\n').filter(Boolean).length;
   ws.send(JSON.stringify({type:'message',content:prompt}));await wait(()=>done);
   const events=fs.readFileSync(capture,'utf8').split('\n').filter(Boolean).slice(before).map(JSON.parse);
   const actual=events.find(e=>e.type==='model')?.config;if(!actual)c.fail('Server model request was not captured');
   const expected=c.buildModelRequest(persona,prompt,c.memorySession(run,persona),model);
   const differences=c.differences(actual,expected);allDiff.push(...differences.map(d=>({persona,...d})));
   c.write(path.join(run.out,'key/'+persona+(fixture.promptId==='01'?'':'-'+fixture.promptId)+'-requests.json'),{server:actual,harness:expected,differences});
   records.push({persona,promptId:fixture.promptId,roles:actual.messages.map(m=>m.role),thinking:actual.thinking,output_config:actual.output_config,systemSha256:c.hash(actual.system),memorySha256:c.hash(actual.messages[0].content),model:actual.model,max_tokens:actual.max_tokens,temperature:'temperature' in actual?actual.temperature:'OMITTED',tools:'tools' in actual?'PRESENT':'OMITTED',correctedChaseSelected:persona==='chase'&&actual.system.startsWith('You are Chase Ellsworth Whitford III.')&&actual.system.includes('NO LIFE-DIRECTION AUTHORITY.')&&!/four-term/i.test(actual.system)});
   ws.close();await once(ws,'close');
  }
  const lock=c.read(path.join(c.DIR,'source-lock.json'));
  const proof={serverSourceSha256:c.hash(fs.readFileSync(path.join(c.ROOT,'server.js'))),tts:c.config().tts,releaseConfiguration:'cumulative display + spoken authorization, bounded one retry, independent early crisis text',status:allDiff.length?'FAIL':'PASS',model,flags,sourceLockHash:c.hash(JSON.stringify({...lock.common,...lock.B})),candidateHash:c.hash(fs.readFileSync(path.join(c.DIR,'candidate.json'))),correctedChaseSelected:records.some(r=>r.correctedChaseSelected),differences:allDiff,records,privateEvidence:run.out,observation:'STRUCTURALLY VERIFIED; actual server requests captured using provider doubles; no live generation',intentionalRequestDifferences:[],transportDifference:'SDK streaming versus HTTP non-streaming: same model-facing parameters; response collection differs'};
  c.write(path.join(c.DIR,'server-request-parity.json'),proof);console.log(JSON.stringify(proof,null,2));if(proof.status!=='PASS')process.exitCode=1;
 }finally{for(const ws of sockets)ws.terminate();if(child.exitCode===null){child.kill();await once(child,'exit');}run.runtime?.close?.();}
}
main().catch(e=>{console.error(JSON.stringify(c.failure(null,'B','parity',e)));process.exitCode=1;});
