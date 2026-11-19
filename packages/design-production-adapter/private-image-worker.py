"""One-shot isolated Linux worker. Not a host launcher or an isolation attestation.
Run ONLY through the reviewed private-image-worker-driver with an immutable image.
No credentials, URLs, filenames, commands or configuration come from stdin.
"""
import base64
import binascii
import hashlib
import json
import os
import resource
import selectors
import time
import struct
import subprocess
import sys
import tempfile
import zlib

MAX_INPUT = 8 * 1024 * 1024
VERSION = 'ImageMagick 7.1.2-17'
MAGICK = '/usr/bin/magick'
POLICY = '''<policymap>
<policy domain="resource" name="memory" value="256MiB"/>
<policy domain="resource" name="map" value="0"/>
<policy domain="resource" name="disk" value="0"/>
<policy domain="resource" name="width" value="16384"/>
<policy domain="resource" name="height" value="16384"/>
<policy domain="resource" name="area" value="40MP"/>
<policy domain="resource" name="list-length" value="1"/>
<policy domain="resource" name="thread" value="1"/>
<policy domain="resource" name="time" value="3"/>
<policy domain="delegate" rights="none" pattern="*"/>
<policy domain="filter" rights="none" pattern="*"/>
<policy domain="coder" rights="none" pattern="*"/>
<policy domain="coder" rights="read" pattern="{PNG,JPEG,WEBP}"/>
<policy domain="coder" rights="write" pattern="{INFO,RGBA}"/>
<policy domain="path" rights="none" pattern="@*"/>
</policymap>'''


def png_rgba(width, height, pixels):
    """Rebuild from pixels, never copy container metadata or compressed input."""
    if not (1 <= width <= 128 and 1 <= height <= 128) or len(pixels) != width * height * 4:
        raise ValueError('pixels')
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', binascii.crc32(kind + data) & 0xffffffff)
    scan = b''.join(b'\x00' + pixels[y * width * 4:(y + 1) * width * 4] for y in range(height))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(scan, 9)) + chunk(b'IEND', b'')


def limits():
    if sys.platform != 'linux' or os.geteuid() == 0:
        raise ValueError('platform')
    for name, limit in [('RLIMIT_AS', 768 * 1024 * 1024), ('RLIMIT_CPU', 3), ('RLIMIT_CORE', 0), ('RLIMIT_FSIZE', 9 * 1024 * 1024), ('RLIMIT_NOFILE', 32)]:
        resource.setrlimit(getattr(resource, name), (limit, limit))


def main():
    limits()  # No synthetic fallback. Failure precedes reading original bytes.
    data = sys.stdin.buffer.read(MAX_INPUT + 1)
    if not data or len(data) > MAX_INPUT:
        raise ValueError('input')
    mime, coder = ('image/png', 'PNG') if data.startswith(b'\x89PNG\r\n\x1a\n') else (('image/jpeg', 'JPEG') if data.startswith(b'\xff\xd8\xff') else (('image/webp', 'WEBP') if data[:4] == b'RIFF' and data[8:12] == b'WEBP' else (None, None)))
    if mime is None:
        raise ValueError('input')
    with tempfile.TemporaryDirectory(prefix='image-', dir='/work') as directory:
        os.chmod(directory, 0o700)
        original = directory + '/original'
        with open(original, 'xb') as stream:
            stream.write(data)
        with open(directory + '/policy.xml', 'x') as stream:
            stream.write(POLICY)
        env = {'PATH': '/usr/bin:/bin', 'HOME': directory, 'TMPDIR': directory, 'MAGICK_TMPDIR': directory, 'MAGICK_CONFIGURE_PATH': directory, 'MAGICK_THREAD_LIMIT': '1', 'LC_ALL': 'C'}
        def run(args, max_output):
            # All arguments fixed here, no user-supplied command/path/URL. Outer cgroup and
            # driver bound total memory, output and lifetime even if native code is hostile.
            process = subprocess.Popen([MAGICK] + args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            output = bytearray()
            deadline = time.monotonic() + 4
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ, 'output')
                    selector.register(process.stderr, selectors.EVENT_READ, 'error')
                    while selector.get_map():
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            raise ValueError('timeout')
                        for key, _ in selector.select(remaining):
                            piece = os.read(key.fileobj.fileno(), 4096)
                            if not piece:
                                selector.unregister(key.fileobj)
                            elif key.data == 'error':
                                raise ValueError('decode')
                            else:
                                output.extend(piece)
                                if len(output) > max_output:
                                    raise ValueError('output')
                if process.wait(timeout=max(0.001, deadline - time.monotonic())) != 0:
                    raise ValueError('decode')
                return bytes(output)
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait()
                process.stdout.close()
                process.stderr.close()
        if not run(['-version'], 8192).decode('ascii').startswith('Version: ' + VERSION + ' '):
            raise ValueError('version')
        # Signature calculation forces full pixel decode, not -ping. Frame count exact.
        meta = run(['-regard-warnings', coder + ':' + original, '-format', '%m %w %h %n %#\n', 'info:-'], 256).decode('ascii').split()
        if len(meta) != 5 or meta[0] != coder or meta[3] != '1' or len(meta[4]) != 64:
            raise ValueError('frames')
        width, height = int(meta[1]), int(meta[2])
        if not 1 <= width <= 16384 or not 1 <= height <= 16384 or width * height > 40000000:
            raise ValueError('pixels')
        # Auto-orient while EXIF is available, then strip. Reencode RAW RGBA into a new
        # minimal PNG, so no EXIF, profiles, text, thumbnails or animation can survive.
        args = ['-regard-warnings', coder + ':' + original, '-auto-orient', '-strip', '-colorspace', 'sRGB', '-thumbnail', '128x128>', '-alpha', 'on', '-depth', '8']
        size = run(args + ['-format', '%w %h %n', 'info:-'], 64).decode('ascii').split()
        if len(size) != 3 or size[2] != '1':
            raise ValueError('frames')
        dw, dh = int(size[0]), int(size[1])
        pixels = run(args + ['RGBA:-'], 128 * 128 * 4)
        derived = png_rgba(dw, dh, pixels)
        result = {'schemaVersion': 'private-image-worker-v1', 'sourceSha256': hashlib.sha256(data).hexdigest(), 'source': {'mime': mime, 'width': width, 'height': height, 'frameCount': 1, 'decoded': True}, 'derivative': {'mime': 'image/png', 'width': dw, 'height': dh, 'sha256': hashlib.sha256(derived).hexdigest(), 'bytesBase64': base64.b64encode(derived).decode('ascii')}}
        sys.stdout.write(json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Do not echo source, metadata, command output, filenames or exception text.
        sys.stderr.write('IMAGE_WORKER_REJECTED\n')
        sys.exit(1)
