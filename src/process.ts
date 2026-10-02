import { execFile } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";
import net from "node:net";
import dgram from "node:dgram";
import pidCwd from "pid-cwd";

const execFileAsync = promisify(execFile);

export type Protocol = "tcp" | "udp";

export type PortState = "free" | "occupied" | "unknown";

export interface PortProcess {
  pid: number;
  name: string;
  cwd?: string;
  protocol?: Protocol;
  ageMs?: number;
  refusal?: string;
}

export interface ProcessRunner {
  discover(port: number): Promise<PortProcess[]>;
  terminate(pid: number): Promise<void>;
  probe(port: number): Promise<PortState>;
}

interface Discovered {
  pid: number;
  name: string;
  protocol: Protocol;
  ageMs?: number;
}

const DOCKER_PROCESS = /docker|vpnkit/i;
const SYSTEM_PID_CEILING = 4;

export function refusalReason(pid: number, name: string): string | undefined {
  if (DOCKER_PROCESS.test(name)) {
    return "it appears to be a Docker process — stop the container instead (for example 'docker stop <container>').";
  }
  if (pid <= SYSTEM_PID_CEILING) {
    return `PID ${pid} and below belong to the operating system itself — stop the service that owns the port instead.`;
  }
  return undefined;
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

export interface ProcessRow {
  pid: number;
  name: string;
  ageMs?: number;
  protocol?: Protocol;
}

function readProtocol(value: string | undefined): Protocol | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "tcp" || normalized === "udp") return normalized;
  return undefined;
}

function readAge(value: string | undefined): number | undefined {
  const ageMs = Number(value);
  return Number.isFinite(ageMs) && ageMs > 0 ? ageMs : undefined;
}

export function parsePipeTable(output: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  const seen = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split("|");
    if (columns.length < 2) continue;
    const pid = Number(columns[0]);
    if (!Number.isInteger(pid) || pid <= 0 || seen.has(pid)) continue;
    seen.add(pid);
    rows.push({ pid, name: columns[1].trim() || "unknown", ageMs: readAge(columns[2]), protocol: readProtocol(columns[3]) });
  }
  return rows;
}

export function parsePsTable(output: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  const seen = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.+?)\s+(\S+)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isInteger(pid) || pid <= 0 || seen.has(pid)) continue;
    seen.add(pid);
    rows.push({ pid, name: match[2].trim(), ageMs: parseEtime(match[3]) });
  }
  return rows;
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

function byPid(rows: ProcessRow[]): Map<number, ProcessRow> {
  return new Map(rows.map((row) => [row.pid, row]));
}

function describe(pid: number, protocol: Protocol, info: ProcessRow | undefined): Discovered {
  return { pid, protocol, name: info?.name ?? "unknown", ageMs: info?.ageMs };
}

async function discoverUnix(port: number): Promise<Discovered[]> {
  const protocols = new Map<number, Protocol>();
  for (const pid of parseUnixLsof(await run("lsof", ["-nP", "-iUDP:" + port, "-Fp"]))) protocols.set(pid, "udp");
  for (const pid of parseUnixLsof(await run("lsof", ["-nP", "-a", "-iTCP:" + port, "-sTCP:LISTEN", "-Fp"]))) protocols.set(pid, "tcp");
  if (protocols.size === 0) return [];
  const output = await run("ps", ["-p", [...protocols.keys()].join(","), "-o", "pid=,comm=,etime="]);
  const infos = byPid(parsePsTable(output));
  return [...protocols].map(([pid, protocol]) => describe(pid, protocol, infos.get(pid)));
}

function windowsNameLoop(protocol: string): string {
  // StartTime is local-time, so compare against Now rather than UtcNow or the age comes out negative.
  return `foreach ($id in $pids) { $proc = Get-Process -Id $id; if ($proc) { $age = ''; try { $age = [DateTime]::Now.Subtract($proc.StartTime).TotalMilliseconds } catch { }; Write-Output "$id|$($proc.ProcessName)|$age|${protocol}" } else { Write-Output "$id|unknown||${protocol}" } }`;
}

function windowsNamesScript(pids: number[]): string {
  return [`$pids = @(${pids.join(",")})`, windowsNameLoop("")].join("; ");
}

async function discoverWindows(port: number): Promise<Discovered[]> {
  // netstat is an order of magnitude cheaper than a PowerShell cold start, so it decides
  // whether anything is on the port; PowerShell is only paid for when a name is needed.
  const entries = parseNetstatPids(await run("netstat.exe", ["-ano"]), port);
  if (entries.length === 0) return [];
  const infos = byPid(parsePipeTable(await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsNamesScript(entries.map((entry) => entry.pid))])));
  return entries.map((entry) => describe(entry.pid, entry.protocol, infos.get(entry.pid)));
}

function probePort(port: number, protocol: Protocol): Promise<PortState> {
  return new Promise((resolve) => {
    if (protocol === "tcp") {
      const server = net.createServer();
      server.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "EADDRINUSE" ? "occupied" : "unknown"));
      server.once("listening", () => server.close(() => resolve("free")));
      server.listen(port);
      return;
    }
    const socket = dgram.createSocket("udp4");
    socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "EADDRINUSE" ? "occupied" : "unknown"));
    socket.once("listening", () => socket.close(() => resolve("free")));
    socket.bind(port);
  });
}

async function probePortState(port: number): Promise<PortState> {
  const tcp = await probePort(port, "tcp");
  if (tcp === "occupied") return "occupied";
  const udp = await probePort(port, "udp");
  if (udp === "occupied") return "occupied";
  return tcp === "free" && udp === "free" ? "free" : "unknown";
}

export function createProcessRunner(): ProcessRunner {
  return {
    async discover(port) {
      const discovered = process.platform === "win32" ? await discoverWindows(port) : await discoverUnix(port);
      return Promise.all(discovered.map(async (entry) => ({
        ...entry,
        cwd: (await pidCwd(entry.pid)) ?? undefined,
        refusal: refusalReason(entry.pid, entry.name),
      })));
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
    },
    probe: probePortState,
  };
}
