'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHash,randomBytes}=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const DIR=path.join(ROOT,'agent-runs/2026-10-30-qualification');
const PRIVATE=path.join(ROOT,'private-rehearsals');
const hash=data=>createHash('sha256').update(data).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
class HarnessError extends Error { constructor(reason){super(reason);this.name='HarnessError';} }
const fail=reason=>{throw new HarnessError(reason);};
function write(file,value){
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const bytes=Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value,null,2);
 fs.writeFileSync(file+'.pending',bytes,{mode:0o600});fs.chmodSync(file+'.pending',0o600);fs.renameSync(file+'.pending',file);
}
function config(){return read(path.join(DIR,'candidate.json'));}
function pack(){return read(path.join(ROOT,'agent-runs/2026-10-30-dual-cadence/stimuli-and-key.json'));}
function sourceParts(){
 const source=fs.readFileSync(path.join(ROOT,'server.js'),'utf8');
 return {prompts:vm.runInNewContext(source.slice(source.indexOf('const SYSTEM_PROMPTS'),source.indexOf('// ── HTTP SERVER'))+'\nSYSTEM_PROMPTS'),
 voices:vm.runInNewContext(source.slice(source.indexOf('const VOICE_IDS'),source.indexOf('const AVATAR_IDS'))+'\nVOICE_IDS')};
}
function buildModelRequest(persona,prompt,memory,model){
 const plan=config(),{prompts}=sourceParts();
 const classification=require('../services/classifier').analyzeMessage(prompt);
 const profile=require('../services/cadence-profiles').forTurn(persona,classification,prompt,false,plan.flags);
 // No temperature override: actual server omits it. Parity gates this structure.
 return {model,...require('../services/model-request').modelOptions(model),max_tokens:plan.model.maxOutputTokens,system:prompts[persona]+(profile?.rules||''),messages:[memory,{role:'user',content:prompt}]};
}
function differences(a,b,field='$'){
 if(a===b)return [];
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
  const keys=[...new Set([...Object.keys(a),...Object.keys(b)])].sort();
  return keys.flatMap(k=>differences(a[k],b[k],field+'.'+k));
 }
 const display=v=>v===undefined?'ABSENT':typeof v==='string'&&v.length>100?{sha256:hash(v),length:v.length}:v;
 return [{field,server:display(a),harness:display(b)}];
}
function checkFixture(v){
 if(!v||!Array.isArray(v.groups)||v.groups.map(g=>g.text).join('')!==v.canonical)fail('Non-lossless synthesis rejected');
 if(!require('../services/release-policy').evaluateReleaseSafe(v.canonical).approved)fail('Canonical text is not release-safe');
 for(const g of v.groups)for(const n of [g.beforeMs||0,g.afterMs||0])if(!Number.isInteger(n)||n<0||n>500)fail('Invalid pause budget');
}
function lockErrors(which){
 try{
  const lock=read(path.join(DIR,'source-lock.json'));
  return Object.entries({...lock.common,...lock[which]}).filter(([file,h])=>hash(fs.readFileSync(path.join(ROOT,file)))!==h).map(()=> 'Reviewed source lock differs');
 }catch{return ['Reviewed source lock unavailable'];}
}
function assertParity(actual,expected){if(differences(actual,expected).length)fail('Server request parity failed');}
function parityErrors(model){
 try{
  const proof=read(path.join(DIR,'server-request-parity.json'));
  const lock=read(path.join(DIR,'source-lock.json'));
  const errors=[];
  if(proof.status!=='PASS'||proof.differences.length||!proof.correctedChaseSelected)errors.push('Server request parity failed');
  if(proof.sourceLockHash!==hash(JSON.stringify({...lock.common,...lock.B})))errors.push('Server request parity source lock differs');
  if(proof.candidateHash!==hash(fs.readFileSync(path.join(DIR,'candidate.json'))))errors.push('Server request parity candidate differs');
  if(model&&proof.model!==model)errors.push('Repeat local parity capture with the intended MODEL_NAME');
  return errors;
 }catch{return ['Server request parity has not been captured'];}
}
function blockersForA(env=process.env){
 const b=lockErrors('A'),p=config();
 if(!env.ELEVENLABS_API_KEY)b.push('ELEVENLABS_API_KEY unavailable');
 if(env.NODE_OPTIONS)b.push('Unset NODE_OPTIONS for real-provider execution');
 if(p.tts.model!=='eleven_multilingual_v2'||p.tts.format!=='pcm_16000')b.push('TTS configuration is not reviewed');
 try{const variants=pack().variants;if(variants.length!==30)fail('Fixture count differs');variants.forEach(checkFixture);}catch(e){b.push(e instanceof HarnessError?e.message:'Fixture integrity unavailable');}
 return [...new Set(b)];
}
function blockersForB(env=process.env){
 const b=lockErrors('B');
 if(!env.ANTHROPIC_API_KEY)b.push('ANTHROPIC_API_KEY unavailable');
 if(!env.MODEL_NAME)b.push('MODEL_NAME unavailable');
 else if(env.MODEL_NAME!==config().model.name)b.push('MODEL_NAME differs from reviewed Sonnet 5.5 candidate');
 else if(!/^claude-/.test(env.MODEL_NAME))b.push('MODEL_NAME is not a reviewed Anthropic identifier');
 if(env.NODE_OPTIONS)b.push('Unset NODE_OPTIONS for real-provider execution');
 const chase=sourceParts().prompts.chase;
 if(!chase.includes('NO LIFE-DIRECTION AUTHORITY.')||/four-term/i.test(chase))b.push('Corrected Chase prompt source is missing');
 return [...new Set([...b,...parityErrors(env.MODEL_NAME)])];
}
function blockersForClientStop(){
 const c=config().client;
 return ['localEndpointConfigurable','localMemberAuthenticationCompatible','avatarOffSupported','clearEpochProtocolImplemented','activeQueuedAudioFlushImplemented','avatarAudioFlushImplemented','clearAcknowledgementImplemented','actualBrowserAvailable'].filter(k=>!c[k]).map(k=>'Client '+k+' is not implemented/reviewed');
}
function currentLocks(){
 return {sourceLockHash:hash(fs.readFileSync(path.join(DIR,'source-lock.json'))),candidateHash:hash(fs.readFileSync(path.join(DIR,'candidate.json'))),decisionRulesHash:hash(fs.readFileSync(path.join(DIR,'DECISION_RULES.md')))};
}
function privateDirectory(out){
 const full=path.resolve(ROOT,out);
 if(!full.startsWith(PRIVATE+path.sep))fail('Output must be inside ignored private-rehearsals');
 let p=PRIVATE;
 for(const part of path.relative(PRIVATE,full).split(path.sep)){
  if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())fail('Private output symlink refused');
  p=path.join(p,part);
 }
 if(fs.existsSync(full)&&fs.lstatSync(full).isSymbolicLink())fail('Private output symlink refused');
 return full;
}
function artifactFile(run,relative){
 if(typeof relative!=='string'||!relative.match(/^(key|listening)\//)||relative.includes('..')||path.isAbsolute(relative))fail('Resume artifact path invalid');
 const f=path.join(run.out,relative);
 if(fs.existsSync(f)&&fs.lstatSync(f).isSymbolicLink())fail('Resume artifact symlink refused');
 return f;
}
function verifyResume(run){
 if(differences(run.manifest.locks,currentLocks()).length)fail('RESUME REFUSED: lock differs');
 const usage=read(path.join(run.out,'key/usage.json'));
 if(differences(usage,run.manifest.usage).length)fail('RESUME REFUSED: budget state differs');
 for(const item of [...Object.values(run.manifest.jobs),...Object.values(run.manifest.clips)])if(item.status==='complete'){
  for(const [relative,expected] of Object.entries(item.artifacts)){
   const file=artifactFile(run,relative);
   if(!fs.existsSync(file)||hash(fs.readFileSync(file))!==expected)fail('RESUME REFUSED: completed artifact hash differs');
  }
 }
 run.usage=usage;
}
function save(run){write(path.join(run.out,'key/manifest.json'),run.manifest);}
function openRun(out,resume=false){
 const full=privateDirectory(out),exists=fs.existsSync(full);
 if(full===path.join(PRIVATE,'2026-10-30-ab'))fail('Historical rehearsal is read-only; create a new run');
 if(exists&&!resume)fail('Existing run directory refused without --resume');
 if(!exists&&resume)fail('RESUME REFUSED: run does not exist');
 if(resume){const run={out:full,manifest:read(path.join(full,'key/manifest.json'))};verifyResume(run);return run;}
 fs.mkdirSync(PRIVATE,{recursive:true,mode:0o700});fs.chmodSync(PRIVATE,0o700);
 fs.mkdirSync(full,{mode:0o700});for(const d of ['key','listening'])fs.mkdirSync(path.join(full,d),{mode:0o700});
 const usage={A:{requests:0,characters:0},B:{requests:0},retries:0};
 const run={out:full,usage,manifest:{version:2,locks:currentLocks(),usage,jobs:{},clips:{},smoke:{},selection:{},createdAt:new Date().toISOString()}};
 write(path.join(full,'key/usage.json'),usage);save(run);
 write(path.join(full,'key/candidate.json'),config());write(path.join(full,'key/DECISION_RULES.md'),fs.readFileSync(path.join(DIR,'DECISION_RULES.md')));
 write(path.join(full,'key/disagreements.csv'),'blind_id,dimension,mike_rating,second_listener_rating,mike_note,second_listener_note,adjudication\n');
 return run;
}
function beginJob(run,id,which,chars=0){
 const existing=run.manifest.jobs[id];
 if(existing){if(existing.status==='complete')return existing;fail('Uncertain paid outcome requires review; refusing regeneration');}
 const budget=config().budget;
 if(which==='A'&&(run.usage.A.requests+1>budget.A.ttsRequests||run.usage.A.characters+chars>budget.A.ttsCharacters)||which==='B'&&run.usage.B.requests+1>budget.B.modelRequests)fail('Budget limit reached');
 run.usage[which].requests++;if(which==='A')run.usage.A.characters+=chars;
 run.manifest.usage=run.usage;
 const job={status:'inflight',path:which,index:run.usage[which].requests,artifacts:{}};
 run.manifest.jobs[id]=job;write(path.join(run.out,'key/usage.json'),run.usage);save(run);return job;
}
function completeJob(run,id,files,result){
 const job=run.manifest.jobs[id];job.artifacts=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(artifactFile(run,f)))]));
 job.result=result;job.status='complete';save(run);
}
function identity(run){
 const {openMemoryStore}=require('../services/member-memory');
 const file=path.join(run.out,'key/member.sqlite');const store=openMemoryStore(file);
 let credentials;
 if(!run.manifest.memberId){
  credentials=store.enroll();run.manifest.memberId=credentials.memberId;
  store.create(credentials.memberId,'aline','reviewed-synthetic-fixture',{scope:'all',content:pack().sharedFact});save(run);
 }else{
  // Rotate only this generated synthetic identity's credential on resume. Never
  // persist a bearer secret; retained member/memory IDs and provenance stay fixed.
  const credential=randomBytes(32).toString('base64url');
  const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(file);
  const changed=db.prepare('UPDATE members SET credential_hash=? WHERE id=?').run(hash(credential),run.manifest.memberId);db.close();
  if(Number(changed.changes)!==1)fail('Synthetic member identity missing');
  credentials={memberId:run.manifest.memberId,credential};
 }
 store.close();return {file,...credentials};
}
function memorySession(run,persona){
 if(!run.identity)run.identity=identity(run);
 if(!run.runtime)run.runtime=require('../services/member-runtime').createMemberRuntime(run.identity.file);
 const session=run.runtime.connect('Bearer '+run.identity.credential,persona,()=>{});
 const memory=session.begin(),digest=hash(memory.content);
 if(run.manifest.memoryHash&&run.manifest.memoryHash!==digest){session.end();session.close();fail('Shared memory differs');}
 run.manifest.memoryHash=digest;save(run);
 session.end();session.close();return memory;
}
function failure(run,which,stage,e){
 const reason=e instanceof HarnessError?e.message:'Unexpected local operation failed';
 const record={path:which,stage,reason,requestIndex:run?.usage?.[which]?.requests||0,budget:run?.usage||null,timestamp:new Date().toISOString()};
 if(run)write(path.join(run.out,'key/failure.json'),record);return record;
}
module.exports={ROOT,DIR,PRIVATE,hash,read,write,fail,HarnessError,config,pack,sourceParts,buildModelRequest,differences,assertParity,checkFixture,lockErrors,parityErrors,blockersForA,blockersForB,blockersForClientStop,currentLocks,openRun,verifyResume,save,beginJob,completeJob,memorySession,identity,failure};
