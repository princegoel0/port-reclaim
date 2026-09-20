#!/usr/bin/env node

import readline from "node:readline/promises";
import process from "node:process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createProcessRunner, type PortProcess, type ProcessRunner } from "./process.js";

function usage(): never {
  console.error("Usage: port-reclaim <PORT>");
  process.exit(2);
}

function parsePort(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) usage();
  const port = Number(value);
  if (port < 1 || port > 65535) usage();
  return port;
}

function sameDirectory(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const normalizedLeft = path.normalize(path.resolve(left));
  const normalizedRight = path.normalize(path.resolve(right));
  return process.platform === "win32" ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
}

async function confirm(portProcess: PortProcess, port: number): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(`Port ${port} is used by '${portProcess.name}'${portProcess.cwd ? ` in '${portProcess.cwd}'` : ""}. Use an interactive terminal to confirm termination.`);
    return false;
  }
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`Port ${port} is used by '${portProcess.name}'${portProcess.cwd ? ` in '${portProcess.cwd}'` : ""}. Kill it? (y/N) `);
  prompt.close();
  return /^y(es)?$/i.test(answer.trim());
}

export async function main(runner: ProcessRunner = createProcessRunner()): Promise<number> {
  const port = parsePort(process.argv[2]);
  const processes = await runner.discover(port);
  if (processes.length === 0) return 0;

  const currentDirectory = process.cwd();
  for (const portProcess of processes) {
    const shouldTerminate = sameDirectory(portProcess.cwd, currentDirectory) || await confirm(portProcess, port);
    if (!shouldTerminate) return 1;
    await runner.terminate(portProcess.pid);
    console.log(`Released port ${port} from ${portProcess.name} (PID ${portProcess.pid}).`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code)).catch((error: Error) => {
    console.error(`port-reclaim: ${error.message}`);
    process.exit(1);
  });
}
