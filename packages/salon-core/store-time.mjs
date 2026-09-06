// Pure minute-precision appointment conversion. No device-zone fallback or business writes.
export class StoreTimeError extends Error {
 constructor(code,message){super(message);this.name='StoreTimeError';this.code=code;}
}
const fail=(code,message)=>{throw new StoreTimeError(code,message);};
function formatter(zone){
 if(typeof zone!=='string'||!zone||zone!==zone.trim()||zone.length>100||/^[+-]/.test(zone))fail('INVALID_TIME_ZONE','缺少或无效的门店时区，请重新读取门店配置');
 try{return new Intl.DateTimeFormat('en-CA',{timeZone:zone,calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});}
 catch{fail('INVALID_TIME_ZONE','当前环境不支持该门店时区，禁止使用设备时区代替');}
}
function parts(ms,fmt){const p={};for(const item of fmt.formatToParts(ms))if(item.type!=='literal')p[item.type]=item.value;return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;}
function wallMillis(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))fail('INVALID_LOCAL_TIME','请输入完整的门店日期和时间（精确到分钟）');
 const year=Number(value.slice(0,4));
 if(year<2000||year>2100)fail('UNSUPPORTED_DATE_RANGE','预约日期支持 2000 至 2100 年，不用于历史账务时间转换');
 const ms=Date.parse(value+':00Z');
 if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,16)!==value)fail('INVALID_LOCAL_TIME','日期或时间不存在，请检查月份、日期和小时');
 return ms;
}
function instantMillis(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value))fail('INVALID_INSTANT','接口时间必须含明确时区，不能按设备时间解析');
 wallMillis(value.slice(0,16));
 if(Number(value.slice(17,19))>59||!Number.isFinite(Date.parse(value)))fail('INVALID_INSTANT','接口时间无效');
 return Date.parse(value);
}
export function instantToStoreInput(instant,timeZone){return parts(instantMillis(instant),formatter(timeZone)).slice(0,16);}
export function formatStoreInstant(instant,timeZone){
 const ms=instantMillis(instant),local=parts(ms,formatter(timeZone));
 const offset=Math.round((Date.parse(local+'Z')-Math.floor(ms/1000)*1000)/60000),absolute=Math.abs(offset);
 const label=`UTC${offset<0?'-':'+'}${String(Math.floor(absolute/60)).padStart(2,'0')}:${String(absolute%60).padStart(2,'0')}`;
 return `${local.replace('T',' ')} (${timeZone}, ${label})`;
}
export function resolveStoreTime(localTime,timeZone){
 const wall=wallMillis(localTime),fmt=formatter(timeZone),matches=[];
 // Exhaust all minute-aligned offsets within ±24h. For the supported modern date
 // range this handles full-day date-line jumps, half-hour DST and 45-minute zones,
 // without assuming every DST transition is one hour or choosing one fold silently.
 for(let offset=-1440;offset<=1440;offset++){
  const candidate=wall+offset*60000;
  if(parts(candidate,fmt)===localTime+':00')matches.push(new Date(candidate).toISOString());
 }
 return Object.freeze({status:matches.length===0?'nonexistent':matches.length===1?'unique':'ambiguous',instants:Object.freeze(matches),timeZone,localTime});
}
export function storeTimeToInstant(localTime,timeZone){
 const result=resolveStoreTime(localTime,timeZone);
 if(result.status==='nonexistent')fail('NONEXISTENT_LOCAL_TIME','该门店时间因时钟调整不存在，请选择其他时间');
 if(result.status==='ambiguous')fail('AMBIGUOUS_LOCAL_TIME','该门店时间重复出现，不能自动选择，请换一个明确时间或由门店核实');
 return result.instants[0];
}
