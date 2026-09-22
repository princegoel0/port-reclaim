export interface CliOptions {
  ports: number[];
  help: boolean;
  version: boolean;
  yes: boolean;
  list: boolean;
}

const HELP_FLAGS = new Set(["--help", "-h"]);
const VERSION_FLAGS = new Set(["--version", "-v"]);
const YES_FLAGS = new Set(["--yes", "-y", "--force", "-f"]);
const LIST_FLAGS = new Set(["--list", "-l"]);

function parsePort(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : undefined;
}

export function parseArgs(argv: string[]): CliOptions | undefined {
  const options: CliOptions = { ports: [], help: false, version: false, yes: false, list: false };
  for (const arg of argv) {
    if (HELP_FLAGS.has(arg)) {
      options.help = true;
    } else if (VERSION_FLAGS.has(arg)) {
      options.version = true;
    } else if (YES_FLAGS.has(arg)) {
      options.yes = true;
    } else if (LIST_FLAGS.has(arg)) {
      options.list = true;
    } else {
      const port = parsePort(arg);
      if (port === undefined) return undefined;
      if (!options.ports.includes(port)) options.ports.push(port);
    }
  }
  return options;
}
