#!/usr/bin/env python3
"""Local synthetic second-generation PNG normalization, never production approval.
Requires pre-existing Stage31 evidence and pinned installed images. No downloads.
Original derivative bytes/version remain unchanged; outputs are NEW artifacts.
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import uuid
import base64
import hashlib
import struct

spec=importlib.util.spec_from_file_location('stage31',Path(__file__).with_name('test-design-imgproxy-real-local.py'))
old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
BASE=old.BASE.parent/'stage32'
HASH=lambda x:hashlib.sha256(x).hexdigest()

def inspect_png(data):
    assert data[:8]==b'\x89PNG\r\n\x1a\n'
    assert old.metadata(data)==[]  # verifies each CRC and bounded chunk framing
    pos=8; chunks=[]; idat_ended=False
    while pos<len(data):
        n=struct.unpack_from('>I',data,pos)[0];kind=data[pos+4:pos+8]
        assert kind in (b'IHDR',b'pHYs',b'IDAT',b'IEND'),kind
        assert not idat_ended or kind!=b'IDAT'
        if b'IDAT' in chunks and kind!=b'IDAT':idat_ended=True
        if kind==b'IHDR':assert pos==8 and n==13
        if kind==b'pHYs':assert n==9 and b'pHYs' not in chunks and b'IDAT' not in chunks
        if kind==b'IEND':assert n==0 and pos+12==len(data)
        chunks.append(kind);pos+=12+n
    assert chunks[0]==b'IHDR' and chunks[-1]==b'IEND' and b'IDAT' in chunks
    return [c.decode() for c in chunks]

def main():
    assert sys.argv[1:]==['--run-isolated']
    BASE.mkdir(parents=True,exist_ok=True)
    out=BASE/('normalization-'+time.strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:8]);out.mkdir(mode=0o700)
    src=out/'synthetic-inputs';src.mkdir(mode=0o755)
    created=[];events=[]
    def log(event,**fields):
        row={'event':event,**fields};events.append(row);print(json.dumps(row),flush=True)
    log('begin',evidence=str(out),productionEnabled=False)
    try:
        # Only these known synthetic artifacts; no search of customer files.
        runlog=old.BASE/'imgproxy-format-diagnostic1.log'
        evidence=Path(json.loads(runlog.read_text().splitlines()[0])['evidence'])
        assert evidence.parent==old.BASE and evidence.name.startswith('imgproxy-')
        for fmt in ('jpg','webp'):
            parent=(evidence/f'diagnostic.{fmt}').read_bytes()
            assert old.metadata(parent)==['EXIF']
            (src/f'parent.{fmt}').write_bytes(parent)
        # High-entropy JPEG is deliberately within the parent budget but its PNG
        # may exceed it. This is a rejection case, never an implicit retry/resize.
        old.magick('-seed','42','-size','1024x1024','xc:','+noise','Random','-quality','5',src/'budget.jpg')
        assert (src/'budget.jpg').stat().st_size<=262144
        (src/'rotated.jpg').write_bytes((evidence/'synthetic-inputs'/'orientation-6.jpg').read_bytes())
        old.magick('-size','32x32','xc:red','-size','32x32','xc:blue','-loop','0',src/'animated.webp')
        old.magick(src/'parent.jpg','-profile',old.PROFILE,src/'profile.jpg')
        # Independent preflight must reject these BEFORE sending to a decoder that
        # might silently take frame zero, normalize orientation or strip ICC.
        for file,reason in [('rotated.jpg','nonidentity_orientation'),('animated.webp','multiple_frames'),('profile.jpg','profile_requires_separate_policy')]:
            metrics=old.run([old.MAGICK,'identify','-format','%w %h %[orientation]\n',str(src/file)]).decode().splitlines()
            if reason=='nonidentity_orientation':assert metrics[0].split()[-1] not in ('TopLeft','Undefined')
            if reason=='multiple_frames':assert len(metrics)>1
            if reason=='profile_requires_separate_policy':assert 'ICC_OR_APP2' in old.metadata((src/file).read_bytes())
            log('parent_policy_rejected',case=file,reason=reason,normalizationCalls=0,consumeCalls=0)
        for file in src.iterdir():file.chmod(0o444)
        name='design-normalize-'+uuid.uuid4().hex[:12]
        security=['--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=64','--cpus=1','--memory=256m','--memory-swap=256m','--user=999:999','--tmpfs=/tmp:rw,noexec,nosuid,size=32m,mode=1777']
        env={'IMGPROXY_BIND':'127.0.0.1:8080','IMGPROXY_LOCAL_FILESYSTEM_ROOT':'/input','IMGPROXY_ALLOWED_SOURCES':','.join('local:///'+p.name for p in sorted(src.iterdir())),'IMGPROXY_MAX_SRC_RESOLUTION':'40','IMGPROXY_MAX_SRC_FILE_SIZE':str(8*1024*1024),'IMGPROXY_AUTO_ROTATE':'true','IMGPROXY_STRIP_METADATA':'true','IMGPROXY_KEEP_COPYRIGHT':'false','IMGPROXY_STRIP_COLOR_PROFILE':'true','IMGPROXY_CONCURRENCY':'1','IMGPROXY_MAX_CLIENTS':'4','IMGPROXY_READ_TIMEOUT':'5','IMGPROXY_WRITE_TIMEOUT':'10','IMGPROXY_DOWNLOAD_TIMEOUT':'3'}
        for image in (old.IMG,old.NODE):
            d=json.loads(old.run(['docker','image','inspect',image]))[0];assert image in d['RepoDigests'] and d['Architecture']=='arm64'
            log('image',digest=image,platform='linux/arm64')
        args=['docker','run','--pull=never','--detach','--name',name,'--network=none',*security,'--mount',f'type=bind,src={src},dst=/input,readonly']
        for k,v in env.items():args+=['-e',k+'='+v]
        created.append(name);old.run(args+[old.IMG])
        d=old.inspect(name);h=d['HostConfig']
        assert h['NetworkMode']=='none' and not h['PortBindings'] and h['ReadonlyRootfs'] and h['Memory']==268435456 and h['PidsLimit']==64 and h['NanoCpus']==1000000000
        assert 'ALL' in h['CapDrop'] and 'no-new-privileges' in h['SecurityOpt'] and all(not x['RW'] for x in d['Mounts'])
        log('isolation',network='none',noPorts=True,readonly=True,uid=999,memory=h['Memory'],pids=h['PidsLimit'],nanoCpus=h['NanoCpus'])
        js="""const os=require('node:os'),fs=require('node:fs'),http=require('node:http');if(Object.values(os.networkInterfaces()).flat().some(x=>!x.internal)||fs.readFileSync('/proc/net/route','utf8').split('\\n').slice(1).some(x=>x.trim()&&!x.startsWith('lo\\t')))throw Error('network-isolation');const r=http.get({host:'127.0.0.1',port:8080,path:process.argv[1],timeout:12000},s=>{let n=0,a=[];s.on('data',b=>{n+=b.length;if(n>4194304)r.destroy(Error('response-limit'));else a.push(b)});s.on('end',()=>process.stdout.write(JSON.stringify({status:s.statusCode,body:Buffer.concat(a).toString('base64')})))});r.on('timeout',()=>r.destroy(Error('timeout')));r.on('error',()=>{process.exitCode=2});"""
        def request(path):
            helper='design-normalize-client-'+uuid.uuid4().hex[:12];created.append(helper)
            data=old.run(['docker','run','--pull=never','--rm','--name',helper,'--network',f'container:{name}',*security,'--entrypoint','node',old.NODE,'-e',js,path],timeout=25)
            created.remove(helper);result=json.loads(data);return result['status'],base64.b64decode(result['body'])
        time.sleep(1);status,_=request('/health');assert status==200
        for file in ('parent.jpg','parent.webp','budget.jpg'):
            parent=(src/file).read_bytes()
            dimensions=old.run([old.MAGICK,'identify','-format','%w %h',str(src/file)]).decode().split();width,height=map(int,dimensions)
            orientation=old.run([old.MAGICK,'identify','-format','%[orientation]',str(src/file)]).decode()
            assert orientation in ('TopLeft','Undefined'),orientation
            status,raw=request(f'/insecure/rs:fit:{width}:{height}:0/plain/local:///{file}@png')
            assert status==200,(file,status)
            raw_path=out/(file+'.decoder-raw.png');raw_path.write_bytes(raw)
            raw_chunks=inspect_png(raw)
            target=out/(file+'.normalized.png')
            budget=262144
            module=(Path(__file__).resolve().parent.parent/'packages/design-production-adapter/managed-image-normalization.mjs').as_uri()
            js_strip="""import {readFileSync,writeFileSync} from 'node:fs';const {stripNormalizationPngDensity}=await import(process.argv[1]);try{const b=stripNormalizationPngDensity(readFileSync(process.argv[2]),{width:Number(process.argv[4]),height:Number(process.argv[5]),maximumBytes:262144});writeFileSync(process.argv[3],b);process.stdout.write(JSON.stringify({ok:true}));}catch(e){process.stdout.write(JSON.stringify({ok:false,code:e.code}));}"""
            stripped=json.loads(old.run(['node','--input-type=module','-e',js_strip,module,str(raw_path),str(target),str(width),str(height)]))
            if file=='budget.jpg':
                assert stripped=={'ok':False,'code':'NORMALIZATION_BUDGET_EXCEEDED'},stripped
                log('budget_rejected',parentSha256=HASH(parent),rawDecoderSha256=HASH(raw),rawDecoderBytes=len(raw),maximumBytes=budget,automaticRetry=False,consumeCalls=0)
                continue
            assert stripped=={'ok':True},stripped
            png=target.read_bytes();chunks=inspect_png(png)
            assert set(chunks)=={'IHDR','IDAT','IEND'} and b'pHYs' not in [c.encode() for c in chunks]
            result={'parentSha256':HASH(parent),'rawDecoderSha256':HASH(raw),'rawDecoderBytes':len(raw),'rawDecoderChunks':raw_chunks,'normalizedSha256':HASH(png),'parentBytes':len(parent),'normalizedBytes':len(png),'mime':'image/png','width':width,'height':height,'metadata':old.metadata(png),'pngChunks':chunks,'newArtifact':True,'parentUnchanged':(src/file).read_bytes()==parent,'state':'pending_validation','submissionAuthorized':False}
            assert result['parentSha256']!=result['normalizedSha256']
            assert len(png)<=budget
            # Two complete independent decoder runs, not just header/hash checks.
            before=old.magick(src/file,'-colorspace','sRGB','-depth','8','rgb:-')
            after=old.magick(target,'-colorspace','sRGB','-depth','8','rgb:-')
            assert before==after and len(after)==width*height*3
            log('normalization_sample',**result,fullyDecoded=True,exactPixelEquality=True,pixelBytes=len(after))
        log('local_samples_complete',productionQualified=False,independentIssuerConfigured=False,oldArtifactsNotOverwritten=True)
    finally:
        failed=[]
        for name in reversed(created[:]):
            if name.startswith('design-normalize-') and not name.startswith('design-normalize-client-'):
                p=subprocess.run(['docker','logs',name],capture_output=True,timeout=10);(out/'imgproxy.log').write_bytes(p.stdout+p.stderr)
            p=subprocess.run(['docker','rm','-f',name],capture_output=True,timeout=20)
            if p.returncode and b'No such container' not in p.stderr:failed.append(name)
        log('cleanup',remainingExactContainers=failed)
        (out/'events.json').write_text(json.dumps(events,indent=2))
        assert not failed

if __name__=='__main__':main()
