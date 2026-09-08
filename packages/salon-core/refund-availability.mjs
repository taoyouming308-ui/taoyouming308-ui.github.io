import {serverId} from './api-client.mjs';
import {cashRefundSource} from './refund-request.mjs';
const fail=()=>{throw Error('退款已执行、在途占用或剩余额度核对不一致，请人工核对');};
function units(value,digits){if(typeof value!=='string'||!new RegExp(`^\\d{1,${digits===2?10:9}}\\.\\d{${digits}}$`).test(value))fail();return Number(value.replace('.',''));}
function balance(row,original,suffix,digits){const done=units(row['executed'+suffix],digits),pending=units(row['pending'+suffix],digits),available=units(row['available'+suffix],digits);if(done+pending+available!==units(original,digits))fail();return {done,pending,available};}
export function cashRefundAvailability(data,id,scope){
 const source=cashRefundSource(data,id,scope),total=balance(source,source.amount,'Amount',2);let done=0,pending=0,available=0;
 for(const row of source.lines){balance(row,row.quantity,'Quantity',3);const part=balance(row,row.amount,'Amount',2);done+=part.done;pending+=part.pending;available+=part.available;}
 if(done!==total.done||pending!==total.pending||available!==total.available||!Array.isArray(source.reservations)||source.reservations.length>500)fail();
 const ids=new Set();let rd=0,rp=0;
 for(const row of source.reservations){const key=serverId(row.id),amount=units(row.amount,2);if(ids.has(key)||!['submitted','approved','executed'].includes(row.status)||amount<=0)fail();ids.add(key);if(row.status==='executed')rd+=amount;else rp+=amount;}
 if(rd!==done||rp!==pending)fail();return source;
}
