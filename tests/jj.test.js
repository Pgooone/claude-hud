import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isJjRepo, getJjStatus } from '../dist/jj.js';

function hasJj() {
  try {
    execFileSync('jj', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const jjAvailable = hasJj();
const skipReason = jjAvailable ? false : 'jj binary not installed';

test('isJjRepo returns false when cwd is undefined', () => {
  assert.equal(isJjRepo(undefined), false);
});

test('isJjRepo returns false for a non-jj directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-nojj-'));
  try {
    assert.equal(isJjRepo(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getJjStatus returns null when cwd is undefined', async () => {
  const result = await getJjStatus(undefined);
  assert.equal(result, null);
});

test('getJjStatus returns null for a non-jj directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-nojj-'));
  try {
    const result = await getJjStatus(dir);
    assert.equal(result, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('isJjRepo and getJjStatus detect a real jj repo', { skip: skipReason }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-jj-'));
  try {
    execFileSync('jj', ['git', 'init'], { cwd: dir, stdio: 'ignore' });

    assert.equal(isJjRepo(dir), true);

    const result = await getJjStatus(dir);
    assert.equal(result?.vcs, 'jj');
    assert.equal(result?.conflict, false);
    assert.equal(result?.isDirty, false);
    assert.ok(result?.branch, `expected an anonymous change id, got ${JSON.stringify(result)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getJjStatus reports isDirty after an uncommitted change', { skip: skipReason }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-jj-'));
  try {
    execFileSync('jj', ['git', 'init'], { cwd: dir, stdio: 'ignore' });
    await writeFile(path.join(dir, 'a.txt'), 'hello');

    const result = await getJjStatus(dir);
    assert.equal(result?.isDirty, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getJjStatus reports the bookmark name at @ when one exists', { skip: skipReason }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-jj-'));
  try {
    execFileSync('jj', ['git', 'init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('jj', ['bookmark', 'create', 'mybookmark', '-r', '@'], { cwd: dir, stdio: 'ignore' });

    const result = await getJjStatus(dir);
    assert.equal(result?.branch, 'mybookmark');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('isJjRepo detects a jj repo from a nested subdirectory', { skip: skipReason }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-jj-'));
  try {
    execFileSync('jj', ['git', 'init'], { cwd: dir, stdio: 'ignore' });
    const nested = path.join(dir, 'a', 'b', 'c');
    execFileSync('mkdir', ['-p', nested]);

    assert.equal(isJjRepo(nested), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getJjStatus detects a genuine conflict', { skip: skipReason }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-jj-'));
  try {
    execFileSync('jj', ['git', 'init'], { cwd: dir, stdio: 'ignore' });
    await writeFile(path.join(dir, 'f.txt'), 'original\n');
    execFileSync('jj', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'ignore' });

    const initialId = execFileSync(
      'jj',
      ['log', '-r', 'heads(::@- ~ root())', '--no-graph', '-T', 'change_id.shortest(8)'],
      { cwd: dir, encoding: 'utf8' }
    ).trim();

    execFileSync('jj', ['new', initialId, '-m', 'A'], { cwd: dir, stdio: 'ignore' });
    await writeFile(path.join(dir, 'f.txt'), 'A-version\n');
    const aId = execFileSync('jj', ['log', '-r', '@', '--no-graph', '-T', 'change_id.shortest(8)'], { cwd: dir, encoding: 'utf8' }).trim();

    execFileSync('jj', ['new', initialId, '-m', 'B'], { cwd: dir, stdio: 'ignore' });
    await writeFile(path.join(dir, 'f.txt'), 'B-version\n');
    const bId = execFileSync('jj', ['log', '-r', '@', '--no-graph', '-T', 'change_id.shortest(8)'], { cwd: dir, encoding: 'utf8' }).trim();

    execFileSync('jj', ['rebase', '-r', bId, '-d', aId], { cwd: dir, stdio: 'ignore' });
    execFileSync('jj', ['edit', bId], { cwd: dir, stdio: 'ignore' });

    const result = await getJjStatus(dir);
    assert.equal(result?.conflict, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
