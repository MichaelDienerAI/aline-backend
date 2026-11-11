'use strict';
// Response ceiling: the qualified max_tokens 400 stays, and a max_tokens stop never shows or speaks
// an unfinished fragment. Unit checks for the sentence boundary and the log
// line, then the real server.js with provider doubles
// (test-support/response-ceiling-providers.cjs). Synthetic text only.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {spawn}=require('child_process'),{once}=require('events'),WebSocket=require('ws');
const {openMemoryStore}=require('./services/member-memory');
const {takeFinishedSentences,modelResponseLog}=require('./services/response-ceiling');
const {APPROVED_FALLBACK}=require('./services/release-policy');

let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name)};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<1000;n++){if(fn())return;await delay(10)}throw Error('timeout')}

// ── Sentence boundary at the ceiling ──
const cases=[
 ['period','Done here. And then the',['Done here.'],' And then the'],
 ['question','Is it done? And then the',['Is it done?'],' And then the'],
 ['exclamation','It is done! And then the',['It is done!'],' And then the'],
 ['straight quote','He said "it holds." And then',['He said "it holds."'],' And then'],
 ['curly double quote','She wrote “not quite.” And then',['She wrote “not quite.”'],' And then'],
 ['curly single quote','He called it ‘done.’ And then',['He called it ‘done.’'],' And then'],
 ['closing parenthesis','(That much is settled.) And then',['(That much is settled.)'],' And then'],
 ['several sentences','One. Two? Three! Four is cut',['One.',' Two?',' Three!'],' Four is cut'],
 ['boundary at the very end','Everything is finished.',['Everything is finished.'],''],
 ['whitespace tail','Everything is finished. ',['Everything is finished.'],' '],
 ['no complete sentence','an answer that never reaches its end',[],'an answer that never reaches its end'],
 ['empty buffer','',[],''],
];
for(const [name,buffer,sentences,fragment] of cases)check('ceiling boundary: '+name,()=>{
 const r=takeFinishedSentences(buffer);assert.deepEqual(r.sentences,sentences);assert.equal(r.fragment,fragment);assert.equal(r.sentences.join('')+r.fragment,buffer);
});
check('ceiling boundary is repeatable (no regex state carried between calls)',()=>{
 assert.deepEqual(takeFinishedSentences('A. B').sentences,['A.']);assert.deepEqual(takeFinishedSentences('A. B').sentences,['A.']);
});
check('model log line: persona, stop reason and output tokens only',()=>{
 const line=modelResponseLog('aline','max_tokens',400);assert(line.startsWith('[model] '));
 assert.deepEqual(JSON.parse(line.slice(8)),{persona:'aline',stopReason:'max_tokens',outputTokens:400});
 assert.deepEqual(JSON.parse(modelResponseLog('chase',undefined,NaN).slice(8)),{persona:'chase',stopReason:null,outputTokens:null});
});

// ── The real server with provider doubles ──
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'response-ceiling-')),db=path.join(dir,'synthetic.sqlite'),capture=path.join(dir,'capture');
const store=openMemoryStore(db),member=store.enroll();store.close();
const SCENARIO_TEXT={
 ceilingFragment:'Then the model ran out in the middle of',
 noSentence:'an answer that never reaches its own end because the ceiling arrives first and',
};
const norm=s=>s.replace(/\s+/g,' ').trim();

async function turn(mode,persona,messages){
 fs.writeFileSync(capture,'');const port=19000+process.pid%10000;let child,ws,logs='';
 const trace=()=>fs.readFileSync(capture,'utf8').split('\n').filter(Boolean).map(JSON.parse);
 try{
  child=spawn(process.execPath,['--require','./test-support/response-ceiling-providers.cjs','server.js'],{cwd:__dirname,env:{PATH:process.env.PATH,NODE_OPTIONS:process.env.NODE_OPTIONS||'',PORT:String(port),MODEL_NAME:'synthetic',ANTHROPIC_API_KEY:'synthetic',DEEPGRAM_API_KEY:'synthetic',ELEVENLABS_API_KEY:'synthetic',PERSONA_V4_DB:db,CEILING_MODE:mode,CEILING_CAPTURE:capture,ALINE_CADENCE_V2:'1',CHASE_CADENCE_V1:'1',ALINE_CADENCE_V1:'0'}});
  child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  await until(()=>{if(child.exitCode!==null)throw Error('child exited '+logs);return logs.includes('Backend v3.3.0 on port')});
  ws=new WebSocket(`ws://127.0.0.1:${port}/?persona=${persona}`,{headers:{Authorization:'Bearer '+member.credential}});
  const events=[];ws.on('message',(d,b)=>{if(!b)events.push({...JSON.parse(d),at:Date.now()})});await once(ws,'open');
  const turns=[];
  for(const content of messages){
   const start=events.length;ws.send(JSON.stringify({type:'message',content}));
   await until(()=>events.slice(start).some(e=>e.type==='response_complete'||e.type==='error'));
   const mine=events.slice(start);turns.push({text:mine.filter(e=>e.type==='response_text').map(e=>e.text).join(''),firstTextAt:mine.find(e=>e.type==='response_text')?.at,events:mine});
  }
  await delay(300);
  const modelLines=logs.split('\n').filter(l=>l.startsWith('[model] ')).map(l=>JSON.parse(l.slice(8)));
  return {turns,trace:trace(),logs,modelLines};
 }finally{ws?.terminate();if(child&&child.exitCode===null){child.kill();await once(child,'exit')}}
}

(async()=>{
 for(const persona of ['aline','chase']){
  // A. Normal short response
  {const r=await turn('short',persona,['What is the difference between confidence and certainty?']);
   check(persona+' A short: request ceiling is the qualified 400',()=>assert(r.trace.filter(e=>e.type==='model').every(e=>e.config.max_tokens===400)));
   check(persona+' A short: full response sent',()=>assert.equal(norm(r.turns[0].text),'Confidence is a feeling. Certainty is a claim about the world.'));
   check(persona+' A short: full response spoken',()=>assert.equal(norm(r.trace.filter(e=>e.type==='tts').map(e=>e.text).join(' ')),'Confidence is a feeling. Certainty is a claim about the world.'));
   check(persona+' E logging: one [model] line with persona, end_turn and token count',()=>assert.deepEqual(r.modelLines,[{persona,stopReason:'end_turn',outputTokens:24}]));}
  // B. Near-ceiling response that ends normally
  {const r=await turn('long',persona,['Walk me through it in detail.']);
   const expected=Array.from({length:25},(_,i)=>`Sentence ${i+1} carries a measured thought about decisions and their weight.`).join(' ');
   check(persona+' B near-ceiling (380 tokens): full response completes, no premature cutoff',()=>assert.equal(norm(r.turns[0].text),expected));
   check(persona+' B long: every sentence spoken',()=>assert.equal(norm(r.trace.filter(e=>e.type==='tts').map(e=>e.text).join(' ')),expected));
   check(persona+' B/F streaming begins before generation ends (first text precedes last chunk)',()=>{const chunks=r.trace.filter(e=>e.type==='chunk_emitted');assert(r.turns[0].firstTextAt<chunks.at(-1).at,'first text '+r.turns[0].firstTextAt+' last chunk '+chunks.at(-1).at)});
   check(persona+' E logging: end_turn with 380 tokens',()=>assert.deepEqual(r.modelLines,[{persona,stopReason:'end_turn',outputTokens:380}]));}
  // C. Forced max_tokens stop with sentence edge cases (D)
  {const r=await turn('ceiling',persona,['Give me the long version.','And next?']);
   const kept='The first point is finished. Is the second one finished? Yes! He said "it holds." And she wrote “not quite.”';
   check(persona+' C ceiling: frontend receives only complete sentences',()=>assert.equal(norm(r.turns[0].text),kept));
   check(persona+' C ceiling: unfinished fragment never sent',()=>assert(!r.turns[0].text.includes('ran out')));
   check(persona+' C ceiling: TTS receives only complete sentences',()=>{const spoken=norm(r.trace.filter(e=>e.type==='tts').map(e=>e.text).join(' '));assert(!spoken.includes('ran out'));assert(spoken.includes('not quite'));});
   check(persona+' C ceiling: history holds only what the member received',()=>{const second=r.trace.filter(e=>e.type==='model')[1].config.messages;const assistant=second.filter(m=>m.role==='assistant').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join(' ');assert(assistant.includes('not quite'));assert(!assistant.includes(SCENARIO_TEXT.ceilingFragment))});
   check(persona+' E logging: max_tokens with 400 tokens',()=>assert.deepEqual(r.modelLines[0],{persona,stopReason:'max_tokens',outputTokens:400}));}
  {const r=await turn('ceilingAtBoundary',persona,['Finish cleanly.']);
   check(persona+' D ceiling exactly at a sentence end keeps that sentence',()=>assert.equal(norm(r.turns[0].text),'Everything here is finished. The last sentence closes exactly at the ceiling.'));}
  {const r=await turn('ceilingNoSentence',persona,['Say something.']);
   check(persona+' D no complete sentence before the ceiling: approved fallback, no fragment',()=>{assert.equal(norm(r.turns[0].text),APPROVED_FALLBACK);assert(!r.turns[0].text.includes('never reaches'))});
   check(persona+' D no complete sentence: fragment never spoken',()=>{const spoken=r.trace.filter(e=>e.type==='tts').map(e=>e.text).join(' ');assert(!spoken.includes('never reaches'));});
   check(persona+' E no message content in [model] lines',()=>{const lines=r.logs.split('\n').filter(l=>l.startsWith('[model] '));assert(lines.length>0);for(const l of lines)for(const s of [...Object.values(SCENARIO_TEXT),'Say something','finished'])assert(!l.includes(s));});}
 }
 console.log(count+' checks passed; actual local server with provider doubles only');
})().catch(e=>{console.error(e);process.exitCode=1});
