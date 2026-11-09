'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {openMemoryStore,canConfidanteAccess} = require('./services/member-memory');
const {createMemberRuntime} = require('./services/member-runtime');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'persona-v4-store-'));
const filename = path.join(dir,'member.sqlite');
let count=0;
const check = (name,fn) => { fn(); count++; console.log('PASS '+name); };
let store=openMemoryStore(filename);
const a=store.enroll(), b=store.enroll();
const create=(scope,origin='aline',extra={}) => store.create(a.memberId,origin,'synthetic-session',{content:'Synthetic Lisbon fact',scope,...extra});
const visible=(id,p,member=a.memberId)=>store.retrieve(member,p).some(m=>m.id===id);
try {
 check('stable authenticated identity after store restart',()=>{store.close();store=openMemoryStore(filename);assert.equal(store.authenticate(a.credential),a.memberId);assert.throws(()=>store.authenticate('invalid'));});
 for (const origin of ['aline','chase']) {
  const m=create('private',origin);
  check(`${origin} private scope enforced at direct retrieval`,()=>{assert(visible(m.id,origin));assert(!visible(m.id,origin==='aline'?'chase':'aline'));});
 }
 const all=create('all');
 check('shared-all both personas, no member B',()=>{for(const p of ['aline','chase']) {assert(visible(all.id,p));assert(!visible(all.id,p,b.memberId));}});
 for (const permitted of [['aline'],['aline','chase']]) {
  const m=create('selected','aline',{permitted});
  check('selected '+permitted,()=>{for(const p of ['aline','chase']) assert.equal(visible(m.id,p),permitted.includes(p));});
 }
 check('deleted predicate rejects',()=>assert(!canConfidanteAccess({...all,deleted:true},a.memberId,'aline')));
 check('unknown member and persona fail closed',()=>{assert.throws(()=>store.retrieve('missing','aline'));assert.throws(()=>store.retrieve(a.memberId,'unknown'));assert.throws(()=>create('all','unknown'));});
 check('invalid scope, content, relational scope rejected',()=>{assert.throws(()=>create('bogus'));assert.throws(()=>create('all','aline',{content:''}));assert.throws(()=>create('all','aline',{kind:'relationship'}));assert.throws(()=>create('selected','aline',{permitted:['unknown']}));});
 check('do not retain writes nothing',()=>{const n=store.list(a.memberId).length;assert.equal(create('none'),null);assert.equal(store.list(a.memberId).length,n);});
 check('duplicate candidate idempotent without widening scope',()=>{assert.equal(create('all').id,all.id);assert.notEqual(create('private').id,all.id);});
 const same=store.create(b.memberId,'aline','b-session',{scope:'all',content:all.content});
 check('same text two members stays isolated',()=>{assert(!visible(same.id,'aline'));assert(visible(same.id,'chase',b.memberId));assert.throws(()=>store.inspect(b.memberId,all.id));assert.throws(()=>store.delete(b.memberId,all.id));});
 const rel=create('private','aline',{kind:'relationship',content:'Aline private relationship'});
 check('relationship separation',()=>{assert(store.context(a.memberId,'aline').relationship.some(m=>m.id===rel.id));assert(!visible(rel.id,'chase'));assert.throws(()=>store.update(a.memberId,rel.id,{scope:'all'}));});
 const child=create('all','aline',{content:'Derived Lisbon context',parents:[all.id]});
 const grandchild=create('private','chase',{content:'Chase derived relationship',kind:'relationship',parents:[child.id]});
 check('rescope inherited dynamically across lineage',()=>{store.update(a.memberId,all.id,{scope:'private'});assert(!visible(child.id,'chase'));assert(!visible(grandchild.id,'chase'));assert(visible(child.id,'aline'));});
 check('cross-member and private-parent derivation rejected',()=>{assert.throws(()=>create('all','chase',{parents:[rel.id]}));assert.throws(()=>create('all','aline',{parents:[same.id]}));});
 check('deletion cascades derived and relationship rows',()=>{const result=store.delete(a.memberId,all.id);assert.equal(result.deletedIds.length,3);for(const id of [all.id,child.id,grandchild.id]){assert.throws(()=>store.inspect(a.memberId,id));for(const p of ['aline','chase'])assert(!visible(id,p));}});
 const root=create('all','aline',{content:'Original'}), derived=create('all','aline',{content:'Stale',parents:[root.id]});
 const edited=store.correct(a.memberId,root.id,'Edited','aline','synthetic-session');
 check('correction supersedes and invalidates stale derived state',()=>{assert.equal(store.inspect(a.memberId,edited.id).content,'Edited');assert.equal(store.inspect(a.memberId,root.id).status,'superseded');assert.equal(store.inspect(a.memberId,root.id).content,'Original');assert.throws(()=>store.inspect(a.memberId,derived.id));assert(!visible(root.id,'aline'));});
 check('content cannot be patched in place',()=>assert.throws(()=>store.update(a.memberId,edited.id,{content:'In place'}),/invalid_patch/));
 check('ownership and provenance cannot be patched',()=>assert.throws(()=>store.update(a.memberId,root.id,{memberId:b.memberId})));
 // Inject a transaction failure after descendant deletion but before parent update.
 const child2=create('all','aline',{content:'Must survive rollback',parents:[edited.id]});
 const faultDb=new DatabaseSync(filename);
 faultDb.exec("CREATE TRIGGER fail_update BEFORE UPDATE ON memories BEGIN SELECT RAISE(ABORT, 'synthetic_failure'); END;");
 check('partial persistence failure rolls back all mutations',()=>{const n=store.list(a.memberId).length;assert.throws(()=>store.correct(a.memberId,edited.id,'Must roll back','aline','synthetic-session'));assert.equal(store.inspect(a.memberId,edited.id).status,'active');assert.equal(store.inspect(a.memberId,child2.id).content,'Must survive rollback');assert.equal(store.list(a.memberId).length,n);});
 faultDb.exec('DROP TRIGGER fail_update');faultDb.close();
 let resets=0;
 const runtime=createMemberRuntime(filename), as=runtime.connect('Bearer '+a.credential,'aline',()=>resets++), cs=runtime.connect('Bearer '+a.credential,'chase',()=>resets++);
 check('mutations reject during active generation including disconnected session',()=>{cs.begin();cs.close();assert.throws(()=>as.control({action:'delete',id:edited.id}),/member_busy_retry/);cs.end();as.control({action:'delete',id:edited.id});assert.equal(resets,1);});
 check('pending speech prevents successful mutation after generation ends',()=>{
  const pending = new Promise(()=>{});
  as.holdSpeech(pending);
  assert.throws(()=>as.control({action:'delete',id:rel.id}),/member_busy_retry/);
 });
 as.close();
 check('database unavailable fails closed',()=>{store.close();assert.throws(()=>store.retrieve(a.memberId,'aline'));});
 console.log(`${count}/${count} passed`);
} finally {try{store.close();}catch{}}
