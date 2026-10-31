'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const profiles=require('./services/cadence-profiles'),core=require('./services/cadence-compiler'),pass1=require('./services/cadence-pass1'),policy=require('./services/release-policy');
const {createSpeechLifecycle}=require('./services/speech-lifecycle');
const env={ALINE_CADENCE_V2:'1',CHASE_CADENCE_V1:'1'};
const profile=(p,w=3,input='',prior=false)=>profiles.forTurn(p,{weight:w},input,prior,env);
let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const text='There is room for both parts of this decision, because the place can change before your obligations change, and neither fact cancels the other.';
const fixtures=[text,"I'm here.",'What would make room for that?', 'Dr. Costa stayed; the number was 3.14.',
 'Keep the **original** qualifier, because it matters.', 'You said “stay, not leave,” and I heard the distinction.',
 '🌱 Nothing has to be solved tonight.', 'I hear how much that cost.', 'No, no, no, not now.', '',
 'If the room expects certainty, while the evidence leaves room for doubt, the doubt still belongs here.'];
for(const persona of ['aline','chase'])for(const w of [1,3,5,8,13,21])test(`${persona} W${w} exact normalized reconstruction across punctuation fixtures`,()=>{
 for(const raw of fixtures){const s=policy.normalizeForSpeech(raw),p=profiles.compileCanonical(s,profile(persona,w));if(!s){assert.equal(p,null);continue;}
 assert.equal(core.reconstruct(p),s);assert.equal(core.validatePlan(s,p.segments.map(g=>g.text)),null);
 assert(p.segments.every(g=>g.beforeMs>=0&&g.beforeMs<=500&&g.afterMs>=0&&g.afterMs<=500));
 if(w>=13||persona==='chase'&&w>=8)assert.equal(p.segments.length,1);
 }
});
test('strict opt-in and no cross-profile routing',()=>{
 for(const p of ['aline','chase','unknown'])assert.equal(profiles.select(p,{}),null);
 assert.equal(profiles.select('chase',{ALINE_CADENCE_V2:'1'}),null);
 assert.equal(profiles.select('aline',{CHASE_CADENCE_V1:'1'}),null);
 assert.equal(profiles.select('aline',{ALINE_CADENCE_V2:'true'}),null);
 assert.equal(profiles.compileCanonical(text,{...profile('aline'),persona:'chase'}),null);
});
test('ordinary Aline elasticity and distinct Chase grouping',()=>{
 const a=profiles.compileCanonical(text,profile('aline')),c=profiles.compileCanonical(text,profile('chase'));
 const lengths=a.segments.map(g=>g.text.trim().split(/\s+/).length);
 assert(new Set(lengths).size>1);assert.notDeepEqual(a.segments.map(g=>g.text),c.segments.map(g=>g.text));
 assert(a.segments.length<=3);assert(c.segments.length<=3);assert(c.segments.at(-1).beforeMs>a.segments.at(-1).beforeMs);
});
test('W8 caps groups, W13 sparse, W21 disappears without deleting long authorized words',()=>{
 assert(profiles.compileCanonical(text,profile('aline',8)).segments.length<=2);
 assert.equal(profiles.compileCanonical(text,profile('aline',13)).segments.length,1);
 const p=profiles.compileCanonical("I'm here.",profile('aline',21));assert.equal(p.segments.length,1);assert.equal(p.segments[0].afterMs,0);assert.equal(p.segments[0].beforeMs,0);
 assert(profile('aline',8).rules.includes('five to fifteen'));assert(profile('aline',13).rules.includes('two to eight'));assert(profile('aline',21).rules.includes('one to five'));
});
test('veil-drop explicit, one turn, cooldown, high-weight restraint',()=>{
 assert.equal(profile('chase',3,'be blunt').mode,'veil-drop');assert.equal(profile('chase',3,'Ordinary').mode,'patrician');
 assert.equal(profile('chase',3,'be blunt',true).mode,'patrician');assert.equal(profile('chase',8,'be blunt').mode,'restrained');
 assert.equal(profile('chase',3,'a contradiction').mode,'patrician');
 for(const input of ["Don't be blunt.",'They said “be blunt.”','Why do people say be blunt?'])assert.equal(profile('chase',3,input).mode,'patrician');
 assert.equal(profiles.forTurn('chase',null,'be blunt',false,env).mode,'restrained');
});
test('composition invariants and selection precede style, no advice or accent copying',()=>{
 for(const p of ['aline','chase']){const r=profile(p).rules;assert(r.indexOf('RESPONSE SELECTION')<r.indexOf('CADENCE COMPOSITION'));assert(r.includes('No accent spelling'));assert(r.includes('Never drop required content'));}
 assert(profile('chase').rules.includes('Never extract, perform loyalty, advise'));assert(profile('aline').rules.includes('Never abandon or judge'));
});
test('shared validator rejects corrupt words, reorder, offsets and unsafe boundaries',()=>{
 for(const mutate of [p=>{p.segments[0].text+='changed';},p=>{p.segments.reverse();},p=>{p.segments[0].start=3;}]){
 assert.equal(pass1.compileCanonical(text,s=>{const p=core.compile(s);mutate(p);return p;}),null);
 }
});
test('profile compiler exceptions discard the plan for canonical fallback',()=>{
 const saved=core.compile;try{core.compile=()=>{throw Error('synthetic');};assert.equal(profiles.compileCanonical(text,profile('aline')),null);assert.equal(profiles.compileCanonical(text,profile('chase')),null);}finally{core.compile=saved;}
});
const source=fs.readFileSync('server.js','utf8');
const seam=source.slice(source.indexOf('      function authorizeSegment(segment) {'),source.indexOf('      // Drive one stream, gating at every complete sentence.'));
test('both profiles compile only after actual spoken approval',()=>{
 for(const p of ['aline','chase'])for(const text of ["I'm **not** qualified to help.",'I am here with you.']){
 const events=[];const ctx={releasedText:'',spokenSoFar:'',turnProfile:profile(p),cadenceEnabled:false,cadenceProfiles:{compileCanonical:(s,p)=>{events.push('compile');return profiles.compileCanonical(s,p);}},normalizeForSpeech:policy.normalizeForSpeech,evaluateReleaseSafe:s=>{const v=policy.evaluateReleaseSafe(s);events.push(v.approved?'approved':'rejected');return v;}};
 vm.createContext(ctx);vm.runInContext(seam,ctx);const auth=ctx.authorizeSegment(text);
 assert.equal(events.includes('compile'),auth.approved);if(auth.approved)assert.deepEqual(events,['approved','approved','compile']);
 }
});
test('cancellation invalidates old tokens and aborts active work once',()=>{
 const life=createSpeechLifecycle(),first=life.begin();let aborts=0;life.track(first,()=>aborts++);life.cancel();assert(!life.current(first));assert.equal(aborts,1);
 const second=life.begin();assert(life.current(second));assert(!life.current(first));life.track(first,()=>aborts++);assert.equal(aborts,2);
});
console.log(`${count}/${count} passed`);
