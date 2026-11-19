FROM public.ecr.aws/supabase/storage-api@sha256:1dbe962d9862ef12e20357f9d7ba5431989c1daf4a556d6cb20ee4efd1c57320 AS assemble
USER 0
COPY vendor/pillow-13.0.0-cp312-cp312-musllinux_1_2_aarch64.whl /wheel/pillow.whl
RUN python3 -I -c "import hashlib,zipfile,pathlib; p=pathlib.Path('/wheel/pillow.whl'); assert hashlib.sha256(p.read_bytes()).hexdigest()=='4bd024d567eca931b668978d672dba914d4b8e2628e2c3073a2ad178de8a2620'; zipfile.ZipFile(p).extractall('/opt/pillow')"
COPY vendor/pillow_heif-1.8.1-cp312-cp312-musllinux_1_2_aarch64.whl /wheel/heif.whl
RUN python3 -I -c "import hashlib,zipfile,pathlib; p=pathlib.Path('/wheel/heif.whl'); assert hashlib.sha256(p.read_bytes()).hexdigest()=='7a719a475c761fe2834346a1e9f127b322bd14ed88f347360e82fd9766ff06a2'; zipfile.ZipFile(p).extractall('/opt/pillow')"
COPY phone-native-worker.py /opt/design-phone/worker.py
COPY phone-strict-jpeg.c /strict/phone-strict-jpeg.c
COPY vendor/jpeg /strict/include
RUN gcc -shared -fPIC -O2 -Wall -Wextra -Werror -I/strict/include -Wl,-rpath,/opt/pillow/pillow.libs -o /opt/design-phone/strict-jpeg.so /strict/phone-strict-jpeg.c /opt/pillow/pillow.libs/libjpeg-e5567ec5.so.62.4.0
RUN mkdir /empty-work && chmod 700 /empty-work && chown 65532:65532 /empty-work

# A fresh image configuration: no inherited service entrypoint, env or volumes.
FROM scratch
COPY --from=assemble /lib /lib
COPY --from=assemble /usr /usr
COPY --from=assemble /opt/pillow /opt/pillow
COPY --from=assemble /opt/design-phone /opt/design-phone
COPY --chown=65532:65532 --from=assemble /empty-work /work
ENV PATH=/usr/bin:/bin
USER 65532:65532
WORKDIR /work
ENTRYPOINT ["/usr/bin/python3", "-I", "/opt/design-phone/worker.py"]
