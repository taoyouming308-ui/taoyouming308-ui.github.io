'use strict';
// Wire these browser globals from the actual entry, not an implicit always-on stub.
module.exports = function configure(tab, html) {
  const mode=/<html\b[^>]*\bdata-read-sync-rollout="([^"]+)"/.exec(html)?.[1];
  if(!mode)throw Error('Entry missing read rollout setting');
  const storage=new Map();
  tab.document ||= {};
  tab.document.documentElement ||= {};
  const el=tab.document.documentElement,old=el.getAttribute?.bind(el);
  el.getAttribute=k=>k==='data-read-sync-rollout'?mode:old?.(k)??null;
  Object.assign(tab,{URLSearchParams,location:{search:''},sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
};
