import fs from "node:fs";
import path from "node:path";

import {
  type Manifest,
  type Member,
  type MemberKind,
  readManifest,
  writeManifest,
  isWorkspace,
} from "./manifest.ts";
import { isInside, isValidName, realpathOrNull, RESERVED_NAMES } from "./paths.ts";

export interface AddOptions {
  /** Entry name inside the workspace. Defaults to the target's basename. */
  as?: string;
  /** Store a relative link instead of an absolute one. */
  relative?: boolean;
}

export interface AddResult {
  member: Member;
  alreadyMember: boolean;
  renamedFrom?: string;
}

export interface CreateResult {
  path: string;
  manifest: Manifest;
  created: boolean;
}

export type LinkState = "ok" | "missing" | "not-symlink" | "dangling" | "wrong-target";

export interface MemberStatus {
  member: Member;
  linkPath: string;
  linkState: LinkState;
  pointsTo: string | null;
}

export interface Issue {
  level: "error" | "warn" | "info";
  code: string;
  message: string;
  hint?: string;
}

export const MANIFEST_TEMPLATE_VERSION = 1;

export function createWorkspace(dir: string): CreateResult {
  const abs = path.resolve(dir);

  if (fs.existsSync(abs) && !fs.statSync(abs).isDirectory()) {
    throw new Error(`${abs} exists and is not a directory`);
  }
  if (isWorkspace(abs)) {
    return { path: abs, manifest: readManifest(abs), created: false };
  }

  fs.mkdirSync(abs, { recursive: true });
  const manifest: Manifest = {
    version: MANIFEST_TEMPLATE_VERSION,
    name: path.basename(abs),
    createdAt: new Date().toISOString(),
    members: [],
  };
  writeManifest(abs, manifest);
  return { path: abs, manifest, created: true };
}

export function addMember(ws: string, target: string, opts: AddOptions = {}): AddResult {
  if (!isWorkspace(ws)) {
    throw new Error(`${ws} is not a wsp workspace (run: wsp new ${path.basename(ws)} --ws ${path.dirname(ws)})`);
  }

  const realWs = realpathOrNull(ws);
  if (!realWs) throw new Error(`workspace does not exist: ${ws}`);

  const requestedTarget = path.resolve(target);
  const realTarget = realpathOrNull(requestedTarget);
  if (!realTarget) throw new Error(`target does not exist: ${requestedTarget}`);

  const stat = fs.statSync(realTarget);
  const kind: MemberKind = stat.isDirectory() ? "dir" : "file";
  if (kind === "file" && !stat.isFile()) {
    throw new Error(`unsupported target type (not a directory or regular file): ${realTarget}`);
  }

  if (realTarget === realWs) {
    throw new Error("cannot add a workspace to itself");
  }
  if (isInside(realWs, realTarget)) {
    throw new Error(`cannot add ${realTarget}: the workspace lives inside it, the link would point at its own parent`);
  }
  if (isInside(realTarget, realWs)) {
    throw new Error(`${realTarget} is already inside the workspace; it needs no link`);
  }

  const manifest = readManifest(ws);
  const existing = manifest.members.find((m) => m.target === realTarget);
  if (existing) {
    return { member: existing, alreadyMember: true };
  }

  const requested = opts.as ?? path.basename(realTarget);
  if (!isValidName(requested) || RESERVED_NAMES.has(requested)) {
    throw new Error(`invalid member name: ${JSON.stringify(requested)} (letters, digits, dot, dash, underscore)`);
  }

  const name = uniqueName(ws, manifest, requested);
  const linkPath = path.join(ws, name);
  assertPathFree(linkPath);

  const link = opts.relative ? path.relative(realWs, realTarget) : realTarget;
  fs.symlinkSync(link, linkPath, kind === "dir" ? "dir" : "file");

  const member: Member = {
    name,
    target: realTarget,
    link,
    kind,
    addedAt: new Date().toISOString(),
  };
  manifest.members.push(member);
  manifest.members.sort((a, b) => a.name.localeCompare(b.name));
  writeManifest(ws, manifest);

  return {
    member,
    alreadyMember: false,
    ...(name !== requested ? { renamedFrom: requested } : {}),
  };
}

export function removeMember(ws: string, name: string): Member {
  const manifest = readManifest(ws);
  const index = manifest.members.findIndex((m) => m.name === name);
  const linkPath = path.join(ws, name);
  const stat = lstatOrNull(linkPath);

  if (index === -1) {
    if (stat) {
      throw new Error(`${name} exists but is not managed by wsp; delete it yourself if you mean it`);
    }
    throw new Error(`no member named ${name}`);
  }

  if (stat && !stat.isSymbolicLink()) {
    const what = stat.isDirectory() ? "directory" : "file";
    throw new Error(`${linkPath} is a real ${what}, refusing to delete it; remove the entry from .wsp.json by hand`);
  }
  if (stat) fs.unlinkSync(linkPath);

  const removed = manifest.members.splice(index, 1)[0];
  writeManifest(ws, manifest);
  return removed as Member;
}

export function memberStatuses(ws: string): MemberStatus[] {
  const manifest = readManifest(ws);
  return manifest.members.map((member) => {
    const linkPath = path.join(ws, member.name);
    const stat = lstatOrNull(linkPath);

    if (!stat) {
      return { member, linkPath, linkState: "missing" as const, pointsTo: null };
    }
    if (!stat.isSymbolicLink()) {
      return { member, linkPath, linkState: "not-symlink" as const, pointsTo: null };
    }

    const raw = fs.readlinkSync(linkPath);
    const resolved = path.resolve(path.dirname(linkPath), raw);
    const real = realpathOrNull(resolved);
    if (!real) {
      return { member, linkPath, linkState: "dangling" as const, pointsTo: resolved };
    }
    if (real !== member.target) {
      return { member, linkPath, linkState: "wrong-target" as const, pointsTo: real };
    }
    return { member, linkPath, linkState: "ok" as const, pointsTo: real };
  });
}

export function doctor(ws: string): Issue[] {
  const issues: Issue[] = [];
  const manifest = readManifest(ws);
  const statuses = memberStatuses(ws);

  for (const status of statuses) {
    const { member, linkPath, linkState, pointsTo } = status;
    if (linkState === "missing") {
      issues.push({
        level: "error",
        code: "link-missing",
        message: `${member.name}: recorded in .wsp.json but the link is gone`,
        hint: `wsp rm ${member.name}  # drop the stale entry`,
      });
    } else if (linkState === "dangling") {
      issues.push({
        level: "error",
        code: "link-dangling",
        message: `${member.name}: link points to a missing path ${pointsTo ?? ""}`.trim(),
        hint: `restore the target, or: wsp rm ${member.name}`,
      });
    } else if (linkState === "not-symlink") {
      issues.push({
        level: "error",
        code: "link-replaced",
        message: `${member.name}: ${linkPath} is a real file or directory, not a symlink`,
        hint: "move it away and add it again",
      });
    } else if (linkState === "wrong-target") {
      issues.push({
        level: "error",
        code: "link-wrong-target",
        message: `${member.name}: link resolves to ${pointsTo}, manifest says ${member.target}`,
        hint: `wsp rm ${member.name} && wsp add ${member.target}`,
      });
    }
  }

  const managed = new Set(manifest.members.map((m) => m.name));
  for (const entry of readdirSafe(ws)) {
    if (!entry.isSymbolicLink() || managed.has(entry.name)) continue;
    issues.push({
      level: "warn",
      code: "unmanaged-link",
      message: `${entry.name}: symlink not recorded in .wsp.json`,
      hint: `wsp add ${path.join(ws, entry.name)} --as ${entry.name}`,
    });
  }

  const seen = new Map<string, string>();
  for (const member of manifest.members) {
    const previous = seen.get(member.target);
    if (previous) {
      issues.push({
        level: "warn",
        code: "duplicate-target",
        message: `${member.name} and ${previous} point to the same target`,
      });
    }
    seen.set(member.target, member.name);
  }

  if (fs.existsSync(path.join(ws, ".git"))) {
    issues.push({
      level: "warn",
      code: "git-at-root",
      message: "the workspace root is a git repository; members are stored as symlink blobs, not as content",
      hint: "edits inside members are invisible to git here; commit each member in its own repository",
    });
  }

  const gitMembers = manifest.members.filter((m) => fs.existsSync(path.join(m.target, ".git")));
  if (gitMembers.length > 0) {
    issues.push({
      level: "info",
      code: "git-members",
      message: `${gitMembers.length} member(s) are git repositories; run git inside each member`,
      hint: gitMembers.map((m) => m.name).join(", "),
    });
  }

  const nested = manifest.members.filter((m) => fs.existsSync(path.join(m.target, ".wsp.json")));
  for (const member of nested) {
    issues.push({
      level: "warn",
      code: "nested-workspace",
      message: `${member.name} is itself a wsp workspace`,
    });
  }

  issues.push({
    level: "info",
    code: "search-follow",
    message: "recursive search must follow symlinks: rg --follow (ripgrep skips them by default)",
  });

  return issues;
}

function readdirSafe(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function assertPathFree(p: string): void {
  const stat = lstatOrNull(p);
  if (!stat) return;
  if (stat.isSymbolicLink()) {
    throw new Error(`${p} already exists as a symlink that wsp does not manage; remove it first`);
  }
  throw new Error(`${p} already exists; pick another name with --as`);
}

function uniqueName(ws: string, manifest: Manifest, base: string): string {
  const taken = new Set(manifest.members.map((m) => m.name));
  if (!taken.has(base) && !lstatOrNull(path.join(ws, base))) return base;

  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate) && !lstatOrNull(path.join(ws, candidate))) return candidate;
  }
  throw new Error(`cannot find a free name for ${base}`);
}
