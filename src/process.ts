import { execFile } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";
import pidCwd from "pid-cwd";

const execFileAsync = promisify(execFile);

export type Protocol = "tcp" | "udp";

export interface PortProcess {
  pid: number;
  name: string;
  cwd?: string;
  protocol?: Protocol;
  ageMs?: number;
  docker?: boolean;
}

export interface ProcessRunner {
  discover(port: number): Promise<PortProcess[]>;
  terminate(pid: number): Promise<void>;
}

const DOCKER_PROCESS = /docker|vpnkit/i;

function isDockerProcess(name: string): boolean {
  return DOCKER_PROCESS.test(name);
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

export function parseEtime(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const dayParts = trimmed.split("-");
  const days = dayParts.length === 2 ? Number(dayParts[0]) : 0;
  const units = (dayParts.length === 2 ? dayParts[1] : dayParts[0]).split(":");
  if (dayParts.length > 2 || (units.length !== 2 && units.length !== 3) || units.some((unit) => !/^\d+$/.test(unit)) || !Number.isInteger(days)) {
    return undefined;
  }
  const numbers = units.map(Number);
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (numbers.length === 3) {
    [hours, minutes, seconds] = numbers;
  } else {
    [minutes, seconds] = numbers;
  }
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

export interface NetstatPid {
  pid: number;
  protocol: Protocol;
}

export function parseNetstatPids(output: string, port: number): NetstatPid[] {
  const results: NetstatPid[] = [];
  const seen = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    const protocol = columns[0]?.toUpperCase();
    if (protocol !== "TCP" && protocol !== "UDP") continue;
    if (columns[1]?.split(":").at(-1) !== String(port)) continue;
    if (protocol === "TCP" && columns[3]?.toUpperCase() !== "LISTENING") continue;
    const pid = Number(columns.at(-1));
    if (Number.isInteger(pid) && pid > 0 && !seen.has(pid)) {
      seen.add(pid);
      results.push({ pid, protocol: protocol.toLowerCase() as Protocol });
    }
  }
  return results;
}

async function run(command: string, args: string[], checked = false): Promise<string> {
  try {
    const result = await execFileAsync(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 });
    return result.stdout;
  } catch (error) {
    const processError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (processError.stdout) return processError.stdout;
    if (processError.code === "ENOENT") {
      throw new Error(`Required system command '${command}' was not found.`);
    }
    if (checked) {
      const detail = processError.stderr?.trim() || processError.message;
      throw new Error(`Command '${command}' failed: ${detail}`);
    }
    return "";
  }
}

async function unixPortProcesses(port: number): Promise<Map<number, Protocol>> {
  const merged = new Map<number, Protocol>();
  const udp = await run("lsof", ["-nP", "-iUDP:" + port, "-Fp"]);
  for (const pid of parseUnixLsof(udp)) merged.set(pid, "udp");
  const tcp = await run("lsof", ["-nP", "-a", "-iTCP:" + port, "-sTCP:LISTEN", "-Fp"]);
  for (const pid of parseUnixLsof(tcp)) merged.set(pid, "tcp");
  return merged;
}

async function windowsPortProcesses(port: number): Promise<Map<number, Protocol>> {
  const merged = new Map<number, Protocol>();
  const tcpScript = `$ErrorActionPreference = 'SilentlyContinue'; Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess`;
  for (const pid of parseWindowsPids(await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", tcpScript]))) {
    merged.set(pid, "tcp");
  }
  const udpScript = `$ErrorActionPreference = 'SilentlyContinue'; Get-NetUDPConnection -LocalPort ${port} | Select-Object -ExpandProperty OwningProcess`;
  for (const pid of parseWindowsPids(await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", udpScript]))) {
    if (!merged.has(pid)) merged.set(pid, "udp");
  }
  if (merged.size > 0) return merged;
  const netstat = await run("netstat.exe", ["-ano"]);
  for (const entry of parseNetstatPids(netstat, port)) {
    if (!merged.has(entry.pid)) merged.set(entry.pid, entry.protocol);
  }
  return merged;
}

async function processInfo(pid: number): Promise<{ name: string; ageMs?: number }> {
  if (process.platform === "win32") {
    const script = `$ErrorActionPreference = 'SilentlyContinue'; $p = Get-Process -Id ${pid}; if ($p) { $p.ProcessName; if ($p.StartTime) { [DateTime]::UtcNow.Subtract($p.StartTime).TotalMilliseconds } }`;
    const output = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    const [name, age] = output.split(/\r?\n/);
    const ageMs = Number(age?.trim());
    return { name: name?.trim() || "unknown", ageMs: Number.isFinite(ageMs) && ageMs > 0 ? ageMs : undefined };
  }
  const output = await run("ps", ["-p", String(pid), "-o", "comm=", "-o", "etime="]);
  const trimmed = output.trim();
  if (!trimmed) return { name: "unknown" };
  const match = /^(.*?)\s+(\S+)$/.exec(trimmed);
  if (!match) return { name: trimmed };
  return { name: match[1].trim(), ageMs: parseEtime(match[2]) };
}

async function processCwd(pid: number): Promise<string | undefined> {
  return (await pidCwd(pid)) ?? undefined;
}

export function createProcessRunner(): ProcessRunner {
  return {
    async discover(port) {
      const entries = process.platform === "win32" ? await windowsPortProcesses(port) : await unixPortProcesses(port);
      return Promise.all([...entries].map(async ([pid, protocol]) => {
        const info = await processInfo(pid);
        return {
          pid,
          name: info.name,
          protocol,
          cwd: await processCwd(pid),
          ageMs: info.ageMs,
          docker: isDockerProcess(info.name),
        };
      }));
    },
    async terminate(pid) {
      if (process.platform === "win32") {
        // Without /F, taskkill cannot end console processes such as node dev servers.
        await run("taskkill.exe", ["/F", "/PID", String(pid), "/T"], true);
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
