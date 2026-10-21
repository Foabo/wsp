import fs from "node:fs";
import path from "node:path";

import { MANIFEST_FILE } from "./paths.ts";

export type MemberKind = "dir" | "file";

export interface Member {
  /** Directory entry name inside the workspace. */
  name: string;
  /** Absolute real path of the linked target. */
  target: string;
  /** Exact string stored in the symlink (absolute, or relative with --relative). */
  link: string;
  kind: MemberKind;
  addedAt: string;
}

export interface Manifest {
  version: 1;
  name: string;
  createdAt: string;
  members: Member[];
}

export function manifestPath(ws: string): string {
  return path.join(ws, MANIFEST_FILE);
}

export function isWorkspace(dir: string): boolean {
  return fs.existsSync(manifestPath(dir));
}

export function readManifest(ws: string): Manifest {
  const file = manifestPath(ws);
  if (!fs.existsSync(file)) {
    throw new Error(`${ws} is not a wsp workspace (missing ${MANIFEST_FILE})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`cannot parse ${file}`);
  }

  const doc = parsed as Partial<Manifest>;
  if (doc.version !== 1) {
    throw new Error(`${file}: unsupported manifest version ${String(doc.version)}`);
  }

  return {
    version: 1,
    name: typeof doc.name === "string" && doc.name ? doc.name : path.basename(ws),
    createdAt: typeof doc.createdAt === "string" ? doc.createdAt : new Date().toISOString(),
    members: Array.isArray(doc.members) ? doc.members.filter(isMember) : [],
  };
}

function isMember(value: unknown): value is Member {
  const m = value as Partial<Member>;
  return typeof m?.name === "string" && typeof m?.target === "string" && typeof m?.link === "string";
}

/** Writes through a temp file so an interrupted run cannot truncate the manifest. */
export function writeManifest(ws: string, manifest: Manifest): void {
  const file = manifestPath(ws);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
