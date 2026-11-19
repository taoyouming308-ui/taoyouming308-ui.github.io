#!/usr/bin/env python3
"""Narrow Stage33 synthetic decoder tolerance/provenance experiment, NOT a
production verifier. Exact reconstruction is tested only for this pinned local
producer; no claim of arbitrary JPEG/VP8 compressed-stream full consumption.
"""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import uuid
spec=importlib.util.spec_from_file_location('stage31',Path(__file__).with_name('test-design-imgproxy-real-local.py'))
old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
BASE=old.BASE.parent/'stage33'
def main():
 assert sys.argv[1:]==['--run-isolated']
 BASE.mkdir(exist_ok=True);out=BASE/('parent-'+time.strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:8]);out.mkdir(mode=0o700);src=out/'synthetic-inputs';src.mkdir(mode=0o755)
 created=[];events=[]
 def log(event,**fields):
  r={'event':event,**fields};events.append(r);print(json.dumps(r),flush=True)
 log('begin',evidence=str(out),productionQualified=False)
 try:
  evidence=Path(json.loads((old.BASE/'imgproxy-format-diagnostic1.log').read_text().splitlines()[0])['evidence']);assert evidence.parent==old.BASE
  (src/'source.jpg').write_bytes((evidence/'synthetic-inputs'/'orientation-6.jpg').read_bytes())
  parents={fmt:(evidence/f'diagnostic.{fmt}').read_bytes() for fmt in ('jpg','webp')}
  cases=[]
  for fmt,b in parents.items():
   (src/f'parent.{fmt}').write_bytes(b);cases.append((f'parent.{fmt}',True))
   (src/f'trailing.{fmt}').write_bytes(b+b'<script>synthetic</script>');cases.append((f'trailing.{fmt}',False))
   if fmt=='jpg':bad=b[:-2]+b'A'*16+b[-2:]
   else:
    p=12
    while b[p:p+4]!=b'VP8 ':n=int.from_bytes(b[p+4:p+8],'little');p+=8+n+n%2
    n=int.from_bytes(b[p+4:p+8],'little');end=p+8+n+n%2
    bad=bytearray(b[:end]+b'A'*16+b[end:]);bad[4:8]=(len(bad)-8).to_bytes(4,'little');bad[p+4:p+8]=(n+16).to_bytes(4,'little');bad=bytes(bad)
   (src/f'internal-tail.{fmt}').write_bytes(bad);cases.append((f'internal-tail.{fmt}',True))
  for p in src.iterdir():p.chmod(0o444)
  module=(Path(__file__).resolve().parent.parent/'packages/design-production-adapter/parent-image-validation.mjs').as_uri()
  checkjs="""import{readFileSync}from'node:fs';const{validateParentImageContainer:v}=await import(process.argv[1]);try{const r=v(readFileSync(process.argv[2]),{mime:process.argv[3],width:80,height:120,maximumBytes:262144});process.stdout.write(JSON.stringify({envelope:true,fullyConsumed:r.fullyConsumed,qualified:r.qualified}));}catch{process.stdout.write(JSON.stringify({envelope:false,qualified:false}));}"""
  for file,expected in cases:
   mime='image/jpeg' if file.endswith('jpg') else 'image/webp'
   result=json.loads(old.run(['node','--input-type=module','-e',checkjs,module,str(src/file),mime]));assert result['envelope']==expected and result['qualified'] is False
   log('container_gate',case=file,**result)
  name='design-parent-'+uuid.uuid4().hex[:12]
  security=['--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=64','--cpus=1','--memory=256m','--memory-swap=256m','--user=999:999','--tmpfs=/tmp:rw,noexec,nosuid,size=32m,mode=1777']
  env={'IMGPROXY_BIND':'127.0.0.1:8080','IMGPROXY_LOCAL_FILESYSTEM_ROOT':'/input','IMGPROXY_ALLOWED_SOURCES':','.join('local:///'+p.name for p in sorted(src.iterdir())),'IMGPROXY_MAX_SRC_RESOLUTION':'40','IMGPROXY_MAX_SRC_FILE_SIZE':str(8*1024*1024),'IMGPROXY_AUTO_ROTATE':'true','IMGPROXY_STRIP_METADATA':'true','IMGPROXY_KEEP_COPYRIGHT':'false','IMGPROXY_STRIP_COLOR_PROFILE':'true','IMGPROXY_CONCURRENCY':'1','IMGPROXY_MAX_CLIENTS':'4','IMGPROXY_READ_TIMEOUT':'5','IMGPROXY_WRITE_TIMEOUT':'10','IMGPROXY_DOWNLOAD_TIMEOUT':'3'}
  for image in (old.IMG,old.NODE):
   d=json.loads(old.run(['docker','image','inspect',image]))[0];assert image in d['RepoDigests'] and d['Architecture']=='arm64';log('image',digest=image,platform='linux/arm64')
  args=['docker','run','--pull=never','--detach','--name',name,'--network=none',*security,'--mount',f'type=bind,src={src},dst=/input,readonly']
  for k,v in env.items():args+=['-e',k+'='+v]
  created.append(name);old.run(args+[old.IMG]);d=old.inspect(name);h=d['HostConfig']
  assert h['NetworkMode']=='none' and not h['PortBindings'] and h['ReadonlyRootfs'] and h['Memory']==268435456 and h['PidsLimit']==64 and h['NanoCpus']==1000000000 and 'ALL' in h['CapDrop'] and 'no-new-privileges' in h['SecurityOpt'] and all(not m['RW'] for m in d['Mounts'])
  log('isolation',network='none',uid=999,memory=h['Memory'],pids=h['PidsLimit'],nanoCpus=h['NanoCpus'],readonly=True,noPorts=True)
  js="""const os=require('node:os'),fs=require('node:fs'),http=require('node:http');if(Object.values(os.networkInterfaces()).flat().some(x=>!x.internal)||fs.readFileSync('/proc/net/route','utf8').split('\\n').slice(1).some(x=>x.trim()&&!x.startsWith('lo\\t')))throw Error('network-isolation');const r=http.get({host:'127.0.0.1',port:8080,path:process.argv[1],timeout:12000},s=>{let n=0,a=[];s.on('data',b=>{n+=b.length;if(n>2097152)r.destroy(Error('limit'));else a.push(b)});s.on('end',()=>process.stdout.write(JSON.stringify({status:s.statusCode,body:Buffer.concat(a).toString('base64')})))});r.on('timeout',()=>r.destroy(Error('timeout')));r.on('error',()=>{process.exitCode=2});"""
  def request(path):
   helper='design-parent-client-'+uuid.uuid4().hex[:12];created.append(helper)
   r=json.loads(old.run(['docker','run','--pull=never','--rm','--name',helper,'--network',f'container:{name}',*security,'--entrypoint','node',old.NODE,'-e',js,path],timeout=25));created.remove(helper);return r['status'],base64.b64decode(r['body'])
  time.sleep(1);status,_=request('/health');assert status==200
  # Rejected grammar is deliberately probed ONLY in this isolated synthetic
  # experiment, never passed as a qualified input to normalization/consumer.
  for file,_ in cases:
   status,b=request(f'/insecure/rs:fit:1024:1024:0/plain/local:///{file}@png')
   if status==200:(out/(file+'.decoder.png')).write_bytes(b)
   p=subprocess.run([old.MAGICK,'-limit','memory','128MiB','-limit','map','128MiB','-limit','disk','0','-regard-warnings',str(src/file),'-depth','8','rgb:-'],capture_output=True,timeout=15)
   warning=p.stderr.decode(errors='replace')
   log('decoder_tolerance',case=file,imgproxyStatus=status,independentWarningsAsErrorsExit=p.returncode,pixelBytes=len(p.stdout),warningPresent=bool(warning.strip()),fullyConsumedProven=False,qualified=False)
   (out/(file+'.independent-warning.txt')).write_text(warning[:2000])
  # Same source + pinned producer + explicit transform. Equality is not a proof
  # about arbitrary online providers or arbitrary decoder bitstream consumption.
  for fmt,parent in parents.items():
   for iteration in (1,2):
    status,b=request(f'/insecure/rs:fit:1024:1024:0/plain/local:///source.jpg@{fmt}');assert status==200
    (out/f'rebuilt-{iteration}.{fmt}').write_bytes(b)
    log('producer_reconstruction',format=fmt,iteration=iteration,exactParentEquality=b==parent,sourceSha256=hashlib.sha256((src/'source.jpg').read_bytes()).hexdigest(),parentSha256=hashlib.sha256(parent).hexdigest(),rebuiltSha256=hashlib.sha256(b).hexdigest(),unknownOnlineProducerQualified=False)
    assert b==parent,'pinned producer not byte-reproducible'
    assert b!=(src/f'internal-tail.{fmt}').read_bytes() and b!=(src/f'trailing.{fmt}').read_bytes()
  log('experiment_complete',arbitraryCompressedConsumptionProven=False,productionQualified=False)
 finally:
  failed=[]
  for name in reversed(created[:]):
   if name.startswith('design-parent-') and not name.startswith('design-parent-client-'):
    p=subprocess.run(['docker','logs',name],capture_output=True,timeout=10);(out/'imgproxy.log').write_bytes(p.stdout+p.stderr)
   p=subprocess.run(['docker','rm','-f',name],capture_output=True,timeout=20)
   if p.returncode and b'No such container' not in p.stderr:failed.append(name)
  log('cleanup',remainingExactContainers=failed);(out/'events.json').write_text(json.dumps(events,indent=2));assert not failed
if __name__=='__main__':main()
