"""One input, one output. Only run inside the reviewed isolated worker container.
No paths/URLs/commands/credentials from stdin. Full pixel load precedes output.
EXIF transpose, white alpha composition and fresh containers remove metadata.
"""
import base64
import binascii
import hashlib
import io
import json
import os
import resource
import struct
import sys
import warnings
import zlib


def limits():
    if sys.platform != 'linux' or os.getuid() == 0:
        raise ValueError('host')
    for name, value in [('RLIMIT_AS', 768 * 1024 * 1024), ('RLIMIT_CPU', 8),
                        ('RLIMIT_CORE', 0), ('RLIMIT_FSIZE', 1024 * 1024), ('RLIMIT_NOFILE', 32)]:
        resource.setrlimit(getattr(resource, name), (value, value))


def rgba_png(image):
    width, height = image.size
    raw = image.convert('RGBA').tobytes()
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', binascii.crc32(kind + data) & 0xffffffff)
    rows = b''.join(b'\0' + raw[y * width * 4:(y + 1) * width * 4] for y in range(height))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


def clean_jpeg(data):
    # No EXIF/GPS/ICC/comments/MakerNotes/thumbnail may survive fresh encoding.
    at = 2
    while at + 4 <= len(data):
        if data[at] != 255:
            raise ValueError('jpeg')
        code = data[at + 1]
        if code == 218:
            return True
        if code == 254 or 225 <= code <= 239:
            raise ValueError('metadata')
        size = int.from_bytes(data[at + 2:at + 4], 'big')
        if size < 2 or at + 2 + size > len(data):
            raise ValueError('jpeg')
        at += 2 + size
    raise ValueError('jpeg')


def main():
    limits()
    sys.path.insert(0, '/opt/pillow')
    import PIL
    from PIL import Image, ImageFile, ImageOps, PngImagePlugin
    import pillow_heif
    if PIL.__version__ != '13.0.0':
        raise ValueError('version')
    if pillow_heif.__version__ != '1.8.1':
        raise ValueError('heif-version')
    pillow_heif.register_heif_opener(thumbnails=False, decode_threads=1)
    Image.MAX_IMAGE_PIXELS = 40000000
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    PngImagePlugin.MAX_TEXT_CHUNK = 262144
    PngImagePlugin.MAX_TEXT_MEMORY = 1048576
    warnings.simplefilter('error')
    operation = sys.argv[1] if len(sys.argv) == 2 else ''
    if operation not in ['inspect', 'process', 'verify-clean']:
        raise ValueError('operation')
    data = sys.stdin.buffer.read(8388609)
    if not 1 <= len(data) <= 8388608:
        raise ValueError('bytes')
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        # Pillow.verify() does not check the final IEND CRC itself.
        at, count = 8, 0
        while at < len(data):
            if at + 12 > len(data) or count >= 4096:
                raise ValueError('png')
            count += 1
            size = int.from_bytes(data[at:at+4], 'big')
            end = at + 12 + size
            if end > len(data) or binascii.crc32(data[at+4:end-4]) & 0xffffffff != int.from_bytes(data[end-4:end], 'big'):
                raise ValueError('png-crc')
            at = end
    if data[:2] == b'\xff\xd8':
        # Pillow/libjpeg normally tolerates some premature EOI warnings. The
        # companion validator uses the SAME pinned libjpeg with warnings fatal.
        import ctypes
        strict = ctypes.CDLL('/opt/design-phone/strict-jpeg.so')
        strict.design_strict_jpeg.argtypes = [ctypes.c_char_p, ctypes.c_ulong]
        strict.design_strict_jpeg.restype = ctypes.c_int
        if strict.design_strict_jpeg(data, len(data)) != 1:
            raise ValueError('jpeg-decode')
    with Image.open(io.BytesIO(data), formats=['JPEG', 'PNG', 'WEBP', 'HEIF']) as image:
        fmt = image.format
        width, height = image.size
        if getattr(image, 'n_frames', 1) != 1 or width > 16384 or height > 16384 or width * height > 40000000:
            raise ValueError('pixels')
        image.verify()
    with Image.open(io.BytesIO(data), formats=['JPEG', 'PNG', 'WEBP', 'HEIF']) as image:
        image.load()  # No header-only acceptance or truncated-image fallback.
        orientation = image.getexif().get(274, 1)
        if orientation not in range(1, 9):
            raise ValueError('orientation')
        heic = any(data[i:i+4] in [b'heic', b'heix', b'hevc', b'hevx'] for i in [8] + list(range(16, min(len(data), int.from_bytes(data[:4], 'big')), 4)))
        source = {'mime': {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp', 'HEIF': 'image/heic' if heic else 'image/heif'}[fmt],
                  'width': width, 'height': height, 'frameCount': 1, 'decoded': True}
        result = {'schemaVersion': 'design-phone-native-v2', 'sourceSha256': hashlib.sha256(data).hexdigest(),
                  'source': source, 'runtime': {'pillow': PIL.__version__, 'pillowHeif': pillow_heif.__version__, 'python': sys.version.split()[0]}}
        if operation == 'verify-clean':
            if fmt != 'JPEG' or image.getexif() or any(k in image.info for k in ['icc_profile', 'exif', 'comment', 'xmp']):
                raise ValueError('metadata')
            clean_jpeg(data)
            result['metadataAbsent'] = True
        if operation == 'process':
            oriented = ImageOps.exif_transpose(image)
            if 'A' in oriented.getbands() or 'transparency' in oriented.info:
                rgba = oriented.convert('RGBA')
                rgb = Image.new('RGB', oriented.size, 'white')
                rgb.paste(rgba, mask=rgba.getchannel('A'))
            else:
                rgb = oriented.convert('RGB')
            # New pixel containers, never copy image.info/exif from the original.
            rgb.info.clear()
            rgb.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
            normalized = None
            for quality in [85, 75, 65]:
                stream = io.BytesIO()
                rgb.save(stream, format='JPEG', quality=quality, optimize=True, progressive=False)
                candidate = stream.getvalue()
                if len(candidate) <= 524288:
                    normalized = candidate
                    break
            if normalized is None:
                raise ValueError('output')
            clean_jpeg(normalized)
            small = rgb.copy()
            small.thumbnail((108, 108), Image.Resampling.LANCZOS)
            derivative = rgba_png(small)
            def binary(b, mime, size):
                return {'mime': mime, 'width': size[0], 'height': size[1], 'byteLength': len(b),
                        'sha256': hashlib.sha256(b).hexdigest(), 'bytesBase64': base64.b64encode(b).decode('ascii')}
            result['normalized'] = binary(normalized, 'image/jpeg', rgb.size)
            result['derivative'] = binary(derivative, 'image/png', small.size)
            result['orientationApplied'] = orientation
        sys.stdout.write(json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.stderr.write('PHONE_NATIVE_REJECTED\n')
        sys.exit(1)
