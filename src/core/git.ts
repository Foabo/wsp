import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface GitInfo {
  /** Current branch, null when HEAD is detached. */
  branch: string | null;
  shortSha: string | null;
  /** Commit time, epoch seconds. */
  committedAt: number | null;
  /** Repository exists but has no commits yet. */
  empty: boolean;
}

/**
 * One `git log` per repository. Returns null when the directory is not a
 * working tree, and `{ empty: true }` when it is but has no commits.
 */
export async function readGitInfo(dir: string): Promise<GitInfo | null> {
  try {
    const { stdout } = await run("git", ["-C", dir, "log", "-1", "--format=%ct%x00%D%x00%h"], {
      timeout: 1500,
    });
    const [time, refs = "", sha = ""] = stdout.trim().split("\0");
    const branch = /HEAD -> ([^,]+)/.exec(refs)?.[1]?.trim() ?? null;
    const committedAt = Number.parseInt(time ?? "", 10);
    return {
      branch,
      shortSha: sha || null,
      committedAt: Number.isFinite(committedAt) ? committedAt : null,
      empty: false,
    };
  } catch {
    // No commits and not a repository both exit non-zero; tell them apart.
    const isRepo = await run("git", ["-C", dir, "rev-parse", "--git-dir"], { timeout: 1500 })
      .then(() => true)
      .catch(() => false);
    return isRepo ? { branch: null, shortSha: null, committedAt: null, empty: true } : null;
  }
}

/** Compact one-line form: "main 2h", "@1a2b3c 4d", "(empty)", "-". */
export function describeGit(info: GitInfo | null, now = Date.now() / 1000): string {
  if (!info) return "-";
  if (info.empty) return "(empty)";
  const label = info.branch ?? (info.shortSha ? `@${info.shortSha}` : "?");
  return `${label} ${relativeTime(info.committedAt, now)}`;
}

export function relativeTime(at: number | null, now = Date.now() / 1000): string {
  if (at === null) return "?";
  const seconds = Math.max(0, now - at);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86_400 * 30) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(at * 1000).toISOString().slice(0, 10);
}
