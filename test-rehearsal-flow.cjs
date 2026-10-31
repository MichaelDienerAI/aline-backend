'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const c=require('./scripts/rehearsal-core.cjs'),proof=c.read(path.join(c.DIR,'server-request-parity.json'));
const out='private-rehearsals/flow-test-'+Date.now();
const env={PATH:process.env.PATH,MODEL_NAME:proof.model,ANTHROPIC_API_KEY:'synthetic',ELEVENLABS_API_KEY:'synthetic',NODE_OPTIONS:''};
function run(args){return spawnSync(process.execPath,['--require','./test-support/rehearsal-providers.cjs','scripts/bounded-rehearsal.cjs','--path','ab','--output',out,...args],{cwd:c.ROOT,env,encoding:'utf8'});}
let r=run(['--execute-smoke']);assert.equal(r.status,0,r.stderr);assert(r.stdout.includes('FULL A/B EXECUTION AUTHORIZATION REQUIRED'));
let manifest=c.read(path.join(c.ROOT,out,'key/manifest.json'));assert.equal(manifest.usage.A.requests,1);assert.equal(manifest.usage.B.requests,1);assert.equal(Object.keys(manifest.clips).length,1);
console.log('PASS smoke stops at one request per path');
r=run(['--execute-full']);assert.equal(r.status,1);assert(r.stderr.includes('without --resume'));console.log('PASS full existing directory requires resume');
r=run(['--execute-full','--resume']);assert.equal(r.status,0,r.stderr);manifest=c.read(path.join(c.ROOT,out,'key/manifest.json'));
assert.equal(Object.keys(manifest.clips).length,30);assert.equal(manifest.usage.B.requests,12);assert.equal(manifest.usage.A.requests,c.pack().variants.reduce((n,v)=>n+v.groups.length,0));
assert(fs.readdirSync(path.join(c.ROOT,out,'listening')).every(f=>/^[a-f0-9]{24}\.wav$/.test(f)));
console.log('PASS full reuses smoke artifacts and emits 30 blind clips plus 12 text responses');
const before=JSON.stringify(manifest.usage);r=run(['--execute-full','--resume']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.stringify(c.read(path.join(c.ROOT,out,'key/usage.json'))),before);console.log('PASS completed full resume makes zero new requests');
const fullOnly=out+'-no-smoke';r=spawnSync(process.execPath,['--require','./test-support/rehearsal-providers.cjs','scripts/bounded-rehearsal.cjs','--path','ab','--output',fullOnly,'--execute-full'],{cwd:c.ROOT,env,encoding:'utf8'});assert.equal(r.status,1);assert.equal(c.read(path.join(c.ROOT,fullOnly,'key/usage.json')).A.requests,0);console.log('PASS full execution without smoke refuses before provider calls');
console.log('5 flow checks passed; only local doubles used');
