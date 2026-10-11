# Electronic daily posting v624

Scope: user-authorized electronic-source evidence alternative for unposted synced drafts only. The original-photo path, formulas, RLS, collectors, historical records and amounts are unchanged. No real day is confirmed during deployment.

## Preconditions and evidence

- Active scoped finance identity, normal report upload/voucher review authority, unlocked day and exact draft revision.
- Server-held detail snapshot must match the draft and current shop/date head. Source bill identifiers and posted cents must still match the current consumption list.
- Source-only cash snapshots do not become verified facts. Finance explicitly verifies channels, card-sale receipts and blanks. Missing numeric controls and unequal totals remain blockers.
- Server generates an XLSX marked electronic evidence, not a paper/photo original. It includes source snapshot identifiers/hashes and reviewed cells, without customer names/phones/source payloads. Original immutable source records remain in private database storage.
- Before posting, database locks and rechecks source/cell hashes and authority. The approved archive, audit, source link, cash review and existing ledger posting are one transaction. No financial cell is rewritten by the new RPC.

## Release and rollback

1. Recovery: branch `recovery/pre-electronic-post-20261011`, daily code archive, private untracked production Edge v124 package. This is not a full database/Storage disaster-recovery backup.
2. Run shared pre-push gate including original and electronic synthetic database/browser cases. Type-check Edge. Confirm no real mutations or production data fixtures.
3. Apply only `20261011043138_zysyr_electronic_daily_post.sql` (two new service-only RPCs); no existing definitions replaced. Verify anon/authenticated have no EXECUTE and baseline ledger counts/amount fingerprints do not change during migration.
4. Deploy operations-api preserving the existing bundled dependencies and JWT setting; verify function source and unauthorized request rejection. Publish Pages v624 only after gates succeed; never refresh an active user's dirty form.
5. User confirms their real day after refreshing safely. Deployment cannot certify live posting without that acceptance.

Forward rollback: revoke service_role EXECUTE on the two new RPCs to close electronic posting, restore the backed-up Edge package, then publish the previous frontend under a higher version. Keep all generated evidence/audit/history; never delete or roll back real approved reports. No reverse data migration is required. Failed storage copies may remain unreferenced; do not delete them without proving absence of all references.
