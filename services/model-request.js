'use strict';
// Sonnet 5.5's documented lowest-thinking mode avoids spending the unchanged
// 400-token conversational budget on up-front thinking. No sampling overrides.
function modelOptions(model) {
  return model === 'claude-sonnet-5-5'
    ? {thinking:{type:'between_tools'},output_config:{effort:'high'}} : {};
}
function continuationMessages(messages, released) {
  const prefix = released.trimEnd();
  return [...messages,
    ...(prefix ? [{role:'assistant',content:prefix}] : []),
    {role:'user',content:prefix
      ? 'Continue the response after the approved assistant text above. That text has already been delivered and must stand unchanged. Do not repeat or replace it. Supply only any necessary continuation under the updated release constraints.'
      : 'Provide a replacement response under the updated release constraints. No rejected text was delivered.'}];
}
module.exports={modelOptions,continuationMessages};
