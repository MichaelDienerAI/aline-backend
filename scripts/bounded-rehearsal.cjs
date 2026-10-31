'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto');
const c=require('./rehearsal-core.cjs'),policy=require('../services/release-policy');
function wav(pcm){
 if(!pcm.length||pcm.length%2)c.fail('PCM alignment invalid');
 const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(36+pcm.length,4);h.write('WAVE',8);h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(16000,24);h.writeUInt32LE(32000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);
}
async function request(url,headers,body){
 let r;try{r=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});}catch{c.fail('Provider transport failed');}
 if(!r.ok)c.fail('Provider request rejected (HTTP '+r.status+')');return r;
}
async function acoustic(run,v){
 c.checkFixture(v);const id='A-'+v.persona+'-'+v.promptId+'-'+v.condition;
 if(run.manifest.clips[id]?.status==='complete')return;
 const chunks=[],plan=c.config(),voice=c.sourceParts().voices[v.persona];
 for(let i=0;i<v.groups.length;i++){
  const g=v.groups[i],jobId=id+'-'+i,job=c.beginJob(run,jobId,'A',g.text.length),base='key/'+jobId;
  if(job.status!=='complete'){
   const body={text:g.text,model_id:plan.tts.model,voice_settings:plan.tts.voiceSettings};
   c.write(path.join(run.out,base+'.request.json'),{voiceId:voice,format:plan.tts.format,body});
   const r=await request('https://api.elevenlabs.io/v1/text-to-speech/'+voice+'/stream?output_format=pcm_16000',{'xi-api-key':process.env.ELEVENLABS_API_KEY},body);
   let pcm;try{pcm=Buffer.from(await r.arrayBuffer());}catch{c.fail('PCM response unreadable');}wav(pcm);
   c.write(path.join(run.out,base+'.pcm'),pcm);c.completeJob(run,jobId,[base+'.request.json',base+'.pcm'],{sampleRate:16000,evenByteAlignment:true});
  }
  chunks.push(Buffer.alloc((g.beforeMs||0)*32),fs.readFileSync(path.join(run.out,base+'.pcm')),Buffer.alloc((g.afterMs||0)*32));
 }
 const pcm=Buffer.concat(chunks),blind=randomBytes(12).toString('hex'),audio='listening/'+blind+'.wav',key='key/'+id+'.json';
 c.write(path.join(run.out,audio),wav(pcm));
 c.write(path.join(run.out,key),{...v,blindId:blind,audio,actualDurationMs:pcm.length/32,mainPointLandingMs:null,ratings:null});
 run.manifest.clips[id]={status:'complete',blindId:blind,artifacts:{[audio]:c.hash(fs.readFileSync(path.join(run.out,audio))),[key]:c.hash(fs.readFileSync(path.join(run.out,key)))}};c.save(run);
}
async function behavioral(run,v,persona){
 const id='B-'+v.promptId+'-'+persona;
 if(run.manifest.jobs[id]?.status==='complete')return;
 const model=process.env.MODEL_NAME;
 if(run.manifest.selection.model&&run.manifest.selection.model!==model)c.fail('RESUME REFUSED: model selection differs');
 run.manifest.selection.model=model;c.save(run);
 const memory=c.memorySession(run,persona),body=c.buildModelRequest(persona,v.prompt,memory,model);
 c.beginJob(run,id,'B');const base='key/'+id;
 c.write(path.join(run.out,base+'.request.json'),{persona,request:body,sharedMemorySha256:c.hash(memory.content)});
 const started=Date.now();
 const r=await request('https://api.anthropic.com/v1/messages',{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body);
 let result;try{result=await r.json();}catch{c.fail('Model response schema invalid');}
 const text=Array.isArray(result.content)?result.content.filter(x=>x.type==='text'&&typeof x.text==='string').map(x=>x.text).join(''):'';
 if(!text.trim())c.fail('Model response contains no text');
 const canonical=policy.normalizeForSpeech(text),display=policy.evaluateReleaseSafe(text),spoken=policy.evaluateReleaseSafe(canonical);
 c.write(path.join(run.out,base+'.response.json'),{generatedResponse:text,canonical,elapsedMs:Date.now()-started,modelReturned:typeof result.model==='string'?result.model:null,usage:result.usage?{input_tokens:result.usage.input_tokens,output_tokens:result.usage.output_tokens}:null,releaseChecksExecuted:true,displayApproved:display.approved,spokenApproved:spoken.approved,behavior:'UNVERIFIED'});
 c.completeJob(run,id,[base+'.request.json',base+'.response.json'],{releaseChecksExecuted:true,textPresent:true});
}
function preflight(){
 const a=c.blockersForA(),b=c.blockersForB(),client=c.blockersForClientStop();
 for(const [name,value] of [['EXPERIMENT A BLOCKERS',a],['EXPERIMENT B BLOCKERS',b],['CLIENT STOP BLOCKERS',client]])console.log(name+': '+JSON.stringify(value));
 console.log('A READY: '+(a.length?'NO':'YES')+'\nB READY: '+(b.length?'NO':'YES')+'\nCLIENT STOP READY: '+(client.length?'NO':'YES')+'\nFULL MONDAY LIVE CLIENT DEMO READY: NO');return {A:a,B:b,C:client};
}
async function main(){
 process.umask(0o077);
 const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1],smoke=args.includes('--execute-smoke'),full=args.includes('--execute-full');
 const selected=args.includes('--path')?value('--path'):'ab';
 if(!['a','b','ab','client-stop'].includes(selected)||args.includes('--execute')||smoke&&full)c.fail('Use one explicit path and either --execute-smoke or --execute-full');
 const gates=preflight();if(selected==='client-stop'){console.log('Client STOP contract: '+path.join(c.DIR,'CLIENT_STOP_CONTRACT.md'));return;}
 if(!smoke&&!full)return;
 const paths=selected==='ab'?['A','B']:[selected.toUpperCase()];
 const ready=paths.filter(p=>!gates[p].length);if(!ready.length)c.fail('Selected paths are blocked before paid execution');
 const out=args.includes('--output')?value('--output'):'private-rehearsals/2026-10-30-qualified-ab';
 const run=c.openRun(out,args.includes('--resume'));
 const cases=c.pack().variants.filter(v=>v.persona==='aline'&&v.condition==='off');
 try{
  for(const p of ready){
   try{
    if(full&&run.manifest.smoke[p]!=='PASS')c.fail('Successful smoke review required before full execution');
    if(p==='A')for(const v of smoke?[cases.find(v=>v.promptId==='06')]:c.pack().variants)await acoustic(run,v);
    else for(const v of smoke?[cases[0]]:cases)for(const persona of smoke?['aline']:['aline','chase'])await behavioral(run,v,persona);
    if(smoke){run.manifest.smoke[p]='PASS';c.save(run);}
   }catch(e){if(smoke){run.manifest.smoke[p]='FAIL';c.save(run);}console.error(JSON.stringify(c.failure(run,p,smoke?'smoke':'full',e)));process.exitCode=1;}
  }
  const sheet=path.join(run.out,'key/ratings.csv');
  const existing=fs.existsSync(sheet)?fs.readFileSync(sheet,'utf8'):'blind_id,listener,naturalness,identity,absence_of_stereotype,theatricality,main_point_landing_ms,notes\n';
  const rated=new Set(existing.split('\n').map(row=>row.split(',')[0]));
  const additions=Object.values(run.manifest.clips).filter(v=>!rated.has(v.blindId)).map(v=>v.blindId+',,,,,,,').join('\n');
  if(additions)c.write(sheet,existing+additions+'\n');
  if(smoke)console.log('SMOKE A: '+(run.manifest.smoke.A||'NOT RUN')+'\nSMOKE B: '+(run.manifest.smoke.B||'NOT RUN')+'\nFULL A/B EXECUTION AUTHORIZATION REQUIRED');
 }finally{run.runtime?.close?.();}
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(c.failure(null,null,'preflight',e)));process.exitCode=1;});
module.exports={wav,preflight,behavioral};
