import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const roots: string[] = [];
const cli = path.join(import.meta.dir, "..", "src", "cli.ts");

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wsp-cli-"));
  roots.push(dir);
  return dir;
}

function repo(root: string, name: string): string {
  const dir = path.join(root, "repos", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), `${name}\n`);
  return dir;
}

function wsp(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

function members(ws: string): string[] {
  const manifest = JSON.parse(fs.readFileSync(path.join(ws, ".wsp.json"), "utf8")) as {
    members: Array<{ name: string }>;
  };
  return manifest.members.map((member) => member.name);
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("where commands run", () => {
  test("ls needs a workspace", () => {
    const root = tmp();
    const result = wsp(root, "ls");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no workspace here");
  });

  test("ls --ws works from outside", () => {
    const root = tmp();
    const api = repo(root, "api");
    const created = wsp(root, "new", path.join(root, "ws"));
    expect(created.status).toBe(0);
    const ws = path.join(root, "ws");
    expect(wsp(ws, "add", api).status).toBe(0);

    const result = wsp(root, "ls", "--ws", ws);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("api");
  });
});

describe("wsp add", () => {
  test("links every target given in one command", () => {
    const root = tmp();
    const api = repo(root, "api");
    const web = repo(root, "web");
    const created = wsp(root, "new", path.join(root, "ws"));

    expect(created.status).toBe(0);
    const ws = path.join(root, "ws");

    const result = wsp(ws, "add", api, web);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("added api ->");
    expect(result.stdout).toContain("added web ->");
    expect(members(ws)).toEqual(["api", "web"]);
  });

  test("exits non-zero when one target is missing but keeps the rest", () => {
    const root = tmp();
    const api = repo(root, "api");
    const created = wsp(root, "new", path.join(root, "ws"));
    expect(created.status).toBe(0);
    const ws = path.join(root, "ws");

    const result = wsp(ws, "add", api, path.join(root, "nope"));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("nope");
    expect(result.stderr).toMatch(/does not exist/);
    expect(members(ws)).toEqual(["api"]);
  });

  test("refuses --as with more than one target", () => {
    const root = tmp();
    const api = repo(root, "api");
    const web = repo(root, "web");
    const created = wsp(root, "new", path.join(root, "ws"));
    expect(created.status).toBe(0);
    const ws = path.join(root, "ws");

    const result = wsp(ws, "add", api, web, "--as", "app");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--as works with a single target");
    expect(members(ws)).toEqual([]);
  });

  test("new links several repos and reports failures", () => {
    const root = tmp();
    const api = repo(root, "api");
    const web = repo(root, "web");
    const ws = path.join(root, "ws");

    const result = wsp(root, "new", ws, api, web, path.join(root, "nope"));

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("member    api ->");
    expect(result.stdout).toContain("member    web ->");
    expect(result.stderr).toMatch(/does not exist/);
    expect(members(ws)).toEqual(["api", "web"]);
  });
});
