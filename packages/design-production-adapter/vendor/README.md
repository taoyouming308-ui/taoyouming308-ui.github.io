# Hosted image components

The HEIF library is libheif-js **1.23.5**, LGPL-3.0. Its unmodified embedded-WASM
ES module is loaded dynamically for each private job. The application may be
recombined with an interface-compatible replacement at the same module boundary.
LGPL and GPL license texts accompany it. Library sources and build instructions:

- Wrapper: https://github.com/catdad-experiments/libheif-js/tree/d8ec4bc3bc5bf8055975577bccbbc7e1d7313c2d
- WASM build: https://github.com/catdad-experiments/libheif-emscripten/tree/v1.23.5
- Exact libheif submodule: https://github.com/strukturag/libheif/tree/413e2a87e6a70b3eccc3a3adc5801179dd2d9e00

JPEG encoding/decoding uses jpeg-js **0.4.4**. The upstream Adobe BSD-style encoder
notice and Apache-2.0 decoder notice are retained verbatim, alongside the upstream
license. The original CJS files remain here. `scripts/prepare-design-hosted-codecs.mjs`
checks pinned hashes and verifies the only ESM shim changes: an explicit Buffer
import and replacement of the CJS/browser export block by an ESM default export.

PNG verification uses Pako **2.1.0**, unmodified ESM distribution. Its MIT license
and embedded zlib-origin notices are retained. Sources: https://github.com/nodeca/pako/tree/2.1.0

`codec-provenance.json` records registry integrity and individual file hashes.
No downloaded package lifecycle script is executed. The application loads no
codec binary or plugin over the network. These notices describe the actual
components and replacement boundary; they do not activate photo access or AI.
