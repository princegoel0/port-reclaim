#!/usr/bin/env node

import readline from "node:readline/promises";
import process from "node:process";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createProcessRunner, type PortProcess, type ProcessRunner } from "./process.js";
import { parseArgs } from "./args.js";
import { loadConfig } from "./config.js";

const USAGE = `Usage: port-reclaim [options] <PORT ...>

Safely reclaim local ports held by stale development processes.

Options:
  -l, --list     Report what is using each port without killing anything.
  -y, --yes      Terminate processes from other directories without prompting.
  -h, --help     Show this help message.
  -v, --version  Show the installed version.

Ports may also come from the "port-reclaim" key in package.json:
  "port-reclaim": { "ports": [3000, 5173], "ignore": [5432] }
Ports listed in .reclaimignore (one per line, '#' starts a comment) are never touched.`;

function printUsage(): void {
  console.error(USAGE);
}

function sameDirectory(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const normalizedLeft = path.normalize(path.resolve(left));
  const normalizedRight = path.normalize(path.resolve(right));
  return process.platform === "win32" ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
}

function formatAge(ageMs: number): string {
  const totalSeconds = Math.floor(ageMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${totalSeconds % 60}s`;
  return `${totalSeconds}s`;
}

function describe(portProcess: PortProcess): string {
  const details = [`PID ${portProcess.pid}`];
  if (portProcess.cwd) details.push(`'${portProcess.cwd}'`);
  if (portProcess.ageMs !== undefined) details.push(`up ${formatAge(portProcess.ageMs)}`);
  if (portProcess.protocol === "udp") details.push("udp");
  return `'${portProcess.name}' (${details.join(", ")})`;
}

async function confirm(portProcess: PortProcess, port: number): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(`Port ${port} is used by ${describe(portProcess)}. Use an interactive terminal to confirm termination, or rerun with --yes.`);
    return false;
  }
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`Port ${port} is used by ${describe(portProcess)}. Kill it? (y/N) `);
  prompt.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function version(): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

interface ReclaimOptions {
  yes: boolean;
  list: boolean;
}

async function reclaimPort(port: number, runner: ProcessRunner, options: ReclaimOptions): Promise<boolean> {
  const portProcesses = await runner.discover(port);
  if (portProcesses.length === 0) {
    if (options.list) console.log(`Port ${port} is free.`);
    return true;
  }
  let free = true;
  const currentDirectory = process.cwd();
  for (const portProcess of portProcesses) {
    if (options.list) {
      const origin = sameDirectory(portProcess.cwd, currentDirectory)
        ? "matches the current directory"
        : portProcess.cwd ? `'${portProcess.cwd}'` : "an unreadable working directory";
      const docker = portProcess.docker ? " [docker]" : "";
      console.log(`Port ${port} is used by ${describe(portProcess)}${docker} — ${origin}.`);
      continue;
    }
    if (portProcess.docker) {
      console.error(`Port ${port} is used by ${describe(portProcess)}, which appears to be a Docker process. Refusing to kill it — stop the container instead (for example 'docker stop <container>').`);
      free = false;
      continue;
    }
    const shouldTerminate = sameDirectory(portProcess.cwd, currentDirectory) || options.yes || await confirm(portProcess, port);
    if (!shouldTerminate) {
      free = false;
      continue;
    }
    await runner.terminate(portProcess.pid);
    console.log(`Released port ${port} from ${portProcess.name} (PID ${portProcess.pid}).`);
  }
  return free;
}

export async function main(argv: string[] = process.argv.slice(2), runner: ProcessRunner = createProcessRunner()): Promise<number> {
  const options = parseArgs(argv);
  if (!options) {
    printUsage();
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.version) {
    console.log(await version());
    return 0;
  }

  const config = await loadConfig(process.cwd());
  const ignored = new Set(config.ignore);
  const ports = options.ports.length > 0 ? options.ports : config.ports;
  if (ports.length === 0) {
    printUsage();
    return 2;
  }

  let exitCode = 0;
  for (const port of ports) {
    if (ignored.has(port)) {
      console.log(`Port ${port} is protected by .reclaimignore or config — skipped.`);
      continue;
    }
    const free = await reclaimPort(port, runner, options);
    if (!free) exitCode = 1;
  }
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code)).catch((error: Error) => {
    console.error(`port-reclaim: ${error.message}`);
    process.exit(1);
  });
}
