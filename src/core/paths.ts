import fs from "node:fs";
import path from "node:path";

/** Name of the manifest file that marks a directory as a wsp workspace. */
export const MANIFEST_FILE = ".wsp.json";

/** Managed block markers inside AGENTS.md. */
export const AGENTS_BEGIN = "<!-- wsp:begin -->";
export const AGENTS_END = "<!-- wsp:end -->";

/** Returns the real path, or null when the path does not exist. */
export function realpathOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** Walks up from `start` until it finds a directory containing the manifest. */
export function findWorkspaceRoot(start: string): string | null {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, MANIFEST_FILE))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * True when `child` is `parent` or lives underneath it.
 * Both arguments must already be absolute; callers should pass real paths.
 */
export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Member names become path segments, so keep them boring. */
export function isValidName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes("/");
}

/** Rejects names that would collide with files wsp manages itself. */
export const RESERVED_NAMES = new Set([MANIFEST_FILE, "AGENTS.md", "CLAUDE.md"]);
