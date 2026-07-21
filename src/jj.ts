import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDebug } from './debug.js';
import type { GitStatus } from './git.js';

const debug = createDebug('jj');
const execFileAsync = promisify(execFile);

// Defensive bound against pathological/symlink cases; real repo trees never
// nest this deep.
const MAX_WALK_DEPTH = 64;

/**
 * Cheap, synchronous, subprocess-free check: walk upward from cwd looking for
 * a `.jj` directory, the same way jj's own CLI locates a repo root. Runs
 * before any subprocess is spawned so non-jj users pay ~zero cost per
 * invocation (a few fs.statSync calls, never an execFile).
 */
export function isJjRepo(cwd?: string): boolean {
  if (!cwd) return false;

  let dir = path.resolve(cwd);
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    try {
      if (fs.statSync(path.join(dir, '.jj')).isDirectory()) return true;
    } catch {
      // no .jj here; keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return false;
}

// Four \x1f-delimited fields collected in a single `jj log` call:
//   change id (short) | bookmarks at @ | dirty flag | conflict flag
const JJ_TEMPLATE = [
  'change_id.shortest(8)',
  '"\\x1f"',
  'self.bookmarks().join(",")',
  '"\\x1f"',
  'if(self.empty(), "0", "1")',
  '"\\x1f"',
  'if(self.conflict(), "1", "0")',
].join(' ++ ');

export async function getJjStatus(cwd?: string): Promise<GitStatus | null> {
  if (!cwd) return null;

  try {
    const { stdout } = await execFileAsync(
      'jj',
      ['log', '-r', '@', '--no-graph', '--color', 'never', '-T', JJ_TEMPLATE],
      { cwd, timeout: 2000, encoding: 'utf8', windowsHide: true }
    );

    const [changeId, bookmarksRaw, dirtyFlag, conflictFlag] = stdout.trim().split('\x1f');
    if (!changeId) return null;

    const bookmarks = bookmarksRaw ? bookmarksRaw.split(',').filter(Boolean) : [];

    return {
      branch: bookmarks[0] ?? changeId,
      isDirty: dirtyFlag === '1',
      ahead: 0,
      behind: 0,
      vcs: 'jj',
      conflict: conflictFlag === '1',
    };
  } catch (err) {
    // Covers: jj binary missing (ENOENT), not in a jj repo, or a template
    // incompatible with the installed jj version — all treated the same as
    // git.ts's failure handling: return null, render nothing.
    debug('getJjStatus failed (jj missing/incompatible?):', err instanceof Error ? err.message : err);
    return null;
  }
}
