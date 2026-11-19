"""Synthetic-only phone-sized corpus. No downloaded photographs or personal data."""
import sys,io,json,base64,hashlib
sys.path.insert(0,'/opt/pillow')
from PIL import Image,ImageOps,ImageDraw,PngImagePlugin
import pillow_heif
pillow_heif.register_heif_opener(thumbnails=False,decode_threads=1)
rows=[]
def keep(name,b,mime,**extra):
 rows.append(dict(name=name,mime=mime,sha256=hashlib.sha256(b).hexdigest(),byteLength=len(b),base64=base64.b64encode(b).decode(),**extra))
grad=Image.linear_gradient('L').resize((3024,4032));im=Image.merge('RGB',(grad,ImageOps.invert(grad),grad))
d=ImageDraw.Draw(im)
for box,color in [((0,0,600,600),'red'),((2424,0,3024,600),'green'),((0,3432,600,4032),'blue'),((2424,3432,3024,4032),'yellow')]:d.rectangle(box,fill=color)
ex=Image.Exif();ex[274]=6;ex[270]='SYNTHETIC-PRIVATE-LOCATION-NOT-A-CUSTOMER'
for name,fmt,mime,kw in [('phone-exif6.jpg','JPEG','image/jpeg',dict(exif=ex,quality=88,xmp=b'<xmp>SYNTHETIC-PRIVATE-XMP</xmp>')),('phone-progressive.jpg','JPEG','image/jpeg',dict(quality=88,progressive=True)),('phone.png','PNG','image/png',{}),('phone.webp','WEBP','image/webp',dict(quality=85,exif=ex))]:
 s=io.BytesIO();im.save(s,format=fmt,**kw);keep(name,s.getvalue(),mime)
# Real libheif HEVC encoding, no renamed JPEG or fixture whitelist.
heif=im.copy();heif.info['exif']=ex.tobytes();s=io.BytesIO();heif.save(s,format='HEIF',quality=65,exif=ex.tobytes(),xmp=b'<xmp>SYNTHETIC-PRIVATE-HEIF</xmp>',enc_params={'preset':'ultrafast','x265:pools':'none','x265:frame-threads':'1'});data=s.getvalue();keep('phone.heic',data,'image/heic')
# Generic still HEIF major/compatible brands, same encoded HEVC image items.
b=bytearray(data);n=int.from_bytes(b[:4],'big')
for at in [8]+list(range(16,n,4)):
 if b[at:at+4] in [b'heic',b'heix',b'hevc',b'hevx']:b[at:at+4]=b'mif1'
keep('phone.heif',bytes(b),'image/heif')
# A 10-bit HEIF source from actual 16-bit RGB samples (not a filename change).
hdr=im.resize((1000,750));raw=hdr.tobytes();wide=bytearray(len(raw)*2);wide[::2]=raw;wide[1::2]=raw
h=pillow_heif.from_bytes('RGB;16',hdr.size,bytes(wide));s=io.BytesIO();h.save(s,quality=65,enc_params={'preset':'ultrafast','x265:pools':'none','x265:frame-threads':'1'});keep('phone-10bit.heic',s.getvalue(),'image/heic',bitDepth=10)

# Deterministic high-entropy 12MP inputs exercise multi-megabyte real codec work.
import random
noise=Image.frombytes('L',(3024,4032),random.Random(20261117).randbytes(3024*4032)).convert('RGB')
s=io.BytesIO();noise.save(s,format='JPEG',quality=75);detail=s.getvalue();assert len(detail)<=8388608;keep('phone-detail.jpg',detail,'image/jpeg',highEntropy=True)
s=io.BytesIO();noise.save(s,format='HEIF',quality=45,enc_params={'preset':'ultrafast','x265:pools':'none','x265:frame-threads':'1'});detail=s.getvalue();assert len(detail)<=8388608;keep('phone-detail.heic',detail,'image/heic',highEntropy=True)
noise.close()
a=Image.new('RGBA',(1200,1800),(255,20,30,90));s=io.BytesIO();a.save(s,format='PNG');keep('alpha.png',s.getvalue(),'image/png')
s=io.BytesIO();Image.new('RGB',(32,32),'red').save(s,format='WEBP',save_all=True,append_images=[Image.new('RGB',(32,32),'blue')],duration=100,loop=0);keep('animated.webp',s.getvalue(),'image/webp',invalid=True)
s=io.BytesIO();Image.new('RGBA',(32,32),'red').save(s,format='PNG',save_all=True,append_images=[Image.new('RGBA',(32,32),'blue')],duration=100,loop=0);keep('animated.png',s.getvalue(),'image/png',invalid=True)
s=io.BytesIO();Image.new('RGB',(64,64),'red').save(s,format='HEIF',save_all=True,append_images=[Image.new('RGB',(64,64),'blue')],quality=50,enc_params={'preset':'ultrafast','x265:pools':'none','x265:frame-threads':'1'});keep('multi.heic',s.getvalue(),'image/heic',invalid=True)
print(json.dumps(rows,separators=(',',':')))
