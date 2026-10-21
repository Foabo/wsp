import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Config {
  version: 1;
  /** Default parent directory for `wsp new <bare-name>`. */
  root?: string;
}

export interface SetupResult {
  root: string;
  created: boolean;
  configPath: string;
}

/**
 * $WSP_CONFIG wins, then $XDG_CONFIG_HOME/wsp/config.json,
 * then ~/.config/wsp/config.json.
 */
export function configPath(): string {
  const override = process.env.WSP_CONFIG;
  if (override) return path.resolve(override);

  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "wsp", "config.json");
}

export function loadConfig(): Config {
  const file = configPath();
  if (!fs.existsSync(file)) return { version: 1 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`cannot parse ${file}`);
  }

  const doc = parsed as Partial<Config>;
  return {
    version: 1,
    ...(typeof doc.root === "string" && doc.root ? { root: doc.root } : {}),
  };
}

export function saveConfig(config: Config): string {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return file;
}

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

/**
 * Sets the default root, creating the directory when it does not exist.
 * The stored value is the real path, so a symlinked root stays canonical.
 */
export function setRoot(input: string): SetupResult {
  const target = path.resolve(expandHome(input));

  let created = false;
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isDirectory()) {
      throw new Error(`${target} exists and is not a directory`);
    }
  } else {
    fs.mkdirSync(target, { recursive: true });
    created = true;
  }

  const root = fs.realpathSync(target);
  const config = loadConfig();
  config.root = root;
  const file = saveConfig(config);
  return { root, created, configPath: file };
}

/** A bare name has no path separator and no home prefix: it may live under the default root. */
export function isBareName(input: string): boolean {
  return input.length > 0 && !input.startsWith("~") && !input.includes("/") && input !== "." && input !== "..";
}

/**
 * Resolves the directory for `wsp new`.
 * - bare name + configured root  -> <root>/<name>
 * - anything else                -> relative to cwd (or an explicit base)
 */
export function resolveNewDir(
  input: string,
  cwd: string,
  explicitBase?: string,
): { dir: string; fromRoot: boolean } {
  if (isBareName(input)) {
    const { root } = loadConfig();
    if (root) return { dir: path.join(root, input), fromRoot: true };
  }

  const base = explicitBase ? path.resolve(expandHome(explicitBase)) : cwd;
  return { dir: path.resolve(base, expandHome(input)), fromRoot: false };
}
