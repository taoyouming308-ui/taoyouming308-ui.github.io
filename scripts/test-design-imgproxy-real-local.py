#!/usr/bin/env python3
"""Offline synthetic imgproxy qualification. Not a production verifier or Storage test.

Uses already installed, digest-pinned images only; never pulls or changes host security.
Configuration references: imgproxy/imgproxy v3.8.0 config/config.go,
config/configurators/configurators.go and imagedata/read.go on official GitHub.
AllowedSources is a prefix glob, NOT exact object authorization. Local fixtures
contain no other files; production still requires independently exact selectors.
Known outcomes: JPEG/WebP retain generated EXIF; exact 8MiB is rejected.
Artifacts remain in a unique private evidence directory; only exact created containers
are removed. ImageMagick independently decodes outputs; stdlib parses metadata bytes.
"""
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import time
import uuid
import zlib

IMG = 'public.ecr.aws/supabase/imgproxy@sha256:0facd355d50f3be665ebe674486f2b2e9cdaebd3f74404acd9b7fece2f661435'
NODE = 'public.ecr.aws/supabase/storage-api@sha256:1dbe962d9862ef12e20357f9d7ba5431989c1daf4a556d6cb20ee4efd1c57320'
BASE = Path('/Users/a1/Documents/Codex/2026-11-17/ai-design-stage41-development/work/evidence/stage31')
MAGICK = '/opt/homebrew/bin/magick'
PROFILE = '/System/Library/ColorSync/Profiles/Display P3.icc'
SRGB = '/System/Library/ColorSync/Profiles/sRGB Profile.icc'
created = []
events = []

def log(kind, **fields):
    row = {'event': kind, **fields}
    events.append(row)
    print(json.dumps(row, ensure_ascii=False), flush=True)

def run(args, data=None, timeout=30):
    p = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if p.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed code={p.returncode}: {p.stderr.decode(errors="replace")[:700]}')
    return p.stdout

def magick(*args):
    return run([MAGICK, '-limit', 'memory', '128MiB', '-limit', 'map', '128MiB', '-limit', 'disk', '0', *map(str,args)])

def segment(marker, data):
    return bytes([255, marker]) + struct.pack('>H', len(data)+2) + data

def exif(orientation):
    # TIFF IFD0 orientation, GPS IFD (latitude reference and 3 rationals).
    t = b'II' + struct.pack('<HI', 42, 8)
    t += struct.pack('<H', 2)
    t += struct.pack('<HHI', 274, 3, 1) + struct.pack('<H', orientation) + b'\0\0'
    t += struct.pack('<HHII', 34853, 4, 1, 38) + struct.pack('<I', 0)
    t += struct.pack('<H', 2)
    t += struct.pack('<HHI', 1, 2, 2) + b'N\0\0\0'
    t += struct.pack('<HHII', 2, 5, 3, 68) + struct.pack('<I', 0)
    t += struct.pack('<IIIIII', 12, 1, 34, 1, 56, 1)
    return b'Exif\0\0' + t

def read_synthetic_exif(payload):
    assert payload[:6] == b'Exif\0\0'
    t = payload[6:]
    assert t[:4] == b'II*\0'
    def ifd(offset):
        n=struct.unpack_from('<H',t,offset)[0]
        return {struct.unpack_from('<H',t,offset+2+12*j)[0]:struct.unpack_from('<HHII',t,offset+2+12*j)[1:] for j in range(n)}
    first=ifd(struct.unpack_from('<I',t,4)[0]); gps=ifd(first[34853][2])
    values=struct.unpack_from('<IIIIII',t,gps[2][2])
    assert values == (12,1,34,1,56,1) and gps[1][2] == 78
    return first[274][2]

def metadata(data):
    tags = []
    if data[:2] == b'\xff\xd8':
        pos = 2
        while pos < len(data):
            assert data[pos] == 255
            marker = data[pos+1]
            if marker in (218, 217): break
            size = struct.unpack('>H', data[pos+2:pos+4])[0]
            payload = data[pos+4:pos+2+size]
            if marker == 225: tags.append('EXIF' if payload.startswith(b'Exif\0\0') else 'APP1')
            if marker == 226: tags.append('ICC_OR_APP2')
            if marker == 237: tags.append('IPTC_OR_APP13')
            if marker == 254: tags.append('COMMENT')
            pos += size+2
        return tags
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        pos = 8
        while pos < len(data):
            n = struct.unpack('>I', data[pos:pos+4])[0]
            typ = data[pos+4:pos+8]
            payload = data[pos+8:pos+8+n]
            assert binascii.crc32(typ+payload) & 0xffffffff == struct.unpack('>I',data[pos+8+n:pos+12+n])[0]
            if typ in (b'eXIf',b'iCCP',b'tEXt',b'zTXt',b'iTXt'): tags.append(typ.decode())
            pos += n+12
        assert pos == len(data)
        return tags
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        assert struct.unpack('<I', data[4:8])[0]+8 == len(data)
        pos = 12
        while pos < len(data):
            typ = data[pos:pos+4]; n=struct.unpack('<I',data[pos+4:pos+8])[0]
            if typ in (b'EXIF',b'XMP ',b'ICCP'): tags.append(typ.decode())
            pos += 8+n+(n%2)
        assert pos == len(data)
        return tags
    raise AssertionError('unrecognized output bytes')

def png(w,h):
    def chunk(t,p): return struct.pack('>I',len(p))+t+p+struct.pack('>I',binascii.crc32(t+p)&0xffffffff)
    c=zlib.compressobj(6); parts=[]
    row=b'\0'+b'\x40\x80\xc0'*w
    for _ in range(h): parts.append(c.compress(row))
    parts.append(c.flush())
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',b''.join(parts))+chunk(b'IEND',b'')

def padded_jpeg(data, size):
    remaining=size-len(data); parts=[]
    while remaining:
        n=min(65537, remaining)
        if 0 < remaining-n < 4: n-=4-(remaining-n)
        assert n>=4
        parts.append(segment(239,b'\0'*(n-4))); remaining-=n
    return data[:2]+b''.join(parts)+data[2:]

def inspect(name): return json.loads(run(['docker','inspect',name]))[0]

def main():
    assert len(sys.argv)==2 and sys.argv[1] in ('--run-isolated','--diagnose','--diagnose-formats','--remaining','--byte-boundaries','--inclusive-byte-boundaries'), 'requires explicit isolated mode'
    diagnose = sys.argv[1]=='--diagnose'
    inclusive=sys.argv[1]=='--inclusive-byte-boundaries'
    policy=None
    if inclusive:
        policy=json.loads(run(['node','--input-type=module','-e',"import {LOCAL_IMAGE_DECODER_POLICY as p} from './packages/design-production-adapter/local-image-decoder-policy.mjs'; console.log(JSON.stringify(p));"]))
        assert policy['decoderImage']==IMG and policy['maxAcceptedSourceBytes']==8388608 and policy['decoderReadLimitBytes']==8388609 and policy['productionEnabled'] is False
        log('inclusive_policy', **policy)
    evidence_base=BASE.parent/'stage32' if inclusive else BASE
    evidence_base.mkdir(parents=True, exist_ok=True)
    out=evidence_base/('imgproxy-'+time.strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:8]); out.mkdir(mode=0o700)
    src=out/'synthetic-inputs'; src.mkdir(mode=0o755)
    log('begin', evidence=str(out), scope='local synthetic only; not cloud configuration qualification')
    try:
        for image in (IMG,NODE):
            d=json.loads(run(['docker','image','inspect',image]))[0]
            assert d['Os']=='linux' and d['Architecture']=='arm64'
            assert image in d['RepoDigests']
            log('image', digest=image, imageId=d['Id'], platform='linux/arm64')
        log('independent_decoder', version=run([MAGICK,'-version']).decode().splitlines()[0])
        base=src/'base.jpg'
        magick('-size','120x80','xc:red','-fill','lime','-draw','rectangle 60,0 119,39','-fill','blue','-draw','rectangle 0,40 59,79','-fill','yellow','-draw','rectangle 60,40 119,79','-quality','96',base)
        original=base.read_bytes()
        for orientation in range(1,9):
            assert read_synthetic_exif(exif(orientation)) == orientation
            value=original[:2]+segment(225,exif(orientation))+segment(225,b'http://ns.adobe.com/xap/1.0/\0<SyntheticGPS>12,34</SyntheticGPS>')+segment(237,b'Photoshop 3.0\0synthetic-private')+segment(254,b'synthetic-private-comment')+original[2:]
            (src/f'orientation-{orientation}.jpg').write_bytes(value)
            assert set(metadata(value))=={'EXIF','APP1','IPTC_OR_APP13','COMMENT'}
        magick('-size','100x60','xc:rgb(100,130,170)','-profile',PROFILE,src/'p3.jpg')
        assert 'ICC_OR_APP2' in metadata((src/'p3.jpg').read_bytes())
        (src/'size-40mp.png').write_bytes(png(10000,4000))
        (src/'size-over40mp.png').write_bytes(png(10001,4000))
        (src/'size-under8mib.jpg').write_bytes(padded_jpeg(original,8*1024*1024-1))
        (src/'size-8mib.jpg').write_bytes(padded_jpeg(original,8*1024*1024))
        (src/'size-over8mib.jpg').write_bytes(padded_jpeg(original,8*1024*1024+1))
        (src/'broken.jpg').write_bytes(original[:100])
        magick('-size','2048x1536','gradient:red-blue',src/'large.png')
        for p in src.iterdir(): p.chmod(0o444)
        name='design-imgproxy-'+uuid.uuid4().hex[:12]
        security=['--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=64','--cpus=1','--memory=256m','--memory-swap=256m','--user=999:999','--tmpfs=/tmp:rw,noexec,nosuid,size=32m,mode=1777']
        env={'IMGPROXY_BIND':'127.0.0.1:8080','IMGPROXY_LOCAL_FILESYSTEM_ROOT':'/input','IMGPROXY_ALLOWED_SOURCES':','.join('local:///'+p.name for p in sorted(src.iterdir())),'IMGPROXY_MAX_SRC_RESOLUTION':'40','IMGPROXY_MAX_SRC_FILE_SIZE':str(policy['decoderReadLimitBytes'] if inclusive else 8*1024*1024),'IMGPROXY_AUTO_ROTATE':'true','IMGPROXY_STRIP_METADATA':'true','IMGPROXY_KEEP_COPYRIGHT':'false','IMGPROXY_STRIP_COLOR_PROFILE':'true','IMGPROXY_CONCURRENCY':'1','IMGPROXY_MAX_CLIENTS':'4','IMGPROXY_READ_TIMEOUT':'5','IMGPROXY_WRITE_TIMEOUT':'10','IMGPROXY_DOWNLOAD_TIMEOUT':'3'}
        args=['docker','run','--pull=never','--detach','--name',name,'--network=none',*security,'--mount',f'type=bind,src={src},dst=/input,readonly']
        for k,v in env.items(): args+=['-e',f'{k}={v}']
        created.append(name)
        run(args+[IMG])
        d=inspect(name); h=d['HostConfig']
        assert h['NetworkMode']=='none' and not h['PortBindings'] and h['ReadonlyRootfs']
        assert h['Memory']==268435456 and h['PidsLimit']==64 and h['NanoCpus']==1000000000
        assert 'ALL' in h['CapDrop'] and 'no-new-privileges' in h['SecurityOpt']
        assert all(not m['RW'] for m in d['Mounts'])
        log('isolation', network='none; loopback-only shared namespace', rootReadonly=True, inputReadonly=True, uid=999, memory=h['Memory'], pids=h['PidsLimit'], nanoCpus=h['NanoCpus'], noPorts=True, noDockerSocket=True)
        js="""const os=require('node:os');const fs=require('node:fs');if(Object.values(os.networkInterfaces()).flat().some(x=>!x.internal))throw Error('non-loopback-interface');if(fs.readFileSync('/proc/net/route','utf8').split('\\n').slice(1).some(x=>x.trim()&&!x.startsWith('lo\\t')))throw Error('external-route');const http=require('node:http');const path=process.argv[1];const r=http.get({host:'127.0.0.1',port:8080,path,timeout:12000},s=>{let n=0,b=[];s.on('data',x=>{n+=x.length;if(n>2097152)r.destroy(new Error('response-bound'));else b.push(x)});s.on('end',()=>process.stdout.write(JSON.stringify({status:s.statusCode,body:Buffer.concat(b).toString('base64')})))});r.on('timeout',()=>r.destroy(new Error('deadline')));r.on('error',()=>{process.stdout.write(JSON.stringify({status:0,body:''}));process.exitCode=2});"""
        def request(path):
            helper='design-image-request-'+uuid.uuid4().hex[:12]; created.append(helper)
            a=['docker','run','--pull=never','--rm','--name',helper,'--network',f'container:{name}',*security,'--entrypoint','node',NODE,'-e',js,path]
            value=json.loads(run(a,timeout=25)); created.remove(helper)
            return value['status'],base64.b64decode(value['body'])
        # Startup must become healthy under an existing bounded budget; no transform retries.
        time.sleep(1)
        status,_=request('/health'); assert status==200
        log('health',status=status)
        def transform(file,fmt='png',edge=1024):
            return request(f'/insecure/rs:fit:{edge}:{edge}:0/plain/local:///{file}@{fmt}')
        if diagnose:
            status,body=transform('orientation-1.jpg')
            log('diagnostic_response', status=status, bodyText=body.decode(errors='replace')[:300] if status!=200 else 'image bytes received')
            return
        if sys.argv[1] in ('--byte-boundaries','--inclusive-byte-boundaries'):
            for file,allowed in [('size-under8mib.jpg',True),('size-8mib.jpg',inclusive),('size-over8mib.jpg',False),('broken.jpg',False)]:
                status,body=transform(file)
                log('observed_byte_boundary',case=file,sourceBytes=(src/file).stat().st_size,status=status,applicationBoundaryMismatch=file=='size-8mib.jpg' and status!=200)
                assert (status==200)==allowed,(file,status)
                if allowed:
                    dest=out/f'byte-{file}.png';dest.write_bytes(body);magick(dest,'-depth','8','rgb:-')
            for path in ['/insecure/rs:fit:64:64/plain/local:///../outside.png@png','/insecure/rs:fit:64:64/plain/http://127.0.0.1:8080/health@png']:
                status,_=request(path);assert status!=200;log('source_rejected',case='traversal' if '..' in path else 'non-local-source',status=status)
            end=inspect(name);assert end['State']['Running'] and not end['State']['OOMKilled']
            log('boundary_observation_complete',overallQualified=False,inclusiveApplicationBoundaryPassed=inclusive,knownIssues=['JPEG/WebP EXIF retained'] if inclusive else ['JPEG/WebP EXIF retained','exact 8MiB rejected'],resourceLimits='Docker hard limits configured; not exhaustive attack qualification')
            return
        if sys.argv[1]=='--diagnose-formats':
            for fmt in ('jpg','webp'):
                status,body=transform('orientation-6.jpg',fmt)
                (out/f'diagnostic.{fmt}').write_bytes(body)
                log('diagnostic_format',format=fmt,status=status,metadata=metadata(body) if status==200 else [],bytes=len(body))
                if status==200:
                    decoded=magick(out/f'diagnostic.{fmt}','-depth','8','rgb:-')
                    log('diagnostic_decoded',format=fmt,pixelBytes=len(decoded))
            return
        for orient in (range(1,9) if sys.argv[1]!='--remaining' else ()):
            status,body=transform(f'orientation-{orient}.jpg'); assert status==200, ('orientation',orient,status)
            dest=out/f'orientation-{orient}.png'; dest.write_bytes(body)
            assert metadata(body)==[], metadata(body)
            actual=magick(dest,'-depth','8','rgb:-')
            expected=magick(src/f'orientation-{orient}.jpg','-auto-orient','-depth','8','rgb:-')
            assert len(actual)==len(expected)==120*80*3
            error=sum(abs(a-b) for a,b in zip(actual,expected))/len(actual)
            assert error<2, error
            dims=run([MAGICK,'identify','-format','%wx%h',str(dest)]).decode()
            assert dims==('80x120' if orient>=5 else '120x80')
            log('orientation_metadata', orientation=orient, status=status, dimensions=dims, meanPixelError=round(error,4), outputMetadata=metadata(body))
        for fmt in (('jpg','webp') if sys.argv[1]!='--remaining' else ()):
            status,body=transform('orientation-6.jpg',fmt)
            dest=out/f'metadata.{fmt}';dest.write_bytes(body)
            assert status==200 and metadata(body)==[], (fmt,status,metadata(body))
            assert len(magick(dest,'-depth','8','rgb:-'))==120*80*3
            log('output_format',format=fmt,bytes=len(body),metadata=metadata(body),fullyDecoded=True)
        status,body=transform('p3.jpg'); assert status==200 and metadata(body)==[]
        dest=out/'color.png';dest.write_bytes(body)
        actual=magick(dest,'-depth','8','rgb:-'); expected=magick(src/'p3.jpg','-profile',SRGB,'-depth','8','rgb:-')
        error=sum(abs(a-b) for a,b in zip(actual,expected))/len(actual);assert error<3,error
        log('color_conversion',profile='Display P3 to sRGB',meanPixelError=round(error,4),iccRemoved=True)
        for edge,budget in ((1024,262144),(1536,524288)):
            status,body=transform('large.png',edge=edge);assert status==200
            dest=out/f'edge-{edge}.png';dest.write_bytes(body)
            dims=list(map(int,run([MAGICK,'identify','-format','%w %h',str(dest)]).split()))
            assert max(dims)==edge and metadata(body)==[]
            magick(dest,'-depth','8','rgb:-')
            log('geometry_budget_observation',edge=edge,dimensions=dims,bytes=len(body),budget=budget,withinBudget=len(body)<=budget,note='sample only; provider output not intrinsically byte-budget enforced')
        for file,allowed in [('size-40mp.png',True),('size-over40mp.png',False),('size-8mib.jpg',True),('size-over8mib.jpg',False),('broken.jpg',False)]:
            status,body=transform(file)
            assert (status==200)==allowed,(file,status)
            if allowed:
                dest=out/f'boundary-{file}.png';dest.write_bytes(body);magick(dest,'-depth','8','rgb:-')
            log('boundary',case=file,status=status,expectedAccepted=allowed)
        for path in ['/insecure/rs:fit:64:64/plain/local:///../outside.png@png','/insecure/rs:fit:64:64/plain/http://127.0.0.1:8080/health@png']:
            status,_=request(path);assert status!=200;log('source_rejected',case='traversal' if '..' in path else 'non-local-source',status=status)
        end=inspect(name);assert end['State']['Running'] and not end['State']['OOMKilled']
        log('PASS',checks='remaining: color/bounds/restricted source' if sys.argv[1]=='--remaining' else 'orientation8/formats/color/bounds/restricted source',resourceBoundary='configured cgroup limits verified; no exhaustive adversarial decoder or OOM qualification',productionEnabled=False)
    finally:
        failed=[]
        for container in created[:]:
            if container.startswith('design-imgproxy-'):
                logs=subprocess.run(['docker','logs',container],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
                (out/'imgproxy.log').write_bytes(logs.stdout+logs.stderr)
        for name in reversed(created[:]):
            p=subprocess.run(['docker','rm','-f',name],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
            if p.returncode and b'No such container' not in p.stderr: failed.append(name)
            else: created.remove(name)
        log('cleanup',remainingExactContainers=failed)
        (out/'events.json').write_text(json.dumps(events,ensure_ascii=False,indent=2))
        assert not failed,'exact container cleanup failed'

if __name__=='__main__': main()
