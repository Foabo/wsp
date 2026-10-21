import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { configPath, expandHome, isBareName, loadConfig, resolveNewDir, setRoot } from "../src/core/config.ts";

let dir: string;
let previous: string | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wsp-config-"));
  previous = process.env.WSP_CONFIG;
  process.env.WSP_CONFIG = path.join(dir, "config.json");
});

afterEach(() => {
  if (previous === undefined) delete process.env.WSP_CONFIG;
  else process.env.WSP_CONFIG = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("config", () => {
  test("has no root before setup", () => {
    expect(loadConfig().root).toBeUndefined();
    expect(configPath()).toBe(path.join(dir, "config.json"));
  });

  test("setup creates the directory and stores the real path", () => {
    const root = path.join(dir, "workspaces");
    const result = setRoot(root);

    expect(result.created).toBe(true);
    expect(fs.statSync(root).isDirectory()).toBe(true);
    expect(loadConfig().root).toBe(fs.realpathSync(root));
  });

  test("setup is idempotent", () => {
    const root = path.join(dir, "workspaces");
    setRoot(root);
    const second = setRoot(root);
    expect(second.created).toBe(false);
    expect(loadConfig().root).toBe(fs.realpathSync(root));
  });

  test("setup refuses a file", () => {
    const file = path.join(dir, "a-file");
    fs.writeFileSync(file, "x");
    expect(() => setRoot(file)).toThrow(/not a directory/);
  });
});

describe("new directory resolution", () => {
  test("a bare name lands under the root", () => {
    const root = path.join(dir, "workspaces");
    setRoot(root);

    const resolved = resolveNewDir("demo", dir);
    expect(resolved.dir).toBe(path.join(fs.realpathSync(root), "demo"));
    expect(resolved.fromRoot).toBe(true);
  });

  test("an explicit relative path stays in the current directory", () => {
    setRoot(path.join(dir, "workspaces"));

    expect(resolveNewDir("./demo", dir).dir).toBe(path.join(dir, "demo"));
    expect(resolveNewDir("./demo", dir).fromRoot).toBe(false);
  });

  test("an absolute path is used as written", () => {
    setRoot(path.join(dir, "workspaces"));
    const target = path.join(dir, "elsewhere", "demo");
    expect(resolveNewDir(target, dir).dir).toBe(target);
  });

  test("without a root a bare name stays in the current directory", () => {
    expect(resolveNewDir("demo", dir).dir).toBe(path.join(dir, "demo"));
  });

  test("an explicit base overrides the current directory", () => {
    const base = path.join(dir, "base");
    expect(resolveNewDir("demo", dir, base).dir).toBe(path.join(base, "demo"));
  });
});

describe("helpers", () => {
  test("bare names", () => {
    expect(isBareName("demo")).toBe(true);
    expect(isBareName("demo-1")).toBe(true);
    expect(isBareName("./demo")).toBe(false);
    expect(isBareName("a/demo")).toBe(false);
    expect(isBareName("~/demo")).toBe(false);
    expect(isBareName("..")).toBe(false);
  });

  test("home expansion", () => {
    expect(expandHome("~")).toBe(os.homedir());
    expect(expandHome("~/x")).toBe(path.join(os.homedir(), "x"));
    expect(expandHome("/x")).toBe("/x");
  });
});
