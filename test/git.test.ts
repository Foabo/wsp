import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describeGit, readGitInfo, relativeTime } from "../src/core/git.ts";

const roots: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wsp-git-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): void {
  execFileSync("git", ["-C", dir, "-c", "user.email=a@b", "-c", "user.name=a", ...args], {
    stdio: "ignore",
  });
}

function repo(branch = "main"): string {
  const dir = tmp();
  execFileSync("git", ["init", "-q", "-b", branch, dir]);
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
}

describe("readGitInfo", () => {
  test("reads branch, sha and commit time", async () => {
    const dir = repo();
    const info = await readGitInfo(dir);

    expect(info?.branch).toBe("main");
    expect(info?.shortSha).toMatch(/^[0-9a-f]{7,}$/);
    expect(info?.empty).toBe(false);
    expect(info?.committedAt).toBeGreaterThan(0);
  });

  test("reports a detached HEAD without a branch", async () => {
    const dir = repo();
    git(dir, "checkout", "-q", "--detach");
    const info = await readGitInfo(dir);

    expect(info?.branch).toBeNull();
    expect(info?.shortSha).not.toBeNull();
  });

  test("marks a repository without commits", async () => {
    const dir = tmp();
    execFileSync("git", ["init", "-q", dir]);
    const info = await readGitInfo(dir);

    expect(info?.empty).toBe(true);
    expect(info?.committedAt).toBeNull();
  });

  test("returns null outside a repository", async () => {
    expect(await readGitInfo(tmp())).toBeNull();
  });
});

describe("describeGit", () => {
  const now = 1_800_000_000;

  test("formats a branch with a relative age", () => {
    expect(describeGit({ branch: "main", shortSha: "abc1234", committedAt: now - 7200, empty: false }, now)).toBe(
      "main 2h",
    );
  });

  test("formats a detached head", () => {
    expect(describeGit({ branch: null, shortSha: "abc1234", committedAt: now - 60, empty: false }, now)).toBe(
      "@abc1234 1m",
    );
  });

  test("formats empty and missing repositories", () => {
    expect(describeGit({ branch: null, shortSha: null, committedAt: null, empty: true }, now)).toBe("(empty)");
    expect(describeGit(null, now)).toBe("-");
  });
});

describe("relativeTime", () => {
  const now = 1_800_000_000;

  test("buckets seconds into minutes, hours, days and dates", () => {
    expect(relativeTime(now - 5, now)).toBe("now");
    expect(relativeTime(now - 300, now)).toBe("5m");
    expect(relativeTime(now - 7200, now)).toBe("2h");
    expect(relativeTime(now - 86_400 * 3, now)).toBe("3d");
    expect(relativeTime(now - 86_400 * 90, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("clamps future timestamps to now", () => {
    expect(relativeTime(now + 500, now)).toBe("now");
  });
});
