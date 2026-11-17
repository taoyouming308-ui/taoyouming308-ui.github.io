/** Admin-only disposable fixture comparison. Never loaded by production/runtime. */
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {canonicalLeafCorpus} from './design-canonical-leaf-corpus.mjs';
const quote=s=>`'${s.replaceAll("'","''")}'`;
export function canonicalEquivalenceCorpus(){
 let state=0x547731;const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
 const leaf=()=>[null,true,false,next()%100000,((next()%2000000)-1000000)/1000,'顾客🙂\n"\\'+(next()%99)][next()%6];
 const build=depth=>{if(depth===0||next()%3===0)return leaf();if(next()%2)return Array.from({length:next()%6},()=>build(depth-1));const out={};for(let i=0,n=next()%6;i<n;i++)out[String.fromCharCode(32+(next()%95))+'_'+i]=build(depth-1);return out;};
 return [...canonicalLeafCorpus,...Array.from({length:600},(_,i)=>({name:'deterministic-'+i,json:JSON.stringify(build(4)),accept:true,sqlState:null,category:null}))];
}
export function installCanonicalLeafWithEquivalence(f){
 const corpus=canonicalEquivalenceCorpus(),source=readFileSync(new URL('../../packages/design-production-adapter/drafts/stage20-canonical-leaf-fixture.sql',import.meta.url),'utf8');
 const out=f.sqlAdmin(`BEGIN;
 CREATE TEMP TABLE stage20_canonical_comparison_marker(value boolean) ON COMMIT DROP;
 DO $baseline$ DECLARE definition text;BEGIN
  SELECT pg_get_functiondef('design_dependency_authority.canonical(jsonb)'::regprocedure) INTO definition;
  definition:=replace(definition,'design_dependency_authority.canonical','pg_temp.stage20_original_canonical');
  EXECUTE definition;
 END$baseline$;
 ${source}
 DO $equivalence$ DECLARE item jsonb;original text;optimized text;old_code text;new_code text;old_category text;new_category text;accepted integer:=0;rejected integer:=0;BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(${quote(JSON.stringify(corpus))}::jsonb) LOOP
   original:=NULL;optimized:=NULL;old_code:=NULL;new_code:=NULL;old_category:=NULL;new_category:=NULL;
   BEGIN EXECUTE 'SELECT pg_temp.stage20_original_canonical($1::jsonb)' INTO original USING item->>'json';EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS old_code=RETURNED_SQLSTATE,old_category=MESSAGE_TEXT;END;
   BEGIN EXECUTE 'SELECT design_dependency_authority.canonical($1::jsonb)' INTO optimized USING item->>'json';EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS new_code=RETURNED_SQLSTATE,new_category=MESSAGE_TEXT;END;
   IF (item->>'accept')::boolean THEN
    IF old_code IS NOT NULL OR new_code IS NOT NULL OR convert_to(original,'UTF8') IS DISTINCT FROM convert_to(optimized,'UTF8') OR sha256(convert_to(original,'UTF8')) IS DISTINCT FROM sha256(convert_to(optimized,'UTF8')) THEN RAISE EXCEPTION 'SYNTHETIC_CANONICAL_BYTES_MISMATCH';END IF;accepted:=accepted+1;
   ELSE
    IF old_code IS DISTINCT FROM item->>'sqlState' OR new_code IS DISTINCT FROM old_code OR (item->>'category'<>'jsonb_parse' AND (old_category IS DISTINCT FROM item->>'category' OR new_category IS DISTINCT FROM old_category)) THEN RAISE EXCEPTION 'SYNTHETIC_CANONICAL_REJECTION_MISMATCH';END IF;rejected:=rejected+1;
   END IF;
  END LOOP;
  IF accepted<>${corpus.filter(x=>x.accept).length} OR rejected<>${corpus.filter(x=>!x.accept).length} THEN RAISE EXCEPTION 'SYNTHETIC_CANONICAL_COUNT_MISMATCH';END IF;
 END$equivalence$;
 COMMIT;
 SELECT 'canonical-leaf-equivalence-ok';`);
 assert.equal(out.split('\n').at(-1),'canonical-leaf-equivalence-ok');
 return Object.freeze({cases:corpus.length,accepted:corpus.filter(x=>x.accept).length,rejected:corpus.filter(x=>!x.accept).length,bytesAndSHA256Equal:true,originalOwnerAndACLUnchanged:true});
}
