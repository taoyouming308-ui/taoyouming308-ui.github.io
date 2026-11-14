import {expenseSourceTargets,expenseComponents,matchExpenseComponent,expenseTargetKey} from './expense-voucher-matching.mjs';

export function buildExpenseVoucherWorkspace(base,source,links=[]) {
  const targets=expenseSourceTargets({...source,month:base.month},base.targets||[]);
  const targetMap=new Map(targets.map(t=>[expenseTargetKey(t),t]));
  const items=(base.items||[]).flatMap(parent=>{
    if(parent.confirmed_target_id) return [{...parent,source_voucher_id:parent.id,component_index:0}];
    const components=expenseComponents(parent.candidate_fields||{});
    return components.map((candidate,index)=>{
      const id=components.length>1?parent.id+'~'+index:parent.id;
      const split=Array.isArray(parent.candidate_fields?.transactions)&&parent.candidate_fields.transactions.length>0;
      const fields={...candidate,confidence:candidate.confidence||parent.field_confidences||{}};
      const linked=links.find(l=>l.voucher_id===parent.id && l.component_index===index && l.status==='active');
      const rejected=links.some(l=>l.voucher_id===parent.id && l.component_index===index && l.status==='void');
      const target=linked && targetMap.get(linked.target_kind+':'+linked.target_id);
      const match=matchExpenseComponent(fields,targets,base.month);
      if(source.status!=='ready' || ['queued','processing','failed','dead_letter'].includes(parent.task_status))match.auto_eligible=false;
      if(linked)match.auto_eligible=false;
      if(rejected)match.auto_eligible=false;
      return {...parent,id,source_voucher_id:parent.id,component_index:index,component_count:components.length,
        candidate_fields:{...fields,document_type:parent.candidate_fields?.document_type,
          document_kind:candidate.evidence_kind==='monthly_summary'?'monthly_summary':split?'receipt':candidate.document_kind},
        automate_on_read:parent.candidate_fields?.recognition_schema_version==='expense-voucher-v2',
        field_confidences:fields.confidence,match:linked&&target?{...match,state:'associated',target_kind:target.target_kind,target_id:target.id,reason:linked.mode==='auto'?'AI 已按可靠证据自动对应，未入账':'已人工对应，未入账'}:match,
        expense_association:linked||null,association_stale:Boolean(linked&&!target),
        confirmed_target_kind:target?.target_kind||null,confirmed_target_id:target?.id||null,
        corrected_fields:linked?.corrected_fields||{}};
    });
  });
  // Independent payments in one image must not silently consume the same row.
  const sameImageTargets=new Map();
  for(const item of items){
    const kind=item.confirmed_target_kind||item.match?.target_kind,id=item.confirmed_target_id||item.match?.target_id;
    if(!kind||!id)continue;
    const key=(item.source_voucher_id||item.id)+'|'+kind+':'+id,group=sameImageTargets.get(key)||[];
    group.push(item);sameImageTargets.set(key,group);
  }
  for(const group of sameImageTargets.values())if(group.length>1)for(const item of group)if(!item.confirmed_target_id&&item.match?.auto_eligible)
    item.match={...item.match,state:'ambiguous',auto_eligible:false,unique_exact:false,reason:'同图多笔指向同一明细，需核对各笔对应关系'};
  const associated=items.filter(i=>i.confirmed_target_id), needs=items.filter(i=>!i.confirmed_target_id&&!['queued','processing','failed','dead_letter'].includes(i.task_status)&&!i.match?.auto_eligible);
  return {...base,items,targets,source_status:source.status,source_message:source.message||null,
    source_selection:source.source||null,expense_links:links,
    summary:{...base.summary,components:items.length,ready:items.filter(i=>!i.confirmed_target_id&&i.match?.auto_eligible).length,
      needs_review:new Set(needs.map(i=>i.source_voucher_id||i.id)).size,
      failed:new Set(items.filter(i=>['failed','dead_letter'].includes(i.task_status)).map(i=>i.source_voucher_id||i.id)).size,
      auto_matched:associated.filter(i=>i.expense_association?.mode==='auto').length,
      confirmed:new Set(associated.map(i=>i.source_voucher_id||i.id)).size},
    candidate_only:true,human_confirmation_required:false,formal_ledger_written:false};
}

export function expenseMatchPlan(workspace,requests,mode) {
  if(!['auto','manual'].includes(mode)||!Array.isArray(requests)||requests.length<1||requests.length>20)throw Error('凭证匹配请求无效');
  const result=[],seen=new Set();
  for(const request of requests){
    const item=workspace.items.find(i=>(i.source_voucher_id||i.id)===request.voucher_id && (i.component_index||0)===request.component_index);
    if(!item || item.latest_ocr_task?.id!==request.task_id || item.confirmed_target_id || item.expense_association)continue;
    if(['bank_summary','multiple_transactions'].includes(item.candidate_fields?.document_kind))throw Error('请先逐笔识别多笔凭证，不能把整张汇总强行对应一笔');
    const target=workspace.targets.find(t=>t.id===request.target_id&&t.target_kind===request.target_kind);
    if(!target)throw Error('对应明细或原件已变化，请刷新');
    if(mode==='auto'&&(!item.match?.auto_eligible||item.match.target_id!==target.id||item.match.target_kind!==target.target_kind))continue;
    const fields=mode==='auto'?item.candidate_fields:request.corrected_fields;
    const monthlySummary=item.candidate_fields?.evidence_kind==='monthly_summary';
    if(!fields||!Number.isFinite(Number(fields.amount))||!(Number(fields.amount)>0)||Math.abs(Number(fields.amount)*100-Math.round(Number(fields.amount)*100))>1e-6)throw Error('请核对凭证金额和所属月份');
    if(monthlySummary){
      if(target.target_kind!=='monthly_source'||fields.period_month!==workspace.month)throw Error('月度汇总佐证只能对应同月份的月报开支栏目');
    }else{
      if(!/^\d{4}-\d{2}-\d{2}$/.test(fields.document_date)||fields.document_date.slice(0,7)!==workspace.month)throw Error('请核对凭证日期和所属月份');
      const day=new Date(fields.document_date+'T00:00:00Z');if(!Number.isFinite(+day)||day.toISOString().slice(0,10)!==fields.document_date)throw Error('凭证日期无效');
    }
    const key=request.voucher_id+':'+request.component_index;if(seen.has(key))throw Error('凭证分项重复');seen.add(key);
    result.push({voucher_id:request.voucher_id,component_index:request.component_index,task_id:request.task_id,
      target_kind:target.target_kind,target_id:target.id,target_snapshot:target,
      corrected_fields:{evidence_kind:monthlySummary?'monthly_summary':'transaction',period_month:monthlySummary?fields.period_month:fields.document_date.slice(0,7),document_date:monthlySummary?null:fields.document_date,amount:Number(fields.amount),counterparty:String(fields.counterparty||'').slice(0,200),
        document_number:String(fields.document_number||'').slice(0,120),summary:String(fields.summary||'').slice(0,300),expense_category:String(fields.expense_category||'').slice(0,120)},
      reason:mode==='auto'?item.match.reason:String(request.reason||'人工核对对应开支凭证').slice(0,500)});
  }
  return result;
}
