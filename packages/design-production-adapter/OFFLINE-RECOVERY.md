# Offline DB/object/master recovery — local qualification

Stage44 seals a previously captured, matching offline snapshot in one
authenticated encrypted envelope: a custom PostgreSQL archive, password-free
roles SQL, encrypted original objects and their private-media master. A separate
32-byte recovery key wraps the set. It must differ from the media master and is
never stored inside the envelope. It is unrelated to a model API key.

The utility has no DB client, SQL execution, cloud credentials, listener,
scheduler or retention deletion. It cannot stop writers or make arbitrary live
copies consistent. Before capture, stop every writer, confirm draining and
resolve uncertain writes by original request-ID readback. Keep writes stopped
through DB/roles export and object/key capture. Importing the module does no I/O.

## Private prepared snapshot

Use a new owner-only 0700 snapshot directory with exactly:

```text
snapshot/
  database.dump          # pg_dump --format=custom --create, 0600
  roles.sql              # pg_dumpall --roles-only --no-role-passwords, 0600
  objects/               # 0700; <64 lowercase hex>.object files, 0600
  secrets/               # 0700
    master-key.bin       # original 32-byte private-media master, 0600
```

Keep a separate 0700 key directory with `recovery-key.bin` (32 random bytes,
0600). Provision it through the host's protected secret channel, outside source,
command-line values, screenshots and chat. Paths are not key values. The utility
refuses links, unsafe permissions, unexpected files, duplicate/unsupported names
and oversized sets. File identity/timestamp checks and a second snapshot read
detect mutation; they do not replace stopping all writers.

Limits: 128 objects, 64MiB total plaintext; DB <=32MiB, roles <=2MiB, each object
<=8MiB+2048. Larger stores are refused; no streaming/large-store acceptance is
claimed. Fixed names, lengths and SHA256 hashes are encrypted with the contents.
AES-256-GCM and a separate HKDF domain bind the envelope to its storage origin.
The `.supabase.co` value is the local object's original AAD namespace; no cloud
request is sent. A different namespace requires a separate reviewed migration.

```sh
node scripts/design-offline-recovery.mjs pack \
  --snapshot /absolute/private-snapshot \
  --file /absolute/private-backups/reviewed.recovery \
  --key-directory /absolute/private-recovery-key \
  --origin https://your-fixed-namespace.supabase.co

node scripts/design-offline-recovery.mjs unpack \
  --file /absolute/private-backups/reviewed.recovery \
  --target /absolute/private-parent/new-restore \
  --key-directory /absolute/private-recovery-key \
  --origin https://your-fixed-namespace.supabase.co
```

Output parents must be owner-only 0700. Pack creates a new 0600 file with
create-only link/fsync. Unpack authenticates the complete envelope before
creating a new 0700 target. Existing files/targets are refused, including empty
directories. Extraction errors remove only the newly created target; cleanup
uncertainty is explicit. Publication uncertainty must not trigger an automatic
retry. After an interrupted pack, retain the original snapshot and inspect only
the exact new destination/pending artifact; do not assume the backup is usable.

## DB restore and verification

Unpack never executes SQL. An administrator must review a trusted archive and
restore only into an isolated new cluster with matching PostgreSQL tools.
Password-free roles deliberately exclude LOGIN passwords; those, TLS identities
and recovery-key escrow require separate secure provisioning. Tablespaces and
other databases are outside this format. The test-only recovery helper cannot
target a real host. It skips exactly the duplicate `CREATE ROLE postgres` needed
by fresh initdb, retains its ALTER and permits no other restore error.

Compare role flags/memberships, DB/schema owners and privileges, default ACLs,
relation owners/privileges, function definitions/owners/privileges and RLS
flags/policies. PostgreSQL may reorder ACL text or replace an explicit default
with NULL. The test uses `acldefault`/`aclexplode` to compare each effective
grantor, grantee, privilege and grant-option. It deliberately adds PUBLIC SELECT
and BYPASSRLS, requires detection, then restores the exact effective contract
before backend startup. It does not ignore privilege differences.

Reissue independent current photo authority after restart. Verify each original
hash and immutable archive, correct/wrong employee/scope/session/receipt,
post-processing revocation and same-ID conflicts. Wrong wrapping keys must
create no target. Wrong media masters must return no image or alter objects.
The finite synthetic receipt issuer is not a deployable authority.

## Local evidence and remaining limits

The drill closes writers, captures actual PG17 DB/roles, encrypts the set,
destroys the original DB and removes original objects/master/plaintext snapshot,
then restores into a separate empty network-none PG17 container. The restricted
runtime and original employee UI recover six native-codec HEIC/HEIF-inclusive
synthetic references and a full immutable archive. Original hashes, authorization
denials and the unchanged 30-second budget remain required. Zero model keys are
seeded; test keys/files and containers are cleaned.

Real host/identity/receipt provisioning, hosted permissions, HTTPS ingress,
broker-host/TLS recovery, independent off-host backup/escrow, monitoring,
retention/deletion and a physical iPhone session remain unaccepted. The drill
reuses its synthetic image broker. No production SQL, sync job, real customer
photo, real credential or paid API is operated.

References: [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html),
[pg_dumpall](https://www.postgresql.org/docs/17/app-pg-dumpall.html),
[pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html),
[ACL functions](https://www.postgresql.org/docs/17/functions-info.html).
