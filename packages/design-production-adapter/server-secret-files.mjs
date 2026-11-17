/** Node server only. No environment lookup, default secret, browser route or logging.
 * Provision the directory outside the source/release tree. Reading a secret does
 * not enable routes, issue approvals or configure a model. No hot key rotation. */
import {open,realpath,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';
const fail=()=>{throw new Error('DESIGN_SERVER_SECRET_UNAVAILABLE');};
export function createDesignFileSecretProvider({enabled=false,directory,name='master-key.bin'}={}){
 return async ({purpose}={})=>{
  let file,bytes;
  try{
   if(enabled!==true||!['design-employee-key-v1','design-immutable-key-v2','design-private-object-v1'].includes(purpose)||
      typeof directory!=='string'||!isAbsolute(directory)||resolve(directory)!==directory||
      !/^[a-z][a-z0-9-]{0,63}\.bin$/.test(name)||typeof process.getuid!=='function')fail();
   // Reject symlinks anywhere in the configured directory. The protected parent
   // must not be shared with an untrusted writer; same-UID compromise is outside
   // this file boundary. O_NONBLOCK avoids hanging on a substituted FIFO.
   if(await realpath(directory)!==directory)fail();
   const dir=await lstat(directory);
   if(!dir.isDirectory()||dir.uid!==process.getuid()||(dir.mode&0o777)!==0o700)fail();
   file=await open(join(directory,name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   const st=await file.stat();
   if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid()||(st.mode&0o777)!==0o600||st.size!==32)fail();
   bytes=Buffer.alloc(33);let total=0;
   while(total<33){const r=await file.read(bytes,total,33-total,null);if(!r.bytesRead)break;total+=r.bytesRead;}
   const after=await file.stat();
   if(total!==32||after.size!==32||after.mtimeMs!==st.mtimeMs||after.ctimeMs!==st.ctimeMs)fail();
   return Uint8Array.from(bytes.subarray(0,32));
  }catch{fail();}finally{bytes?.fill(0);await file?.close().catch(()=>{});}
 };
}
