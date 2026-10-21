import { spawnSync } from "node:child_process";

const TOOLS: Array<[string, string[]]> = [
  ["pbcopy", []],
  ["wl-copy", []],
  ["xclip", ["-selection", "clipboard"]],
  ["clip.exe", []],
];

/** Copies text using the first clipboard tool that works. Returns its name, or null. */
export function copyToClipboard(text: string): string | null {
  for (const [command, args] of TOOLS) {
    const result = spawnSync(command, args, { input: text });
    if (!result.error && result.status === 0) return command;
  }
  return null;
}
