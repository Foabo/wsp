#!/usr/bin/env bun
import path from "node:path";

import { addMember, createWorkspace, doctor, memberStatuses, removeMember } from "./core/workspace.ts";
import { readManifest, type Manifest } from "./core/manifest.ts";
import { findWorkspaceRoot, realpathOrNull } from "./core/paths.ts";
import { writeAgentsFile } from "./core/agents.ts";
import { writeCodeWorkspace } from "./core/codeWorkspace.ts";
import { copyToClipboard } from "./core/clipboard.ts";
import { configPath, expandHome, isBareName, loadConfig, resolveNewDir, setRoot } from "./core/config.ts";
import { scanWorkspaces, findWorkspace } from "./core/registry.ts";
import { pick } from "./core/picker.ts";

const VERSION = "0.5.0";
const VALUE_FLAGS = new Set(["ws", "as"]);

class UsageError extends Error {}

interface Parsed {
  positional: string[];
  flags: Record<string, string | true>;
}

function parse(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) break;

    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h") {
      flags.help = true;
      continue;
    }
    if (arg === "-v") {
      flags.version = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
        continue;
      }
      const key = arg.slice(2);
      if (VALUE_FLAGS.has(key)) {
        const value = argv[i + 1];
        if (value === undefined) throw new UsageError(`--${key} needs a value`);
        flags[key] = value;
        i += 1;
        continue;
      }
      flags[key] = true;
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) throw new UsageError(`unknown flag: ${arg}`);
    positional.push(arg);
  }

  return { positional, flags };
}

function resolveWs(flags: Record<string, string | true>): string {
  const explicit = flags.ws;
  if (typeof explicit === "string") return path.resolve(explicit);

  const fromEnv = process.env.WSP_WORKSPACE;
  if (fromEnv) return path.resolve(fromEnv);

  const cwd = process.cwd();
  const direct = findWorkspaceRoot(cwd);
  if (direct) return direct;

  // process.cwd() is the physical path; PWD keeps the path the shell used.
  // That is what you see when standing inside a symlinked member.
  const pwd = process.env.PWD;
  if (pwd) {
    const logical = realpathOrNull(pwd);
    const physical = realpathOrNull(cwd);
    if (logical && physical && logical === physical) {
      const found = findWorkspaceRoot(pwd);
      if (found) return found;
    }
  }

  throw new UsageError(`no workspace here (${cwd}); cd into one, pass --ws <dir>, or set WSP_WORKSPACE`);
}

function refresh(ws: string): Manifest {
  const manifest = readManifest(ws);
  writeAgentsFile(ws, manifest);
  writeCodeWorkspace(ws, manifest);
  return manifest;
}

function findMember(ws: string, name: string) {
  const member = readManifest(ws).members.find((m) => m.name === name);
  if (!member) {
    const known = readManifest(ws).members.map((m) => m.name).join(", ") || "none";
    throw new UsageError(`no member named ${name} (members: ${known})`);
  }
  return member;
}

function quote(value: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function cmdNew(positional: string[], flags: Record<string, string | true>): number {
  const dir = positional[0];
  if (!dir) throw new UsageError("new needs a directory: wsp new <dir>");

  const base = typeof flags.ws === "string" ? flags.ws : undefined;
  const resolved = resolveNewDir(dir, process.cwd(), base);
  const abs = resolved.dir;
  const targets = positional.slice(1).map((target) => path.resolve(expandHome(target)));

  const result = createWorkspace(abs);
  const added = targets.map((target) =>
    addMember(abs, target, { relative: flags.relative === true }),
  );
  const agents = writeAgentsFile(abs, readManifest(abs));
  const code = writeCodeWorkspace(abs, readManifest(abs));

  if (!result.created) {
    console.log(`workspace ${abs} (already exists)`);
  } else {
    console.log(`created ${abs}`);
    if (!resolved.fromRoot && isBareName(dir) && !loadConfig().root) {
      console.log("note: no default root yet; set one with: wsp setup ~/.wsp");
    }
  }
  for (const item of added) {
    console.log(`  member    ${item.member.name} -> ${item.member.target}`);
  }
  console.log(`  manifest  ${path.join(abs, ".wsp.json")}`);
  console.log(`  agents    ${agents.path}`);
  console.log(`  code      ${code}`);
  console.log("");
  console.log(added.length > 0 ? `next: cd ${quote(abs)}` : `next: cd ${quote(abs)} && wsp add <repo>`);
  return 0;
}

function cmdAdd(positional: string[], flags: Record<string, string | true>): number {
  const target = positional[0];
  if (!target) throw new UsageError("add needs a target: wsp add <dir> [--as name] [--relative]");

  const ws = resolveWs(flags);
  const result = addMember(ws, target, {
    ...(typeof flags.as === "string" ? { as: flags.as } : {}),
    relative: flags.relative === true,
  });
  refresh(ws);

  if (result.alreadyMember) {
    console.log(`already a member: ${result.member.name} -> ${result.member.target}`);
  } else {
    console.log(`added ${result.member.name} -> ${result.member.target}`);
    if (result.renamedFrom) {
      console.log(`note: ${result.renamedFrom} was taken, used ${result.member.name}`);
    }
  }
  console.log(`workspace ${ws}`);
  console.log(`link      ${path.join(ws, result.member.name)} (${result.member.link})`);
  return 0;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function cmdLsAll(flags: Record<string, string | true>): number {
  const { root } = loadConfig();
  if (!root) throw new UsageError("no default root; run: wsp setup <dir>");

  const entries = scanWorkspaces(root);

  if (flags.json === true) {
    console.log(JSON.stringify({ root, workspaces: entries }, null, 2));
    return 0;
  }

  console.log(`root  ${root}  (${entries.length} workspace${entries.length === 1 ? "" : "s"})`);
  if (entries.length === 0) {
    console.log("  (none)  create one: wsp new demo");
    return 0;
  }

  const width = Math.max(8, ...entries.map((entry) => entry.relative.length));
  for (const entry of entries) {
    const members = `${entry.members} member${entry.members === 1 ? "" : "s"}`;
    const broken = entry.broken ? "  (broken manifest)" : "";
    console.log(
      `  ${entry.relative.padEnd(width)}  ${members.padEnd(10)}  ${formatTime(entry.updatedAt)}  ${entry.path}${broken}`,
    );
  }
  return 0;
}

function cmdLs(flags: Record<string, string | true>): number {
  if (flags.all === true) return cmdLsAll(flags);
  const ws = resolveWs(flags);
  const manifest = readManifest(ws);
  const statuses = memberStatuses(ws);

  if (flags.json === true) {
    console.log(
      JSON.stringify(
        {
          workspace: ws,
          name: manifest.name,
          members: statuses.map((status) => ({
            name: status.member.name,
            target: status.member.target,
            link: status.member.link,
            linkPath: status.linkPath,
            kind: status.member.kind,
            state: status.linkState,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(`${manifest.name}  ${ws}`);
  if (statuses.length === 0) {
    console.log("  (no members)  add one: wsp add <repo>");
    return 0;
  }

  const width = Math.max(4, ...statuses.map((status) => status.member.name.length));
  for (const status of statuses) {
    const state = status.linkState === "ok" ? "ok" : status.linkState.toUpperCase();
    console.log(`  ${status.member.name.padEnd(width)}  ${state.padEnd(12)}  ${status.member.target}`);
  }
  return 0;
}

function cmdPath(positional: string[], flags: Record<string, string | true>): number {
  const ws = resolveWs(flags);
  const name = positional[0];
  const output = name ? (flags.link === true ? path.join(ws, name) : findMember(ws, name).target) : ws;

  console.log(output);
  if (flags.copy === true) copyToClipboard(output);
  return 0;
}

function printAndCopy(target: string): number {
  console.log(target);
  const tool = copyToClipboard(target);
  if (!tool) process.stderr.write("wsp: no clipboard tool found; the path is printed above\n");
  else process.stderr.write(`copied via ${tool}\n`);
  return 0;
}

function cmdCopy(positional: string[], flags: Record<string, string | true>): number {
  const ws = resolveWs(flags);
  const name = positional[0];
  const output = name ? (flags.link === true ? path.join(ws, name) : findMember(ws, name).target) : ws;

  return printAndCopy(output);
}

async function cmdPick(positional: string[], flags: Record<string, string | true>): Promise<number> {
  const { root } = loadConfig();
  if (!root) throw new UsageError("no default root; run: wsp setup <dir>");

  const name = positional[0];
  if (name) return printAndCopy(findWorkspace(root, name).path);

  const entries = scanWorkspaces(root);
  if (entries.length === 0) {
    throw new UsageError(`no workspaces under ${root}; create one: wsp new demo`);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new UsageError("wsp pick needs a terminal; use: wsp ls --all, or: wsp pick <name>");
  }

  const picked = await pick({
    title: "pick a workspace",
    items: entries.map((entry) => ({
      label: entry.relative,
      detail: `${entry.members} member${entry.members === 1 ? "" : "s"}   ${formatTime(entry.updatedAt)}${entry.broken ? "   (broken)" : ""}`,
      value: entry.path,
    })),
    footer: `root  ${root}`,
  });

  if (!picked) {
    process.stderr.write("cancelled\n");
    return 130;
  }
  return printAndCopy(picked.value);
}

function cmdRm(positional: string[], flags: Record<string, string | true>): number {
  const name = positional[0];
  if (!name) throw new UsageError("rm needs a member name: wsp rm <name>");

  const ws = resolveWs(flags);
  const removed = removeMember(ws, name);
  refresh(ws);
  console.log(`removed ${removed.name}`);
  console.log(`target untouched: ${removed.target}`);
  return 0;
}

function printConfig(): void {
  const config = loadConfig();
  console.log(`config  ${configPath()}`);
  console.log(`root    ${config.root ?? "(not set)"}`);
}

function cmdSetup(positional: string[]): number {
  const dir = positional[0];
  if (!dir) {
    printConfig();
    console.log("");
    console.log("usage: wsp setup <dir>    set the default root for new workspaces");
    return 0;
  }

  const result = setRoot(dir);
  console.log(`root    ${result.root}${result.created ? "  (created)" : ""}`);
  console.log(`config  ${result.configPath}`);
  console.log("");
  console.log(`next: wsp new demo    ->  ${path.join(result.root, "demo")}`);
  return 0;
}

function cmdConfig(flags: Record<string, string | true>): number {
  if (flags.json === true) {
    const config = loadConfig();
    console.log(JSON.stringify({ configPath: configPath(), ...config }, null, 2));
    return 0;
  }
  printConfig();
  return 0;
}

function cmdDoctor(flags: Record<string, string | true>): number {
  const ws = resolveWs(flags);
  const manifest = readManifest(ws);
  const issues = doctor(ws);
  const errors = issues.filter((issue) => issue.level === "error").length;
  const warnings = issues.filter((issue) => issue.level === "warn").length;

  if (flags.json === true) {
    console.log(JSON.stringify({ workspace: ws, name: manifest.name, errors, warnings, issues }, null, 2));
    return errors > 0 ? 1 : 0;
  }

  console.log(`${manifest.name}  ${ws}`);
  const notes = issues.filter((issue) => issue.level === "info").length;
  if (errors === 0 && warnings === 0) {
    console.log(notes > 0 ? `ok (${notes} note${notes === 1 ? "" : "s"})` : "ok");
  }
  for (const issue of issues) {
    console.log(`${issue.level.toUpperCase().padEnd(5)} ${issue.message}`);
    if (issue.hint) console.log(`      ${issue.hint}`);
  }
  if (errors > 0 || warnings > 0) {
    console.log("");
    console.log(`${errors} error(s), ${warnings} warning(s)`);
  }
  return errors > 0 ? 1 : 0;
}

function cmdRegenerate(which: "agents" | "code", flags: Record<string, string | true>): number {
  const ws = resolveWs(flags);
  const manifest = readManifest(ws);
  if (which === "agents") {
    const result = writeAgentsFile(ws, manifest);
    console.log(result.path);
  } else {
    console.log(writeCodeWorkspace(ws, manifest));
  }
  return 0;
}

function help(): string {
  return [
    "wsp - fast symlink workspaces for multi-repo work",
    "",
    "usage:",
    "  wsp new <dir> [repo...]           create a workspace, optionally linking repos",
    "  wsp setup <dir>                   set the default root for new workspaces",
    "  wsp config [--json]               show the global configuration",
    "  wsp add <dir> [--as name]         link a repository into the workspace",
    "                    [--relative]    store a relative link (movable as a bundle)",
    "  wsp ls [--json]                   list members and link state",
    "  wsp ls --all [--json]             list workspaces under the default root",
    "  wsp rm <name>                     remove a member (never touches the target)",
    "  wsp path [name] [--link]          print the workspace or member path",
    "  wsp copy [name] [--link]          copy that path to the clipboard",
    "  wsp pick [name]                   choose a workspace under the root, copy its path",
    "  wsp doctor [--json]               check links, manifest and pitfalls",
    "  wsp code                          rewrite <name>.code-workspace",
    "  wsp agents                        rewrite the wsp block in AGENTS.md",
    "",
    "workspace lookup: --ws <dir>, $WSP_WORKSPACE, then the nearest parent with .wsp.json",
    "",
    "a bare name in `wsp new` lands under the default root from `wsp setup`;",
    "pass ./x, ../x or an absolute path to place it anywhere else.",
    "config file: $WSP_CONFIG, $XDG_CONFIG_HOME/wsp/config.json, or ~/.config/wsp/config.json",
    "",
    "members are symlinked, so the workspace costs a few bytes; copies of the",
    "workspace copy the links, not the repositories.",
  ].join("\n");
}

function main(argv: string[]): number | Promise<number> {
  const { positional, flags } = parse(argv);
  const command = positional[0];

  if (flags.help === true || command === "help") {
    console.log(help());
    return 0;
  }
  if (flags.version === true || command === "--version") {
    console.log(VERSION);
    return 0;
  }

  const rest = positional.slice(1);
  switch (command) {
    case undefined:
      try {
        return cmdLs(flags);
      } catch (error) {
        if (!(error instanceof UsageError)) throw error;
        console.log(help());
        return 0;
      }
    case "new":
      return cmdNew(rest, flags);
    case "setup":
      return cmdSetup(rest);
    case "config":
      return cmdConfig(flags);
    case "add":
      return cmdAdd(rest, flags);
    case "ls":
    case "list":
      return cmdLs(flags);
    case "rm":
    case "remove":
      return cmdRm(rest, flags);
    case "path":
      return cmdPath(rest, flags);
    case "copy":
      return cmdCopy(rest, flags);
    case "pick":
      return cmdPick(rest, flags);
    case "doctor":
      return cmdDoctor(flags);
    case "code":
      return cmdRegenerate("code", flags);
    case "agents":
      return cmdRegenerate("agents", flags);
    default:
      throw new UsageError(`unknown command: ${command} (try: wsp help)`);
  }
}

try {
  process.exit(await main(process.argv.slice(2)));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`wsp: ${message}`);
  process.exit(error instanceof UsageError ? 2 : 1);
}
