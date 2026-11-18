# Streaming recovery — DPR2, unpublished local qualification

The offline CLI now writes DPR2 and auto-detects DPR2/DPR1 on restore. Existing
DPR1 buffer APIs and file format are unchanged. The snapshot layout, protected
independent recovery key, exact namespace, no-overwrite rules and prohibition on
live capture/SQL execution remain in [OFFLINE-RECOVERY.md](OFFLINE-RECOVERY.md).
No server, model, scheduler or cloud operation starts on import.

## Streaming and authentication

DPR2 uses one standard AES-256-GCM stream, a fresh 32-byte HKDF salt and 12-byte
IV per archive, and a v2-specific HKDF key domain. Magic/salt/IV and the exact
logical storage origin are authenticated as AAD. The encrypted body contains a
bounded JSON manifest followed by its sorted file payloads; a final 16-byte GCM
tag authenticates the whole envelope. File names, lengths and hashes are inside
the encrypted body. This is not independent unauthenticated chunk encryption.

Capture first hashes files into the manifest, then reads them again in <=1MiB
chunks during encryption. File device/inode/size/owner/mode/link count and
nanosecond modification/change times must still match, and file hashes are
checked again before publication. The directory listing must remain exact.
The caller must still stop every writer; file checks do not establish that a
DB dump, globals and objects came from a matching live point in time.

GCM update output must not be trusted before final authentication. Restore uses
two passes over the same open archive: first decrypt/hash/discard all plaintext
and verify the tag; only then parse metadata and create a new private target.
The second pass streams each file, checks its hash, authenticates the tag again
and requires its whole plaintext digest to match the first pass. No plaintext
temporary archive is created. A changed/tampered/truncated/trailing envelope is
refused; after a second-pass failure only the newly created target is removed.
Unknown cleanup/publication remains explicit. Same-UID host compromise and host
administrator WORM protection are outside this private-file boundary.

Limits in `STREAM_RECOVERY_LIMITS`: 16GiB total payload, 8GiB DB archive, 16MiB
roles SQL, 10,000 object files, <=8MiB+2048 per encrypted original and a 2MiB
manifest. These are format/resource refusal bounds, not demonstrated production
capacity. Streaming buffers are <=1MiB plus the bounded manifest. The original
DPR1 reader keeps its 64MiB/128-object limits; old archives need no conversion.

SIGINT/SIGTERM in the DPR2 CLI abort at explicit I/O boundaries, clear the
temporary key and clean the operation's own pending archive or new extraction
target. It emits `DESIGN_RECOVERY_CANCELLED`; uncertain cleanup/publication takes
precedence. It never deletes an already existing destination. The legacy DPR1
reader retains its bounded implementation; immediate in-progress cancellation
is only qualified for DPR2. SIGKILL/power-loss cleanup and interrupted pending
artifact review remain operator work, not an automatic deletion policy.

The existing `design-offline-recovery.mjs pack/unpack` command syntax is unchanged.
Its result now reports the detected format and DPR2 payload bytes; it never
executes SQL. Key values remain outside arguments, logs and source.

## Evidence

The explicit scale script runs with a 64MiB V8 heap in a separate process. It
captures >1GiB of opaque synthetic payload across 259 files/256 objects, packs,
removes the source, restores and streams verification of every file hash. Peak
process RSS must stay below 256MiB. It also cancels actual CLI packing after its
temporary archive exists and actual extraction after its new target exists,
requiring cleanup with no published/partial output. Test data and wrapping key
are removed afterwards. It checks free space before starting and never cleans
unknown files to make room.

The scale fixture's `PGDMP`/`DPO1` payloads are deliberately synthetic opaque
bytes; they are not proof of a large valid database or encrypted media restore.
The separate original phone/backend test with `--full-recovery --stream-recovery`
uses actual PG17 custom/roles exports and native-codec HEIC/HEIF media. It destroys
the original synthetic DB/objects/master before restoring a new empty container,
then retains all role/ACL/RLS, employee, archive, wrong-key/receipt, revocation
and unchanged 30-second HTTP assertions. Test identity/receipt issuance is still
finite and is not a production authority. The synthetic image broker is reused.

```sh
npm run test:design-stream-recovery
npm run test:design-stream-recovery-scale -- --work-root /absolute/private/test-work
npm run test:design-stream-recovery-postgres -- --work-root /absolute/private/phone-work
```

No target Linux server, real independent authority, public HTTPS certificate,
off-host escrow/recovery, retention/deletion, physical iPhone or paid-model
acceptance is implied. Do not publish this local version reservation without
current-main reconciliation and complete protected release checks.

References: [Node authenticated decryption](https://nodejs.org/docs/latest-v22.x/api/crypto.html#decipherfinaloutputencoding),
[Node file identity/timestamps](https://nodejs.org/docs/latest-v22.x/api/fs.html#statsmtimens).
