// Select only a complete calendar date quoted in the model's printed evidence.
// Roles describe that evidence, never an inferred accounting or debit date.
export function printedVoucherDate(result, normalize) {
  const rows=[...(Array.isArray(result.date_candidates)?result.date_candidates:[]),
    {date:result.fields?.document_date,role:result.date_role,evidence:result.evidence?.document_date,confidence:result.confidences?.document_date}];
  const priority={payment:0,invoice:1,receipt:2,order:3,completion:4};
  const valid=[];
  for(const row of rows){
    const proof=String(row?.evidence||'').trim(),date=normalize(row?.date),score=row?.confidence;
    const printed=proof.match(/(?<!\d)(20\d{2})[-年/.](\d{1,2})[-月/.](\d{1,2})(?:日|(?=\D|$))/);
    if(!date||!printed||normalize(printed[1]+'-'+printed[2].padStart(2,'0')+'-'+printed[3].padStart(2,'0'))!==date||typeof score!=='number'||!Number.isFinite(score)||score<.85||score>1)continue;
    let role=row.role;
    if(/发货|配送|送达|签收/.test(proof))role='unknown';
    else if(/成交|完成时间|完成日期/.test(proof))role='completion';
    else if(/下单|拼单|订单时间|订单日期/.test(proof))role='order';
    else if(/创建时间|创建日期/.test(proof))role=result.document_type==='order'||row.role==='order'||/订单信息/.test(result.evidence?.document_number||'')?'order':'receipt';
    else if(/开票|发票日期/.test(proof))role='invoice';
    else if(/收据日期|开具日期/.test(proof))role='receipt';
    else if(/付款时间|付款日期|支付时间|支付日期|转账时间|转账日期|扣款时间|扣款日期|交易时间|交易日期|收款时间/.test(proof))role='payment';
    if(!(role in priority))continue;
    valid.push({date,role,evidence:proof,confidence:score});
  }
  valid.sort((a,b)=>priority[a.role]-priority[b.role]||b.confidence-a.confidence);
  const best=valid[0];
  if(!best)return null;
  if(valid.some(row=>priority[row.role]===priority[best.role]&&row.date!==best.date))return null;
  return best;
}
