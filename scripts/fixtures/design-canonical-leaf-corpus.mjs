// Synthetic JSON text, not real records. Feed raw strings to $1::jsonb to preserve
// numeric lexemes. Compare independently renamed OLD recursive function vs NEW:
// accepted UTF-8 bytes and sha256 exactly; rejected SQLSTATE AND fixed category.
// null input below means SQL NULL, distinct from JSON text "null".
export const canonicalLeafCorpus = Object.freeze([
 ['empty-object','{}',true],['empty-array','[]',true],['json-null','null',true],
 ['true','true',true],['false','false',true],['empty-string','""',true],
 ['unicode-value','"顾客🙂é"',true],['escapes','"quote\\\" slash\\\\ tab\\t newline\\n"',true],
 ['key-sort','{"z":0,"A":1,"a":2," ":3,"~":4,"":5}',true],
 ['escaped-ascii-key','{"quote\\\"":1,"back\\\\":2}',true],
 ['nested-mixed','{"a":[null,true,false,"顾客",1.5,{},[],{"b":[-0,1e-6]}],"z":0}',true],
 ['zero','0',true],['negative-zero','-0.0000',true],['scaled-decimal','1.5000',true],
 ['positive-bound','9007199254740991',true],['negative-bound','-9007199254740991',true],
 ['minimum-positive','0.000001',true],['minimum-negative','-0.000001',true],
 ['safe-exponent','1e6',true],['scaled-exponent','1.5000e2',true],
 ['positive-overflow','9007199254740992',false,'P0001','DEPENDENCY_AUTHORITY_CANONICAL_UNSUPPORTED'],
 ['negative-overflow','-9007199254740992',false,'P0001','DEPENDENCY_AUTHORITY_CANONICAL_UNSUPPORTED'],
 ['tiny-positive','1e-7',false,'P0001','DEPENDENCY_AUTHORITY_CANONICAL_UNSUPPORTED'],
 ['tiny-negative','-1e-7',false,'P0001','DEPENDENCY_AUTHORITY_CANONICAL_UNSUPPORTED'],
 ['nested-tiny','{"a":[{"b":0.0000009}]}',false,'P0001','DEPENDENCY_AUTHORITY_CANONICAL_UNSUPPORTED'],
 ['nested-overflow','[{"a":[9007199254740992]}]',false,'P0001','DEPENDENCY_AUTHORITY_CANONICAL_UNSUPPORTED'],
 ['nonascii-key','{"顾客":1}',false,'P0001','DEPENDENCY_AUTHORITY_CANONICAL_UNSUPPORTED'],
 ['nested-nonascii-key','{"a":[{"é":null}]}',false,'P0001','DEPENDENCY_AUTHORITY_CANONICAL_UNSUPPORTED'],
 ['control-key','{"\\t":1}',false,'P0001','DEPENDENCY_AUTHORITY_CANONICAL_UNSUPPORTED'],
 ['sql-null',null,false,'P0001','DEPENDENCY_AUTHORITY_INVALID'],
 // These fail at the jsonb type boundary, before either canonical function.
 ['invalid-nan','NaN',false,'22P02','jsonb_parse'],
 ['invalid-infinity','Infinity',false,'22P02','jsonb_parse'],
 ['invalid-undefined','undefined',false,'22P02','jsonb_parse'],
 ['invalid-object','[object Object]',false,'22P02','jsonb_parse'],
 ['nested-containers','['.repeat(30)+'{"value":[1.5,"顾客",true,null] }'+']'.repeat(30),true],
 ['wide-primitive-array',JSON.stringify(Array.from({length:200},(_,i)=>[i,`synthetic-${i}`,null,i%2===0]).flat()),true],
].map(([name,json,accept,sqlState=null,category=null])=>Object.freeze({name,json,accept,sqlState,category})));
