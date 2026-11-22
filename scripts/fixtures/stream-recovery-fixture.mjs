/** Synthetic opaque payload for envelope/scale tests, NOT a valid large PG
 * archive or real media. Actual DB restoration uses the separate PG fixture. */
import {mkdir,open,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
export async function createStreamRecoverySnapshot(root,{databaseBytes=2097165,objects=2,objectBytes=1024}={}){
 await mkdir(root,{mode:0o700});for(const n of ['objects','secrets'])await mkdir(join(root,n),{mode:0o700});const expected=[];
 async function payload(path,size,prefix){const h=await open(join(root,path),'wx',0o600),b=Buffer.alloc(Math.min(size,1048576),90),digest=createHash('sha256');let pos=0;
  try{while(pos<size){b.fill(90);if(pos===0)b.write(prefix);const part=b.subarray(0,Math.min(size-pos,b.length));digest.update(part);await h.writeFile(part);pos+=part.length;}await h.sync();expected.push({path,byteLength:size,sha256:digest.digest('hex')});}finally{b.fill(0);await h.close();}
 }
 await payload('database.dump',databaseBytes,'PGDMP');
 for(let i=0;i<objects;i++)await payload('objects/'+i.toString(16).padStart(64,'0')+'.object',objectBytes,'DPO1');
 const roles=Buffer.from('-- Synthetic role snapshot; never executed in this fixture.\n'),master=Buffer.alloc(32,9);for(const [path,b] of [['roles.sql',roles],['secrets/master-key.bin',master]]){await writeFile(join(root,path),b,{mode:0o600});expected.push({path,byteLength:b.length,sha256:createHash('sha256').update(b).digest('hex')});}master.fill(0);
 return expected.sort((a,b)=>a.path<b.path?-1:1);
}
