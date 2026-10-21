import process from "node:process";

export interface PickItem {
  /** Main text of the row. */
  label: string;
  /** Dimmed text after the label. */
  detail?: string;
  /** Value returned when the row is chosen. */
  value: string;
}

export interface PickOptions {
  title: string;
  hint?: string;
  items: PickItem[];
  footer?: string;
}

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_DOWN = "\r\x1b[J";
const UP = ["\x1b[A", "\x1bOA"];
const DOWN = ["\x1b[B", "\x1bOB"];

const MAX_VISIBLE = 15;

/**
 * Single-select prompt drawn inline (no alternate screen), so the list stays
 * in the scrollback after choosing. `/` filters by substring.
 * Requires a terminal on both ends.
 */
export async function pick(options: PickOptions): Promise<PickItem | null> {
  const { items } = options;
  if (items.length === 0) return null;

  const stdin = process.stdin;
  const stdout = process.stdout;
  const labelWidth = Math.min(42, Math.max(...items.map((item) => item.label.length)));
  const hint = options.hint ?? "up/down move . / filter . enter copy . esc cancel";

  let filter = "";
  let filtering = false;
  let cursor = 0;
  let offset = 0;
  let drawn = 0;

  const visible = (): PickItem[] => {
    if (!filter) return items;
    const needle = filter.toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(needle));
  };

  const frame = (): string[] => {
    const lines: string[] = [];
    const block = filtering ? "\x1b[7m \x1b[0m" : "";
    const tail = filtering ? "  \x1b[2mesc clear . enter select\x1b[0m" : `  \x1b[2m${hint}\x1b[0m`;
    lines.push(
      filtering
        ? `\x1b[2m?\x1b[0m ${options.title}  filter: \x1b[36m${filter}\x1b[0m${block}${tail}`
        : `\x1b[2m?\x1b[0m ${options.title}${tail}`,
    );
    lines.push("");

    const list = visible();
    if (list.length === 0) {
      lines.push("  \x1b[2m(no match)\x1b[0m");
    } else {
      const end = Math.min(list.length, offset + MAX_VISIBLE);
      for (let index = offset; index < end; index += 1) {
        const item = list[index];
        if (!item) continue;
        const active = index === cursor;
        const marker = active ? "\x1b[36m>\x1b[0m" : " ";
        const label = item.label.padEnd(labelWidth);
        const shown = active ? `\x1b[1m${label}\x1b[0m` : label;
        const detail = item.detail ? `  \x1b[2m${item.detail}\x1b[0m` : "";
        lines.push(`${marker} ${shown}${detail}`);
      }
    }

    lines.push("");
    if (options.footer) lines.push(`\x1b[2m${options.footer}\x1b[0m`);
    return lines;
  };

  const scroll = (): void => {
    const total = visible().length;
    if (total === 0) {
      cursor = 0;
      offset = 0;
      return;
    }
    cursor = Math.min(cursor, total - 1);
    if (cursor < offset) offset = cursor;
    if (cursor >= offset + MAX_VISIBLE) offset = cursor - MAX_VISIBLE + 1;
  };

  const draw = (): void => {
    const lines = frame();
    if (drawn > 0) stdout.write(`\x1b[${drawn - 1}A`);
    stdout.write(CLEAR_DOWN);
    stdout.write(lines.join("\n"));
    drawn = lines.length;
  };

  return new Promise<PickItem | null>((resolve) => {
    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write(SHOW_CURSOR);
    };

    const finish = (item: PickItem | null): void => {
      cleanup();
      if (drawn > 0) {
        stdout.write(`\x1b[${drawn - 1}A`);
        stdout.write(CLEAR_DOWN);
        drawn = 0;
      }
      resolve(item);
    };

    const resetCursor = (): void => {
      cursor = 0;
      offset = 0;
    };

    const onData = (chunk: string): void => {
      let index = 0;
      let changed = false;

      while (index < chunk.length) {
        const three = chunk.slice(index, index + 3);
        if (UP.includes(three)) {
          cursor = Math.max(0, cursor - 1);
          index += 3;
          changed = true;
          continue;
        }
        if (DOWN.includes(three)) {
          cursor = Math.min(visible().length - 1, cursor + 1);
          index += 3;
          changed = true;
          continue;
        }

        const char = chunk[index] ?? "";
        index += 1;

        if (char === "\r" || char === "\n") {
          const item = visible()[cursor];
          if (item) {
            finish(item);
            return;
          }
          continue;
        }
        if (char === "\x03") {
          finish(null);
          return;
        }
        if (char === "\x1b") {
          if (filter || filtering) {
            filter = "";
            filtering = false;
            resetCursor();
            changed = true;
            continue;
          }
          finish(null);
          return;
        }
        if (char === "/" && !filtering) {
          filtering = true;
          resetCursor();
          changed = true;
          continue;
        }

        if (filtering) {
          if (char === "\x7f" || char === "\x08") {
            if (filter) {
              filter = filter.slice(0, -1);
              resetCursor();
            } else {
              filtering = false;
            }
            changed = true;
            continue;
          }
          if (char === "\x15") {
            filter = "";
            resetCursor();
            changed = true;
            continue;
          }
          if (char >= " ") {
            filter += char;
            resetCursor();
            changed = true;
          }
          continue;
        }

        if (char === "j") {
          cursor = Math.min(visible().length - 1, cursor + 1);
          changed = true;
        } else if (char === "k") {
          cursor = Math.max(0, cursor - 1);
          changed = true;
        } else if (char === "q") {
          finish(null);
          return;
        }
      }

      if (changed) {
        scroll();
        draw();
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdout.write(HIDE_CURSOR);
    draw();
    stdin.on("data", onData);
  });
}
