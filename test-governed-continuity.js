'use strict';
// Governed continuity loop (T1–T12) over the real WebSocket transport.
// Synthetic fixtures and vendor doubles only: this proves the mechanism, not
// live persona naturalness.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const WebSocket=require('ws');
const {openMemoryStore}=require('./services/member-memory');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'persona-governed-'));
const dbPath=path.join(dir,'members.sqlite'), capture=path.join(dir,'capture.jsonl');
const store=openMemoryStore(dbPath), a=store.enroll(), b=store.enroll(); store.close();
fs.writeFileSync(capture,'');
const read=()=>fs.readFileSync(capture,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const FACT_A='The member\'s sister Synthea lives in Porto.';
const FACT_B='The member\'s sister Synthea lives in Valencia.';
let child,port,checks=0,failures=0,serial=0,stdout='';
const sockets=new Set();
function check(name,fn){try{fn();checks++;console.log('PASS '+name);}catch(e){failures++;console.log('FAIL '+name+' — '+e.message.split('\n')[0]);}}
async function waitFor(fn){for(let i=0;i<200;i++){if(fn())return;await pause(20);}throw Error('timed out');}
async function start(){
 port=5700+(process.pid%1000);
 const env={PATH:process.env.PATH,PORT:String(port),MODEL_NAME:'synthetic-local',ANTHROPIC_API_KEY:'synthetic',
  DEEPGRAM_API_KEY:'synthetic',ELEVENLABS_API_KEY:'synthetic',PERSONA_V4_DB:dbPath,V4_TEST_CAPTURE:capture};
 child=spawn(process.execPath,['--require',path.join(__dirname,'test-support/v4-providers.cjs'),'server.js'],{cwd:__dirname,env,stdio:['ignore','pipe','pipe']});
 let ready=false,errors='';
 child.stdout.on('data',d=>{stdout+=d;if(d.toString().includes('Backend v3.3.0 on port'))ready=true;});child.stderr.on('data',d=>{errors+=d;stdout+=d;});
 await waitFor(()=>{if(child.exitCode!==null)throw Error('server exited: '+errors);return ready;});
}
async function stop(){for(const s of sockets)s.terminate();sockets.clear();if(child&&child.exitCode===null){child.kill();await once(child,'exit');}}
async function connect(member,persona){const ws=new WebSocket(`ws://127.0.0.1:${port}/?persona=${persona}`,{headers:{Authorization:'Bearer '+member.credential}});sockets.add(ws);await once(ws,'open');ws.events=[];ws.on('message',(d,binary)=>{if(!binary)ws.events.push(JSON.parse(d));});return ws;}
async function close(ws){ws.close();await once(ws,'close');sockets.delete(ws);}
function send(ws,action,props={}){const requestId=String(++serial);ws.send(JSON.stringify({type:'memory',requestId,action,...props}));return requestId;}
async function reply(ws,requestId){await waitFor(()=>ws.events.some(e=>e.requestId===requestId));return ws.events.find(e=>e.requestId===requestId);}
const control=(ws,action,props)=>reply(ws,send(ws,action,props));
async function turn(ws,text){const start=ws.events.length,logStart=read().length;ws.send(JSON.stringify({type:'message',content:text}));await waitFor(()=>ws.events.slice(start).some(e=>e.type==='response_complete'||e.type==='error'));return {events:ws.events.slice(start),trace:read().slice(logStart)};}
const model=t=>t.trace.find(e=>e.type==='model').config;
const context=t=>JSON.parse(model(t).messages[0].content);
const records=t=>{const c=context(t);return [...c.institutional,...c.relationship];};
const ids=t=>records(t).map(m=>m.id);
const sees=(t,text)=>JSON.stringify(model(t)).includes(text);
const receipt=t=>t.events.find(e=>e.type==='memory_receipt');
const active=list=>list.filter(m=>m.status==='active');
(async()=>{try{
 await start();
 // T1 — save with Aline, reconnect, retrieve.
 let aline=await connect(a,'aline');
 const saved=await control(aline,'create',{memory:{content:FACT_A,scope:'all'}});
 const A=saved.result;
 check('T1 save returns an active durable record',()=>{assert.equal(saved.type,'memory_result');assert.equal(A.status,'active');});
 await close(aline);aline=await connect(a,'aline');
 const t1=await turn(aline,'How are you today?');
 check('T1 Aline retrieves the saved record after reconnect',()=>assert(ids(t1).includes(A.id)));
 // T2 — Chase retrieves the same record.
 let chase=await connect(a,'chase');
 const t2=await turn(chase,'How are you today?');
 check('T2 Chase retrieves the same record id',()=>assert(ids(t2).includes(A.id)));
 // T7 — provenance and receipt.
 check('T7 provenance: member-explicit save through Aline',()=>{const r=records(t2).find(m=>m.id===A.id);assert.equal(r.source.type,'member_explicit');assert.equal(r.source.confidanteId,'aline');assert.ok(r.createdAt);});
 check('T7 used-memory receipt names exactly the supplied records',()=>{const r=receipt(t2);assert(r,'no memory_receipt frame');assert.deepEqual([...r.ids].sort(),[...ids(t2)].sort());});
 // T3 — no stored memory: nothing supplied, receipt empty.
 const bAline=await connect(b,'aline'),t3=await turn(bAline,'What do you remember about me?');
 check('T3 member without records gets empty context and empty receipt',()=>{assert.deepEqual(ids(t3),[]);assert(!sees(t3,'Synthea'));assert.deepEqual(receipt(t3)?.ids,[]);});
 // T4 — correction through Chase.
 const corrected=await control(chase,'edit',{id:A.id,content:FACT_B});
 const B=corrected.result;
 check('T4 correction creates a new active version that supersedes A',()=>{assert.equal(corrected.type,'memory_result');assert.notEqual(B.id,A.id);assert.equal(B.content,FACT_B);assert.equal(B.status,'active');assert.equal(B.supersedes,A.id);});
 const oldA=await control(chase,'inspect',{id:A.id});
 check('T4 A is retained, explicitly superseded, linked to B, content intact',()=>{assert.equal(oldA.result.status,'superseded');assert.equal(oldA.result.supersededBy,B.id);assert.equal(oldA.result.content,FACT_A);});
 check('T7 correction provenance: member correction through Chase; A keeps Aline origin',()=>{assert.equal(B.source.type,'member_correction');assert.equal(B.source.confidanteId,'chase');assert.equal(B.source.supersedes,A.id);assert.equal(oldA.result.source.confidanteId,'aline');});
 // T5/T6 — the other confidante, fresh, gets B and never A.
 await close(aline);aline=await connect(a,'aline');
 const t6=await turn(aline,'How is my family?');
 check('T6 Aline (fresh) retrieves the correction made through Chase',()=>{assert(ids(t6).includes(B.id));assert(sees(t6,'Valencia'));});
 check('T5 superseded A is not supplied as current truth',()=>{assert(!ids(t6).includes(A.id));assert(!sees(t6,'Porto'));});
 const t5c=await turn(chase,'And now?');
 check('T5 existing Chase session also drops A',()=>{assert(!ids(t5c).includes(A.id));assert(!sees(t5c,'Porto'));assert(ids(t5c).includes(B.id));});
 const list=await control(aline,'list');
 check('T5 list shows exactly one active version and A as superseded',()=>{const chain=list.result.filter(m=>[A.id,B.id].includes(m.id));assert.equal(active(chain).length,1);assert.equal(active(chain)[0].id,B.id);assert.equal(chain.find(m=>m.id===A.id).status,'superseded');});
 // A superseded record cannot regain authority.
 const reEdit=await control(aline,'edit',{id:A.id,content:'Synthea lives in Lisbon.'});
 const reScope=await control(aline,'rescope',{id:A.id,scope:'all'});
 check('T12 second correction of the superseded A is refused',()=>assert.equal(reEdit.code,'not_current'));
 check('T5 superseded A cannot be rescoped back into use',()=>assert.equal(reScope.code,'not_current'));
 // T12 — two corrections racing the same active record.
 const r1=send(aline,'edit',{id:B.id,content:'The member\'s sister Synthea lives in Seville.'}),r2=send(chase,'edit',{id:B.id,content:'The member\'s sister Synthea lives in Bilbao.'});
 const [x,y]=[await reply(aline,r1),await reply(chase,r2)];
 const after=await control(aline,'list');
 const chain=after.result.filter(m=>m.content.includes('Synthea'));
 check('T12 racing corrections: exactly one wins, the other is refused, one active version',()=>{assert.deepEqual([x.type,y.type].sort(),['memory_error','memory_result']);assert.equal([x,y].find(e=>e.type==='memory_error').code,'not_current');assert.equal(active(chain).length,1);});
 const C=active(chain)[0];
 // T8 — scope.
 const priv=await control(aline,'create',{memory:{content:'Synthetic Aline-only note.',scope:'private'}});
 const t8=await turn(chase,'Anything else?');
 check('T8 Aline-private record never reaches Chase',()=>{assert(!ids(t8).includes(priv.result.id));assert(!sees(t8,'Aline-only'));});
 const privFix=await control(aline,'edit',{id:priv.result.id,content:'Synthetic Aline-only note, corrected.'});
 const t8b=await turn(chase,'Anything else?');
 check('T8 correction keeps private scope and origin',()=>{assert.equal(privFix.result.scope,'private');assert.equal(privFix.result.origin,'aline');assert(!sees(t8b,'Aline-only'));});
 // Scope doctrine A: scope limits which confidante's model receives a memory;
 // the member sees and governs every memory from any room.
 const fromChase=await control(chase,'inspect',{id:privFix.result.id});
 const govern=await control(chase,'edit',{id:privFix.result.id,content:'Synthetic Aline-only note, corrected from Chase.'});
 const t8c=await turn(chase,'Anything else?'),t8a=await turn(aline,'Anything else?');
 check('T8 member inspects and corrects an Aline-private memory from Chase\'s room',()=>{assert.equal(fromChase.type,'memory_result');assert.equal(govern.result.scope,'private');assert.equal(govern.result.origin,'aline');assert.equal(govern.result.source.confidanteId,'chase');});
 check('T8 governing it from Chase never gives it to Chase\'s model or receipt',()=>{assert(!ids(t8c).includes(govern.result.id));assert(!sees(t8c,'Aline-only'));assert(!receipt(t8c).ids.includes(govern.result.id));assert(ids(t8a).includes(govern.result.id));});
 const sel=await control(aline,'create',{memory:{content:'Synthetic Chase-selected note.',scope:'selected',permitted:['chase']}});
 const t8s=await turn(chase,'Anything else?'),t8sa=await turn(aline,'Anything else?');
 check('T8 selected scope reaches only the permitted confidante, even when saved elsewhere',()=>{assert(ids(t8s).includes(sel.result.id));assert(!ids(t8sa).includes(sel.result.id));assert(!sees(t8sa,'Chase-selected'));});
 await control(aline,'delete',{id:sel.result.id});
 // T9 — member isolation, including correction attempts.
 const bChase=await connect(b,'chase');
 const t9=await turn(bChase,'What do you know?');
 const steal=await control(bChase,'edit',{id:C.id,content:'Hijacked.'});
 const peek=await control(bChase,'inspect',{id:A.id});
 check('T9 member B sees nothing of member A and cannot correct or inspect it',()=>{assert.deepEqual(ids(t9),[]);assert(!sees(t9,'Synthea'));assert.equal(steal.code,'not_found');assert.equal(peek.code,'not_found');});
 // T11 — duplicate writes.
 const d1=await control(aline,'create',{memory:{content:'Synthetic duplicate fact.',scope:'all'}});
 const d2=await control(aline,'create',{memory:{content:'Synthetic duplicate fact.',scope:'all'}});
 const d3=await control(chase,'create',{memory:{content:'Synthetic duplicate fact.',scope:'all'}});
 const dl=(await control(aline,'list')).result.filter(m=>m.content==='Synthetic duplicate fact.');
 check('T11 repeated identical save through the same confidante is idempotent',()=>assert.equal(d1.result.id,d2.result.id));
 check('T11 same text saved through the other confidante (surfaced: distinct origin → distinct record)',()=>{assert.equal(dl.length,d3.result.id===d1.result.id?1:2);console.log('  note: cross-confidante duplicate creates '+dl.length+' active record(s)');});
 const resave=await control(aline,'create',{memory:{content:FACT_A,scope:'all'}});
 check('T11 re-saving superseded text never resurrects the superseded record',()=>{assert.notEqual(resave.result.id,A.id);assert.equal(resave.result.status,'active');});
 await control(aline,'delete',{id:resave.result.id});
 // T10 — restart.
 await close(aline);await close(chase);await close(bAline);await close(bChase);await stop();await start();
 for(const p of ['aline','chase']){const ws=await connect(a,p),t=await turn(ws,'Fresh process.');
  check('T10 after restart '+p+' gets the corrected version only',()=>{assert(ids(t).includes(C.id));assert(!ids(t).includes(A.id)&&!ids(t).includes(B.id));assert(!sees(t,'Porto'));});await close(ws);}
 // Forget: deleting the current version removes its whole history.
 aline=await connect(a,'aline');
 const forgot=await control(aline,'delete',{id:C.id});
 const gone=await Promise.all([A.id,B.id,C.id].map(id=>control(aline,'inspect',{id})));
 const tf=await turn(aline,'Fresh turn.');
 check('Forget removes the current version and its superseded history',()=>{assert.equal(forgot.type,'memory_result');for(const g of gone)assert.equal(g.code,'not_found');assert(!sees(tf,'Synthea'));});
 await close(aline);
 // Observability: memory events logged with ids only.
 const lines=stdout.split('\n').filter(l=>l.startsWith('[memory] '));
 check('memory events are logged',()=>{const ev=lines.map(l=>JSON.parse(l.slice(9)).event);for(const e of ['memory_saved','memory_corrected','memory_supplied','memory_forgotten'])assert(ev.includes(e),'missing '+e);});
 check('memory log lines carry no content and no member id',()=>{for(const l of lines){assert(!/Synthea|Porto|Valencia|Seville|Bilbao|Aline-only|duplicate fact/.test(l));assert(!l.includes(a.memberId)&&!l.includes(b.memberId));}});
 console.log(`${checks}/${checks+failures} passed`);
 if(failures)process.exitCode=1;
}finally{await stop();}})().catch(async e=>{console.error('ABORT',e.message);process.exitCode=1;await stop();});
