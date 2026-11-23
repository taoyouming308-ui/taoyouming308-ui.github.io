/* Shared by the read-only Edge adapters and the browser. No DB, storage or auth here. */
(function (g) {
  'use strict';
  const MAX = 1024 * 1024, BLOCKS = 384, digestPattern = /^[0-9a-f]{64}$/;
  const bytes = new TextEncoder();
  async function digest(s) {
    const d = new Uint8Array(await g.crypto.subtle.digest('SHA-256', bytes.encode(s)));
    return Array.from(d, b => b.toString(16).padStart(2,'0')).join('');
  }
  // Prefer stable JSON record boundaries, so an insertion does not shift every
  // following block. Strings (including embedded JSON) are never parsed as fields.
  function split(s) {
    const parts=[]; let start=0, quoted=false, escape=false;
    for(let i=0;i<s.length;i++) {
      const c=s[i];
      if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;}
      else if(c==='"')quoted=true;
      const n=i-start+1;
      if((n>=512&&!quoted&&(c==='}'||c===']')) ||
         (n>=8192 && !(s.charCodeAt(i)>=0xd800 && s.charCodeAt(i)<=0xdbff))){
        parts.push(s.slice(start,i+1));start=i+1;
      }
    }
    if(start<s.length) parts.push(s.slice(start));
    return parts;
  }
  async function describe(text) {
    if(typeof text!=='string'||!text.length||text.length>MAX)return null;
    const rev=await digest(text), parts=split(text);
    if(parts.length>BLOCKS)return {rev,parts:[],ids:[]};
    const ids=[];for(let i=0;i<parts.length;i+=16)ids.push(...await Promise.all(parts.slice(i,i+16).map(digest)));
    return {rev,parts,ids};
  }
  async function encode(hint,data) {
    if(!hint||hint.v!==1||typeof hint.rev!=='string'||!digestPattern.test(hint.rev)||
       !Array.isArray(hint.ids)||hint.ids.length>BLOCKS||!hint.ids.every(x=>typeof x==='string'&&digestPattern.test(x)))return data;
    const text=JSON.stringify(data);if(!text||text.length>MAX)return data;
    const rev=await digest(text);
    if(rev===hint.rev)return {__zysyr_read:1,base:rev,rev};
    if(!hint.ids.length)return data;
    const parts=split(text);if(parts.length>BLOCKS)return data;
    const old=new Map(hint.ids.map((x,i)=>[x,i])), patch=[];
    for(let i=0;i<parts.length;i+=16){
      const ids=await Promise.all(parts.slice(i,i+16).map(digest));
      ids.forEach((id,j)=>patch.push(old.has(id)?old.get(id):parts[i+j]));
    }
    const out={__zysyr_read:1,base:hint.rev,rev,patch};
    return JSON.stringify(out).length<text.length ? out : data;
  }
  async function decode(reply,prior) {
    if(!reply||reply.__zysyr_read!==1)return reply;
    if(!prior||reply.base!==prior.spec.rev||!digestPattern.test(reply.rev))throw Error('同步基线无效');
    if(!Object.hasOwn(reply,'patch')){
      if(reply.rev!==reply.base)throw Error('同步版本不一致');
      return JSON.parse(prior.text);
    }
    if(!Array.isArray(reply.patch)||reply.patch.length>BLOCKS)throw Error('同步格式无效');
    let size=0;
    const text=reply.patch.map(p=>{
      const s=typeof p==='string'?p:Number.isInteger(p)&&p>=0?prior.spec.parts[p]:null;
      if(typeof s!=='string'||(size+=s.length)>MAX)throw Error('同步片段无效');return s;
    }).join('');
    if(await digest(text)!==reply.rev)throw Error('同步内容校验失败');
    return JSON.parse(text);
  }
  g.ZysyrReadCodec=Object.freeze({digest,describe,encode,decode,MAX});
})(globalThis);
