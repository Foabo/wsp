import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { addMany, addMember, createWorkspace, doctor, memberStatuses, removeMember } from "../src/core/workspace.ts";
import { readManifest } from "../src/core/manifest.ts";
import { writeAgentsFile } from "../src/core/agents.ts";
import { writeCodeWorkspace } from "../src/core/codeWorkspace.ts";
import { AGENTS_BEGIN } from "../src/core/paths.ts";

const roots: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wsp-test-"));
  roots.push(dir);
  return dir;
}

function repo(root: string, name: string): string {
  const dir = path.join(root, "repos", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), `${name}\n`);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("create and add", () => {
  test("creates a manifest and links a directory", () => {
    const root = tmp();
    const api = repo(root, "api");
    const created = createWorkspace(path.join(root, "ws"));

    expect(created.created).toBe(true);
    expect(fs.existsSync(path.join(created.path, ".wsp.json"))).toBe(true);

    const result = addMember(created.path, api);
    const link = path.join(created.path, "api");

    expect(result.member.name).toBe("api");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(api));
    expect(readManifest(created.path).members).toHaveLength(1);
  });

  test("is idempotent for the same target", () => {
    const root = tmp();
    const api = repo(root, "api");
    const ws = createWorkspace(path.join(root, "ws")).path;

    addMember(ws, api);
    const second = addMember(ws, api);

    expect(second.alreadyMember).toBe(true);
    expect(readManifest(ws).members).toHaveLength(1);
  });

  test("suffixes names that are already taken", () => {
    const root = tmp();
    const first = repo(path.join(root, "a"), "api");
    const second = repo(path.join(root, "b"), "api");
    const ws = createWorkspace(path.join(root, "ws")).path;

    addMember(ws, first);
    const result = addMember(ws, second);

    expect(result.member.name).toBe("api-2");
    expect(result.renamedFrom).toBe("api");
  });

  test("rejects a missing target", () => {
    const root = tmp();
    const ws = createWorkspace(path.join(root, "ws")).path;
    expect(() => addMember(ws, path.join(root, "nope"))).toThrow(/does not exist/);
  });

  test("rejects the workspace itself and its ancestors", () => {
    const root = tmp();
    const ws = createWorkspace(path.join(root, "ws")).path;
    expect(() => addMember(ws, ws)).toThrow(/itself/);
    expect(() => addMember(ws, root)).toThrow(/lives inside it|already inside/);
  });

  test("rejects a target already inside the workspace", () => {
    const root = tmp();
    const ws = createWorkspace(path.join(root, "ws")).path;
    const inner = path.join(ws, "inner");
    fs.mkdirSync(inner);
    expect(() => addMember(ws, inner)).toThrow(/already inside/);
  });

  test("stores a relative link when asked", () => {
    const root = tmp();
    const api = repo(root, "api");
    const ws = createWorkspace(path.join(root, "ws")).path;

    const result = addMember(ws, api, { relative: true });
    const link = path.join(ws, "api");

    expect(result.member.link.startsWith("/")).toBe(false);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(api));
  });

  test("adds several targets in one call", () => {
    const root = tmp();
    const ws = createWorkspace(path.join(root, "ws")).path;

    const result = addMany(ws, [repo(root, "api"), repo(root, "web")]);

    expect(result.failed).toHaveLength(0);
    expect(result.added.map((item) => item.member.name)).toEqual(["api", "web"]);
    expect(readManifest(ws).members).toHaveLength(2);
  });

  test("keeps going when one target fails", () => {
    const root = tmp();
    const ws = createWorkspace(path.join(root, "ws")).path;
    const missing = path.join(root, "nope");

    const result = addMany(ws, [repo(root, "api"), missing]);

    expect(result.added).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.target).toBe(missing);
    expect(result.failed[0]?.message).toMatch(/does not exist/);
    expect(readManifest(ws).members.map((member) => member.name)).toEqual(["api"]);
  });

  test("reports a duplicate inside the same batch once", () => {
    const root = tmp();
    const ws = createWorkspace(path.join(root, "ws")).path;
    const api = repo(root, "api");

    const result = addMany(ws, [api, api]);

    expect(result.added[0]?.alreadyMember).toBe(false);
    expect(result.added[1]?.alreadyMember).toBe(true);
    expect(readManifest(ws).members).toHaveLength(1);
  });
});

describe("remove", () => {
  test("removes the link and keeps the target", () => {
    const root = tmp();
    const api = repo(root, "api");
    const ws = createWorkspace(path.join(root, "ws")).path;
    addMember(ws, api);

    removeMember(ws, "api");

    expect(fs.existsSync(path.join(ws, "api"))).toBe(false);
    expect(fs.existsSync(path.join(api, "README.md"))).toBe(true);
    expect(readManifest(ws).members).toHaveLength(0);
  });

  test("refuses to delete a real directory", () => {
    const root = tmp();
    const ws = createWorkspace(path.join(root, "ws")).path;
    fs.mkdirSync(path.join(ws, "real"));
    expect(() => removeMember(ws, "real")).toThrow(/not managed/);
    expect(fs.existsSync(path.join(ws, "real"))).toBe(true);
  });
});

describe("status and doctor", () => {
  test("reports a healthy link", () => {
    const root = tmp();
    const api = repo(root, "api");
    const ws = createWorkspace(path.join(root, "ws")).path;
    addMember(ws, api);

    const status = memberStatuses(ws)[0];
    expect(status?.linkState).toBe("ok");
  });

  test("detects a dangling link", () => {
    const root = tmp();
    const api = repo(root, "api");
    const ws = createWorkspace(path.join(root, "ws")).path;
    addMember(ws, api);

    fs.rmSync(api, { recursive: true, force: true });

    expect(memberStatuses(ws)[0]?.linkState).toBe("dangling");
    const codes = doctor(ws).map((issue) => issue.code);
    expect(codes).toContain("link-dangling");
  });

  test("detects an unmanaged symlink", () => {
    const root = tmp();
    const api = repo(root, "api");
    const ws = createWorkspace(path.join(root, "ws")).path;
    fs.symlinkSync(api, path.join(ws, "stray"));

    const codes = doctor(ws).map((issue) => issue.code);
    expect(codes).toContain("unmanaged-link");
  });
});

describe("generated files", () => {
  test("keeps prose outside the managed AGENTS.md block", () => {
    const root = tmp();
    const api = repo(root, "api");
    const ws = createWorkspace(path.join(root, "ws")).path;
    addMember(ws, api);

    const file = path.join(ws, "AGENTS.md");
    fs.writeFileSync(file, "# Team rules\n\nAlways run tests.\n");

    writeAgentsFile(ws, readManifest(ws));
    addMember(ws, repo(root, "web"));
    writeAgentsFile(ws, readManifest(ws));

    const content = fs.readFileSync(file, "utf8");
    expect(content.startsWith("# Team rules")).toBe(true);
    expect(content).toContain("Always run tests.");
    expect(content).toContain("| `api` |");
    expect(content).toContain("| `web` |");
    expect(content.split(AGENTS_BEGIN)).toHaveLength(2);
  });

  test("writes a code workspace pointing at real paths", () => {
    const root = tmp();
    const api = repo(root, "api");
    const ws = createWorkspace(path.join(root, "ws")).path;
    addMember(ws, api);

    const file = writeCodeWorkspace(ws, readManifest(ws));
    const doc = JSON.parse(fs.readFileSync(file, "utf8")) as {
      folders: Array<{ name: string; path: string }>;
    };

    expect(doc.folders).toHaveLength(1);
    expect(doc.folders[0]?.name).toBe("api");
    expect(doc.folders[0]?.path).toBe(fs.realpathSync(api));
  });
});
