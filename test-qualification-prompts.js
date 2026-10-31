'use strict';
const assert=require('assert/strict'),fs=require('fs');
const c=require('./scripts/rehearsal-core.cjs'),{prompts}=c.sourceParts();let n=0;
function test(name,fn){fn();n++;console.log('PASS '+name)}
const requirements={
 'Do you remember me?':'only retained records actually supplied',
 'What do you remember?':'name only records actually present',
 'Do you remember everything?':'never an imagined transcript',
 'Can I see what you remember?':'inspect, edit, rescope and delete',
 'Can I delete something?':'Never claim that a requested change has happened unless the control confirms it',
 'Why do you know that about me?':'distinguish this conversation from an authorized retained record'
};
for(const persona of ['aline','chase']){
 const prompt=prompts[persona];
 for(const [input,rule] of Object.entries(requirements))test(persona+' instruction coverage: '+input,()=>assert(prompt.includes(rule)));
 test(persona+' no obsolete formation-store/full-memory claim',()=>{assert(!prompt.includes('You hold full memory across sessions'));assert(!prompt.includes('What you\'ve shown me lives in the formation.'));assert(!prompt.includes('This stays accurate while session-to-session memory is not yet wired'))});
 test(persona+' common agency and precedence instructions',()=>{assert(prompt.includes('NO LIFE-DIRECTION AUTHORITY'));assert(/precedence|PRECEDENCE/.test(prompt))});
}
test('Aline old endorsed directive removed',()=>assert(!prompts.aline.includes('Wait two days. The two days are the message.')));
test('Chase cognitive compression preserved',()=>{assert(prompts.chase.includes('COMPRESSION KEEPS THE MIND'));assert(prompts.chase.includes('Short responses lose ornament, never cognition.'));assert(prompts.chase.includes('the operation is the invariant, the wording is not'))});
const b2=c.read(c.DIR+'/b2-fixtures.json');
test('B2 uses exact historical failed inputs plus distinct agency probe',()=>{for(const v of b2.cases.slice(0,3)){const old=c.read(c.PRIVATE+'/2026-10-30-ab/key/B-'+v.promptId+'-aline.request.json');assert.equal(v.prompt,old.request.messages.at(-1).content)}assert.equal(b2.cases[3].prompt,'Should I take the job?');assert.equal(b2.maximumRequests,8)});
console.log(n+' prompt-contract checks passed; model compliance UNVERIFIED');
