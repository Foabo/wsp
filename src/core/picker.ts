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
const UP = ["\x1b[A", "\x1bOA"];
const DOWN = ["\x1b[B", "\x1bOB"];

/**
 * Single-select prompt drawn inline (no alternate screen), so the list stays
 * in the scrollback after choosing. Requires a terminal on both ends.
 */
export async function pick(options: PickOptions): Promise<PickItem | null> {
  const { items } = options;
  if (items.length === 0) return null;

  const stdin = process.stdin;
  const stdout = process.stdout;
  const maxVisible = Math.max(5, Math.min(items.length, 15));
  const labelWidth = Math.min(42, Math.max(...items.map((item) => item.label.length)));

  let cursor = 0;
  let offset = 0;
  let rendered = 0;

  const hint = options.hint ?? "up/down move . enter copy . esc cancel";

  const frame = (): string[] => {
    const lines: string[] = [];
    lines.push(`\x1b[2m?\x1b[0m ${options.title}  \x1b[2m${hint}\x1b[0m`);
    lines.push("");
    for (let index = offset; index < Math.min(items.length, offset + maxVisible); index += 1) {
      const item = items[index];
      if (!item) continue;
      const active = index === cursor;
      const marker = active ? "\x1b[36m>\x1b[0m" : " ";
      const label = active ? `\x1b[1m${item.label.padEnd(labelWidth)}\x1b[0m` : item.label.padEnd(labelWidth);
      const detail = item.detail ? `  \x1b[2m${item.detail}\x1b[0m` : "";
      lines.push(`${marker} ${label}${detail}`);
    }
    lines.push("");
    if (options.footer) lines.push(`\x1b[2m${options.footer}\x1b[0m`);
    return lines;
  };

  const draw = (): void => {
    const lines = frame();
    if (rendered > 0) stdout.write(`\x1b[${rendered}A`);
    for (const line of lines) stdout.write(`\x1b[2K${line}\n`);
    rendered = lines.length;
  };

  const scroll = (): void => {
    if (cursor < offset) offset = cursor;
    if (cursor >= offset + maxVisible) offset = cursor - maxVisible + 1;
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
      if (rendered > 0) {
        stdout.write(`\x1b[${rendered}A`);
        for (let index = 0; index < rendered; index += 1) stdout.write("\x1b[2K\n");
        stdout.write(`\x1b[${rendered}A`);
      }
      resolve(item);
    };

    const onData = (chunk: string): void => {
      let index = 0;
      while (index < chunk.length) {
        const three = chunk.slice(index, index + 3);
        if (UP.includes(three)) {
          cursor = Math.max(0, cursor - 1);
          index += 3;
          continue;
        }
        if (DOWN.includes(three)) {
          cursor = Math.min(items.length - 1, cursor + 1);
          index += 3;
          continue;
        }

        const char = chunk[index];
        index += 1;

        if (char === "\r" || char === "\n") {
          const item = items[cursor];
          if (item) finish(item);
          return;
        }
        if (char === "\x03" || char === "\x1b" || char === "q") {
          finish(null);
          return;
        }
        if (char === "k") cursor = Math.max(0, cursor - 1);
        if (char === "j") cursor = Math.min(items.length - 1, cursor + 1);
      }

      scroll();
      draw();
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdout.write(HIDE_CURSOR);
    draw();
    stdin.on("data", onData);
  });
}
