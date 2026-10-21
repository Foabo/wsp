import fs from "node:fs";
import path from "node:path";

import { readManifest } from "./manifest.ts";

/** Directories that never hold a workspace worth listing. */
const SKIP = new Set(["node_modules", "dist", ".git", ".cache", "target", "vendor"]);

const MAX_DEPTH = 3;
const MAX_DIRS = 20000;

export interface WorkspaceEntry {
  /** Entry name of the workspace directory. */
  name: string;
  /** Absolute path of the workspace. */
  path: string;
  /** Path relative to the scanned root, "." for the root itself. */
  relative: string;
  members: number;
  /** Manifest mtime, ISO string. */
  updatedAt: string;
  /** Set when the manifest exists but cannot be read. */
  broken?: string;
}

/**
 * Walks `root` looking for `.wsp.json`, newest manifest first.
 * Symlinked directories are skipped, and a found workspace is not descended
 * into: members are repositories, not places to look for more workspaces.
 */
export function scanWorkspaces(root: string): WorkspaceEntry[] {
  const abs = path.resolve(root);
  if (!fs.existsSync(abs)) {
    throw new Error(`root does not exist: ${abs} (run: wsp setup <dir>)`);
  }
  if (!fs.statSync(abs).isDirectory()) {
    throw new Error(`root is not a directory: ${abs}`);
  }

  const found: WorkspaceEntry[] = [];
  let visited = 0;

  const walk = (dir: string, depth: number): void => {
    visited += 1;
    if (visited > MAX_DIRS) return;

    if (fs.existsSync(path.join(dir, ".wsp.json"))) {
      found.push(describe(abs, dir));
      return;
    }
    if (depth >= MAX_DEPTH) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue; // isDirectory() is false for symlinks
      if (SKIP.has(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };

  walk(abs, 0);
  found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return found;
}

export function findWorkspace(root: string, name: string): WorkspaceEntry {
  const matches = scanWorkspaces(root).filter((entry) => entry.relative === name || entry.name === name);

  if (matches.length === 0) {
    throw new Error(`no workspace named ${name} under ${root}`);
  }
  if (matches.length > 1) {
    throw new Error(`ambiguous name ${name}: ${matches.map((entry) => entry.relative).join(", ")}`);
  }
  return matches[0] as WorkspaceEntry;
}

function describe(root: string, dir: string): WorkspaceEntry {
  const relative = path.relative(root, dir) || ".";
  const stat = fs.statSync(path.join(dir, ".wsp.json"));

  try {
    const manifest = readManifest(dir);
    return {
      name: path.basename(dir),
      path: dir,
      relative,
      members: manifest.members.length,
      updatedAt: stat.mtime.toISOString(),
    };
  } catch (error) {
    return {
      name: path.basename(dir),
      path: dir,
      relative,
      members: 0,
      updatedAt: stat.mtime.toISOString(),
      broken: error instanceof Error ? error.message : String(error),
    };
  }
}
