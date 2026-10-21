import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createWorkspace } from "../src/core/workspace.ts";
import { findWorkspace, scanWorkspaces } from "../src/core/registry.ts";

const roots: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wsp-registry-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function stamp(dir: string, iso: string): void {
  const date = new Date(iso);
  fs.utimesSync(path.join(dir, ".wsp.json"), date, date);
}

describe("scanWorkspaces", () => {
  test("finds workspaces at the root and in subdirectories", () => {
    const root = tmp();
    createWorkspace(path.join(root, "a"));
    createWorkspace(path.join(root, "team", "b"));
    fs.mkdirSync(path.join(root, "plain"), { recursive: true });

    const relative = scanWorkspaces(root).map((entry) => entry.relative).sort();
    expect(relative).toEqual(["a", path.join("team", "b")]);
  });

  test("does not descend into a workspace", () => {
    const root = tmp();
    const outer = createWorkspace(path.join(root, "outer")).path;
    createWorkspace(path.join(outer, "inner"));

    const relative = scanWorkspaces(root).map((entry) => entry.relative);
    expect(relative).toEqual(["outer"]);
  });

  test("ignores symlinked directories", () => {
    const root = tmp();
    const outside = tmp();
    createWorkspace(path.join(outside, "linked"));
    fs.symlinkSync(path.join(outside, "linked"), path.join(root, "linked"), "dir");

    expect(scanWorkspaces(root)).toHaveLength(0);
  });

  test("reports a broken manifest without failing the scan", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "broken"));
    fs.writeFileSync(path.join(root, "broken", ".wsp.json"), "{not json");
    createWorkspace(path.join(root, "fine"));

    const entries = scanWorkspaces(root);
    const broken = entries.find((entry) => entry.name === "broken");
    expect(broken?.broken).toContain("cannot parse");
    expect(entries.find((entry) => entry.name === "fine")?.broken).toBeUndefined();
  });

  test("counts members and sorts by manifest time, newest first", () => {
    const root = tmp();
    const old = createWorkspace(path.join(root, "old")).path;
    const recent = createWorkspace(path.join(root, "recent")).path;
    stamp(old, "2026-01-01T00:00:00Z");
    stamp(recent, "2026-06-01T00:00:00Z");

    const entries = scanWorkspaces(root);
    expect(entries.map((entry) => entry.name)).toEqual(["recent", "old"]);
    expect(entries[0]?.members).toBe(0);
  });

  test("returns an empty list for an empty root", () => {
    expect(scanWorkspaces(tmp())).toEqual([]);
  });

  test("fails when the root is missing", () => {
    expect(() => scanWorkspaces(path.join(tmp(), "nope"))).toThrow(/root does not exist/);
  });
});

describe("findWorkspace", () => {
  test("finds by entry name and by relative path", () => {
    const root = tmp();
    createWorkspace(path.join(root, "payments"));
    createWorkspace(path.join(root, "team", "incident"));

    expect(findWorkspace(root, "payments").relative).toBe("payments");
    expect(findWorkspace(root, path.join("team", "incident")).relative).toBe(path.join("team", "incident"));
    expect(findWorkspace(root, "incident").path).toBe(path.join(root, "team", "incident"));
  });

  test("rejects an unknown name", () => {
    expect(() => findWorkspace(tmp(), "nope")).toThrow(/no workspace named nope/);
  });

  test("rejects an ambiguous name", () => {
    const root = tmp();
    createWorkspace(path.join(root, "a", "dup"));
    createWorkspace(path.join(root, "b", "dup"));
    expect(() => findWorkspace(root, "dup")).toThrow(/ambiguous/);
  });
});
