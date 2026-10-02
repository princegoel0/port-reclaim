#!/usr/bin/env node

import readline from "node:readline/promises";
import process from "node:process";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createProcessRunner, type PortProcess, type ProcessRunner } from "./process.js";
import { parseArgs } from "./args.js";
import { loadConfig } from "./config.js";
import { paint, setColourMode } from "./style.js";

const USAGE = `Usage: port-reclaim [options] [PORT ...]

Safely reclaim local ports held by stale development processes.

Options:
  -l, --list         Report what is using each port without killing anything.
  -y, --yes          Terminate processes without prompting (never overrides a refusal).
  -m, --match REGEX  Reclaim every port held by a process whose name matches REGEX.
      --no-color     Disable coloured output.
  -h, --help         Show this help message.
  -v, --version      Show the installed version.

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

function heading(ports: number[]): string {
  return ports.length > 1 ? `Ports ${ports.join(", ")}` : `Port ${ports[0]}`;
}

function lowercaseHeading(ports: number[]): string {
  const text = heading(ports);
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function describe(portProcess: PortProcess): string {
  const details = [`PID ${portProcess.pid}`];
  if (portProcess.cwd) details.push(`'${portProcess.cwd}'`);
  if (portProcess.ageMs !== undefined) details.push(`up ${formatAge(portProcess.ageMs)}`);
  if (portProcess.protocol === "udp") details.push("udp");
  return `${paint("bold", `'${portProcess.name}'`)} (${paint("dim", details.join(", "))})`;
}

async function confirm(portProcess: PortProcess, ports: number[]): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(`${paint("red", `${heading(ports)} is used by ${describe(portProcess)}.`)} ${paint("yellow", "Use an interactive terminal to confirm termination, or rerun with --yes.")}`);
    return false;
  }
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(paint("yellow", `${heading(ports)} is used by ${describe(portProcess)}. Kill it? (y/N) `));
  prompt.close();
  return /^y(es)?$/i.test(answer.trim());
}

interface ReclaimOptions {
  yes: boolean;
  list: boolean;
}

async function resolveProcess(portProcess: PortProcess, runner: ProcessRunner, options: ReclaimOptions, ports: number[]): Promise<boolean> {
  if (portProcess.refusal) {
    console.error(paint("red", `${heading(ports)} is used by ${describe(portProcess)}. Refusing to kill it — ${portProcess.refusal}`));
    return false;
  }
  const sameProject = sameDirectory(portProcess.cwd, process.cwd()) && !portProcess.alwaysConfirm;
  if (!(sameProject || options.yes || await confirm(portProcess, ports))) return false;
  await runner.terminate(portProcess.pid);
  console.log(paint("green", `Released ${lowercaseHeading(ports)} from ${portProcess.name} (PID ${portProcess.pid}).`));
  return true;
}

function reportProcess(portProcess: PortProcess, port: number): void {
  const origin = sameDirectory(portProcess.cwd, process.cwd())
    ? "matches the current directory"
    : portProcess.cwd ? `'${portProcess.cwd}'` : "an unreadable working directory";
  const refusal = portProcess.refusal ? ` ${paint("red", "[refused]")}` : "";
  console.log(`Port ${port} is used by ${describe(portProcess)}${refusal} — ${origin}.`);
}

async function version(): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function reclaimPort(port: number, runner: ProcessRunner, options: ReclaimOptions, known?: PortProcess[]): Promise<boolean> {
  const portProcesses = known ?? await runner.discover(port);
  if (portProcesses.length === 0) {
    const state = await runner.probe(port);
    if (state === "occupied") {
      console.error(paint("red", `Port ${port} is in use by a process port-reclaim cannot see — it may belong to another user, an elevated process, or a socket still closing.`));
      console.error(`Rerun with sudo or from an elevated PowerShell session, or inspect it with 'netstat -ano | findstr :${port}'.`);
      return false;
    }
    if (options.list) {
      console.log(state === "free" ? paint("green", `Port ${port} is free.`) : paint("yellow", `Port ${port} appears free but could not be verified.`));
    }
    return true;
  }
  let free = true;
  for (const portProcess of portProcesses) {
    if (options.list) {
      reportProcess(portProcess, port);
      continue;
    }
    if (!(await resolveProcess(portProcess, runner, options, [port]))) free = false;
  }
  return free;
}

function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

async function reclaimMatching(runner: ProcessRunner, options: ReclaimOptions, pattern: string, ignored: Set<number>): Promise<number> {
  const found = await runner.discoverListening(new RegExp(pattern, "i"));
  const matches = found.filter((portProcess) => (portProcess.ports?.length ?? 0) > 0);
  if (matches.length === 0) {
    console.log(paint("dim", `No listening process matches '${pattern}'.`));
    return 0;
  }
  const sorted = matches.sort((left, right) => (left.ports?.[0] ?? 0) - (right.ports?.[0] ?? 0));
  let exitCode = 0;
  for (const portProcess of sorted) {
    const ports = portProcess.ports ?? [];
    const protectedPort = ports.find((port) => ignored.has(port));
    if (protectedPort !== undefined) {
      console.log(paint("yellow", `Skipping ${portProcess.name} (PID ${portProcess.pid}) — port ${protectedPort} is protected by .reclaimignore or config.`));
      continue;
    }
    if (options.list) {
      for (const port of ports) reportProcess(portProcess, port);
      continue;
    }
    if (!(await resolveProcess(portProcess, runner, options, ports))) exitCode = 1;
  }
  return exitCode;
}

export async function main(argv: string[] = process.argv.slice(2), runner: ProcessRunner = createProcessRunner()): Promise<number> {
  const options = parseArgs(argv);
  if (!options) {
    printUsage();
    return 2;
  }
  setColourMode(options.noColor ? "never" : "auto");
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

  if (options.match !== undefined) {
    if (!isValidPattern(options.match)) {
      console.error(paint("red", `port-reclaim: '${options.match}' is not a valid regular expression.`));
      return 2;
    }
    if (options.ports.length > 0) {
      console.error(paint("red", "port-reclaim: pass either ports or --match, not both."));
      printUsage();
      return 2;
    }
    return reclaimMatching(runner, options, options.match, ignored);
  }

  const ports = options.ports.length > 0 ? options.ports : config.ports;
  if (ports.length === 0) {
    printUsage();
    return 2;
  }

  let exitCode = 0;
  for (const port of ports) {
    if (ignored.has(port)) {
      console.log(paint("yellow", `Port ${port} is protected by .reclaimignore or config — skipped.`));
      continue;
    }
    if (!(await reclaimPort(port, runner, options))) exitCode = 1;
  }
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code)).catch((error: Error) => {
    console.error(paint("red", `port-reclaim: ${error.message}`));
    process.exit(1);
  });
}
