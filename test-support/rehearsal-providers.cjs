'use strict';
// Test-only fetch replacement. Never makes a network request.
global.fetch=async (url)=>{
 if(String(url).startsWith('https://api.elevenlabs.io/'))return new Response(Buffer.alloc(320),{status:200});
 if(String(url)==='https://api.anthropic.com/v1/messages')return new Response(JSON.stringify({content:[{type:'text',text:"I'm here."}]}),{status:200});
 throw Error('Unexpected test URL');
};
