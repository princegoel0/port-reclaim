import { readFile } from "node:fs/promises";
import path from "node:path";

export interface ReclaimConfig {
  ports: number[];
  ignore: number[];
}

function toPortList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ports: number[] = [];
  for (const entry of value) {
    const port = typeof entry === "number" ? entry : typeof entry === "string" && /^\d+$/.test(entry) ? Number(entry) : NaN;
    if (Number.isInteger(port) && port >= 1 && port <= 65535 && !ports.includes(port)) ports.push(port);
  }
  return ports;
}

export function parseReclaimignore(content: string): number[] {
  const ports: number[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const port = Number(trimmed);
    if (Number.isInteger(port) && port >= 1 && port <= 65535 && !ports.includes(port)) ports.push(port);
  }
  return ports;
}

export function parsePackageConfig(json: unknown): ReclaimConfig {
  if (typeof json !== "object" || json === null) return { ports: [], ignore: [] };
  const key = (json as Record<string, unknown>)["port-reclaim"];
  if (typeof key !== "object" || key === null) return { ports: [], ignore: [] };
  const config = key as Record<string, unknown>;
  return { ports: toPortList(config.ports), ignore: toPortList(config.ignore) };
}

export async function loadConfig(cwd: string): Promise<ReclaimConfig> {
  let ports: number[] = [];
  let ignore: number[] = [];
  try {
    const pkg = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8")) as unknown;
    const config = parsePackageConfig(pkg);
    ports = config.ports;
    ignore = config.ignore;
  } catch {
    // No readable package.json or no usable config key.
  }
  try {
    const extra = parseReclaimignore(await readFile(path.join(cwd, ".reclaimignore"), "utf8"));
    ignore = [...new Set([...ignore, ...extra])];
  } catch {
    // No .reclaimignore file.
  }
  return { ports, ignore };
}
