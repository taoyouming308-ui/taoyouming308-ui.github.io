import {buildDesignPilotPrompt} from './design-pilot.mjs';
export const designExtractionPromptVersion='design-verbatim-extraction-v1';
export function buildDesignExtractionPrompt(session){
 const base=buildDesignPilotPrompt(session),input=JSON.parse(base.messages[1].content);
 // Model visual descriptions are not a person's words and are not sent as textual evidence.
 input.sources=input.sources.filter(s=>['text','speech_transcript'].includes(s.kind)&&s.actor!=='model');
 const sourceIds=new Set(input.sources.map(s=>s.messageId));
 input.entries=input.entries.filter(e=>e.basis==='said'&&e.sources.every(s=>sourceIds.has(s.messageId)));
 const instruction='本次任务仅原话提取，不提供任何建议或推断。所有entries必须origin=extraction、basis=said。value必须逐字存在于引用的人类原话中；未知参数保留null。技术groupId必须来自当前已存在的工艺组，zone/service/side必须完全相同，不新建、合并或镜像左右组。新组由员工先明确创建，不能模型猜。planned和actual由明确原话、当前阶段和员工组上下文约束，不能把计划当实际。不输出模型确认，状态只能unknown或not_confirmed。剪前仅人物和基础风格，不分析打理。';
 return Object.freeze({promptVersion:designExtractionPromptVersion,messages:[base.messages[0],{role:'system',content:instruction},{role:'user',content:JSON.stringify(input)}],responseSchema:base.responseSchema});
}
