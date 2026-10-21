import fs from "node:fs";
import path from "node:path";

import type { Manifest } from "./manifest.ts";

/**
 * Writes a VS Code / Cursor workspace file pointing at the members' real paths.
 * The symlink path would also work, but a real root keeps watchers and
 * language servers on the same inode they would see after `realpath`.
 */
export function writeCodeWorkspace(ws: string, manifest: Manifest): string {
  const file = path.join(ws, `${manifest.name}.code-workspace`);
  const doc = {
    folders: manifest.members.map((member) => ({ name: member.name, path: member.target })),
    settings: {
      "search.followSymlinks": true,
    },
  };
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return file;
}
