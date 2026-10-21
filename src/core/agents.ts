import fs from "node:fs";
import path from "node:path";

import type { Manifest } from "./manifest.ts";
import { AGENTS_BEGIN, AGENTS_END } from "./paths.ts";

/**
 * Renders the managed block. Everything outside the markers is left alone,
 * so a hand-written AGENTS.md can coexist with it.
 */
export function renderAgentsBlock(manifest: Manifest): string {
  const lines: string[] = [];
  lines.push(AGENTS_BEGIN);
  lines.push(`## wsp workspace: ${manifest.name}`);
  lines.push("");
  lines.push(
    "This directory groups several repositories. Each member is a symlink to its real location; both paths reach the same files.",
  );
  lines.push("");

  if (manifest.members.length === 0) {
    lines.push("No members yet. Add one with `wsp add <dir>`.");
  } else {
    lines.push("| member | real path | kind |");
    lines.push("| --- | --- | --- |");
    for (const member of manifest.members) {
      lines.push(`| \`${member.name}\` | \`${member.target}\` | ${member.kind} |`);
    }
    lines.push("");
    lines.push("- Reported and edited file paths should use the real path above.");
    lines.push("- Recursive search must follow symlinks: `rg --follow`, `fd -L`, `find -L`.");
    lines.push("- Run `git` inside a member directory; the workspace root is not a working tree.");
  }

  lines.push("- Manage this directory with `wsp ls`, `wsp add <dir>`, `wsp rm <name>`, `wsp doctor`.");
  lines.push(AGENTS_END);
  return lines.join("\n");
}

export interface AgentsFileResult {
  path: string;
  created: boolean;
  changed: boolean;
}

export function writeAgentsFile(ws: string, manifest: Manifest): AgentsFileResult {
  const file = path.join(ws, "AGENTS.md");
  const block = renderAgentsBlock(manifest);

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `${block}\n`);
    return { path: file, created: true, changed: true };
  }

  const current = fs.readFileSync(file, "utf8");
  const start = current.indexOf(AGENTS_BEGIN);
  const end = current.indexOf(AGENTS_END);

  let next: string;
  if (start !== -1 && end > start) {
    next = current.slice(0, start) + block + current.slice(end + AGENTS_END.length);
  } else {
    next = `${current.trimEnd()}\n\n${block}\n`;
  }

  if (next !== current) fs.writeFileSync(file, next);
  return { path: file, created: false, changed: next !== current };
}
