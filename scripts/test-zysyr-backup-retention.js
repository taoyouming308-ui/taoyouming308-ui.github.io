#!/usr/bin/env node
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const backupScript = path.join(repoRoot, 'scripts', 'backup-zysyr.sh');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zysyr-backup-retention-'));
const oldMtime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

function makeFixture(name, icloudTarget) {
  const root = path.join(tempRoot, name);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backups', 'daily'), { recursive: true });
  fs.copyFileSync(backupScript, path.join(root, 'scripts', 'backup-zysyr.sh'));
  fs.writeFileSync(path.join(root, 'README.md'), `fixture ${name}\n`);
  fs.writeFileSync(
    path.join(root, 'scripts', 'backup.env'),
    `ICLOUD_BACKUP_DIR="${icloudTarget}"\n`,
  );
  const staleLocal = path.join(root, 'backups', 'daily', 'ZYSYR_2000-01-01_000000.tar.gz');
  fs.writeFileSync(staleLocal, 'old local archive');
  fs.utimesSync(staleLocal, oldMtime, oldMtime);
  return { root, staleLocal };
}

function runBackup(root) {
  return spawnSync('bash', [path.join(root, 'scripts', 'backup-zysyr.sh')], {
    encoding: 'utf8',
    timeout: 30_000,
  });
}

try {
  const goodCloud = path.join(tempRoot, 'cloud-good');
  const successful = makeFixture('successful', goodCloud);
  const success = runBackup(successful.root);
  assert.equal(success.status, 0, `expected successful backup:\n${success.stderr}`);
  assert.equal(fs.existsSync(successful.staleLocal), false, 'old local archive should be pruned after verified copy');
  const localArchive = fs.readdirSync(path.join(successful.root, 'backups', 'daily'))
    .find((name) => name.endsWith('.tar.gz'));
  const cloudDir = path.join(goodCloud, 'daily');
  const cloudArchive = fs.readdirSync(cloudDir).find((name) => name.endsWith('.tar.gz'));
  assert.ok(localArchive, 'new local archive should exist');
  assert.equal(cloudArchive, localArchive, 'cloud copy should use the same archive name');
  assert.deepEqual(
    fs.readFileSync(path.join(successful.root, 'backups', 'daily', localArchive)),
    fs.readFileSync(path.join(cloudDir, cloudArchive)),
    'verified cloud copy should match local archive byte-for-byte',
  );

  const cloudBlocker = path.join(tempRoot, 'cloud-is-a-file');
  fs.writeFileSync(cloudBlocker, 'not a directory');
  const failedCloud = makeFixture('failed-cloud', cloudBlocker);
  const failure = runBackup(failedCloud.root);
  assert.notEqual(failure.status, 0, 'cloud destination failure should fail the backup command');
  assert.equal(
    fs.existsSync(failedCloud.staleLocal),
    true,
    'old local archive must remain when cloud copy cannot be created or verified',
  );
  assert.ok(
    fs.readdirSync(path.join(failedCloud.root, 'backups', 'daily'))
      .some((name) => name.endsWith('.tar.gz') && name !== path.basename(failedCloud.staleLocal)),
    'new local archive should remain recoverable after cloud failure',
  );

  console.log('Backup retention regression passed: prune only after verified destination copy.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
