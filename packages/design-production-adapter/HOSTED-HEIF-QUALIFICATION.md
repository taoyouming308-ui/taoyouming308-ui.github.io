# Hosted HEIF processing qualification — 2026-11-22

`hosted-heif-codec.mjs` is an explicit, default-closed WASM alternative. It does
not replace or relax the native Linux worker's qualification requirements.
It opens no listener and reads no environment, credentials, database or Storage.
No model request is made. Authentication, service binding, upload/view permission
and original-image processing permission remain separate requirements.

## Measured format boundary

- Original HEIC/HEIF bytes are parsed and decoded directly. No filename/MIME
  renaming, browser HEIF converter or managed-service HEIF alias is used.
- Input: at most 8 MiB, 12,582,912 pixels, 8192 per axis and one top-level image.
  This alternate engine is narrower than the native 40-million-pixel engine.
  It does not establish support for 48 MP photos, bursts or spatial multi-images.
- Output: baseline JPEG preview, longest edge 768, at most 512 KiB; filter-zero
  RGBA8 PNG derivative, longest edge 108. Alpha is flattened onto white.
  EXIF/GPS/XMP/IPTC/ICC data is not copied into either reconstructed output.
- A separate JPEG entropy decoder validates the preview after strict marker,
  frame, dimension, end-of-image and metadata checks. A separate streaming
  DEFLATE decoder validates the PNG CRCs, Adler checksum, exact dimensions,
  output budget and complete single-stream input consumption.
- The cloud Edge runtime's `node:zlib` ignored `info:true`. Its absence was
  measured with fixed synthetic bytes; the strict native verifier is unchanged.
  `hosted-photo-derivative.mjs` uses pinned Pako for the hosted boundary and
  rejects trailing/concatenated streams, corruption and excessive output.

## Completed acceptance

Nine Node cases and the same nine Deno cases cover actual synthetic HEIF decode,
10-bit decode, privacy of caller buffers, final revocation/abort, global admission,
multi-frame rejection and malformed JPEG/PNG/zlib boundaries. Four Edge-routing
cases plus the existing 26 client cases pass; the routing cases also pass in Deno.

Fixed public samples are pinned to pillow_heif commit
`558ee2bfbe85a64b4371bcc1bc067883c5f9573d`. Cloud cases cover two 12 MP HEICs,
generic HEIF, 10/12-bit samples, metadata-bearing input, repeated decode, multi-frame
denial and an exactly 8 MiB synthetic HEIF with a valid padding box. All successful
preview files match local SHA-256 and decoded pixels. Tiny PNG compression differs
between runtimes; independent decoded pixel hashes match and complete input is
verified in each runtime. One transport interruption was recorded and its exact
remaining fixed sample was checked in a bounded follow-up.

Cloud codec time for accepted samples was about 0.13–1.24 seconds; measured
HTTP time through the development connection was about 2.0–14.9 seconds. These
are sample measurements, not a physical-iPhone or production-load guarantee.
Cloud-reported RSS was zero/unavailable and is not memory-acceptance evidence.
The host platform's CPU/memory termination must still apply to every job.

The temporary fixed-hash/capability probe was replaced by inert JWT-protected
version 14 and read back. Temporary local capability files were removed. No
customer photo, production Storage object or paid model request was used.

## Deployment boundary still to complete

The existing App's `design-employee-authority` v1 is deployed with its own custom
employee-session authentication. It grants no customer/service/photo access.
The formal schema still lacks an authoritative stable customer/visit/employee
photo binding. The owner has confirmed responsible-employee-only upload and view;
the person permitted to confirm that binding is pending clarification. Management
authority must not automatically grant photo viewing.

`edge-ingress.mjs` and the explicitly configured client base path prepare the
existing fixed HTTP routes for `/functions/v1/design-api`. They are routing only,
remain default-closed and do not provision the original workflow's SQL, independent
receipts, private Storage adapter or a live Edge runtime. Preserve the original
App URL, existing login, booking sync and unrelated business functions. Complete
these integrations and actual authorized acceptance before enabling the App entry.

The owner configures model/API keys last; no key or model switch is enabled here.
