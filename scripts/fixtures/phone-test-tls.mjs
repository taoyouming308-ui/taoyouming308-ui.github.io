/** Ephemeral synthetic CA/certificates. Never changes system trust or emits keys. */
import {execFileSync} from 'node:child_process';
import {mkdtemp,chmod,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';import {X509Certificate} from 'node:crypto';
export async function createPhoneTestTls(root){
 const dir=await mkdtemp(join(root,'fixture-tls-'));await chmod(dir,0o700);
 const cmd=args=>execFileSync(process.platform==='darwin'?'/opt/homebrew/bin/openssl':'/usr/bin/openssl',args,{cwd:dir,stdio:'ignore',timeout:10000,env:{PATH:'/usr/bin:/bin'}});
 try{
  cmd(['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-days','1','-subj','/CN=Design Synthetic Only CA','-keyout','ca.key','-out','ca.crt']);
  const ca=await readFile(join(dir,'ca.crt')),pairs={};
  for(const name of ['server','client','other']){
   await writeFile(join(dir,name+'.ext'),(name==='server'?'subjectAltName=IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth':'extendedKeyUsage=clientAuth')+'\nbasicConstraints=CA:FALSE\n',{mode:0o600});
   cmd(['req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-subj','/CN=Design Synthetic '+name,'-keyout',name+'.key','-out',name+'.csr']);
   cmd(['x509','-req','-in',name+'.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','1','-extfile',name+'.ext','-out',name+'.crt']);await chmod(join(dir,name+'.key'),0o600);
   const cert=await readFile(join(dir,name+'.crt')),key=await readFile(join(dir,name+'.key'));pairs[name]={cert,key,ca,fingerprint:new X509Certificate(cert).fingerprint256};
  }
  await chmod(join(dir,'ca.key'),0o600);
  return {...pairs,async cleanup(){for(const p of Object.values(pairs))p.key.fill(0);await rm(dir,{recursive:true,force:true});}};
 }catch(e){await rm(dir,{recursive:true,force:true});throw e;}
}
