import { execFile } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";
import pidCwd from "pid-cwd";

const execFileAsync = promisify(execFile);

export interface PortProcess {
  pid: number;
  name: string;
  cwd?: string;
}

export interface ProcessRunner {
  discover(port: number): Promise<PortProcess[]>;
  terminate(pid: number): Promise<void>;
}

function parsePidList(output: string): number[] {
  return [...new Set(output.split(/\r?\n/).map((line) => Number(line.trim())).filter((pid) => Number.isInteger(pid) && pid > 0))];
}

export function parseWindowsPids(output: string): number[] {
  return parsePidList(output);
}

export function parseUnixLsof(output: string): number[] {
  return [...new Set([...output.matchAll(/^p(\d+)$/gm)].map((match) => Number(match[1])))];
}

async function run(command: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 });
    return result.stdout;
  } catch (error) {
    const processError = error as NodeJS.ErrnoException & { stdout?: string };
    if (processError.stdout) return processError.stdout;
    if (processError.code === "ENOENT") {
      throw new Error(`Required system command '${command}' was not found.`);
    }
    return "";
  }
}

async function windowsPids(port: number): Promise<number[]> {
  const script = `$ErrorActionPreference = 'SilentlyContinue'; Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess`;
  const output = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  if (output.trim()) return parseWindowsPids(output);

  const netstat = await run("netstat.exe", ["-ano", "-p", "TCP"]);
  return parseWindowsPids(netstat.split(/\r?\n/).filter((line) => {
    const columns = line.trim().split(/\s+/);
    return columns[0]?.toUpperCase() === "TCP" && columns[1]?.endsWith(`:${port}`) && columns[3]?.toUpperCase() === "LISTENING";
  }).map((line) => line.trim().split(/\s+/).at(-1)).join("\n"));
}

async function unixPids(port: number): Promise<number[]> {
  const output = await run("lsof", ["-nP", "-a", "-iTCP:" + port, "-sTCP:LISTEN", "-Fp"]);
  return parseUnixLsof(output);
}

async function processName(pid: number): Promise<string> {
  if (process.platform === "win32") {
    const output = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid}).ProcessName`]);
    return output.trim() || "unknown";
  }
  const output = await run("ps", ["-p", String(pid), "-o", "comm="]);
  return output.trim() || "unknown";
}

async function processCwd(pid: number): Promise<string | undefined> {
  return (await pidCwd(pid)) ?? undefined;
}

export function createProcessRunner(): ProcessRunner {
  return {
    async discover(port) {
      const pids = process.platform === "win32" ? await windowsPids(port) : await unixPids(port);
      return Promise.all(pids.map(async (pid) => ({ pid, name: await processName(pid), cwd: await processCwd(pid) })));
    },
    async terminate(pid) {
      if (process.platform === "win32") {
        await run("taskkill.exe", ["/PID", String(pid), "/T"]);
        return;
      }
      process.kill(pid, "SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 250));
      try {
        process.kill(pid, 0);
        process.kill(pid, "SIGKILL");
      } catch {
        // The process exited after SIGTERM.
      }
    }
  };
}
