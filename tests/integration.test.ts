import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { spawn, type ChildProcess } from "node:child_process";
import { createProcessRunner } from "../src/process.js";

// The listener runs in its own process on purpose: the runner then has to find it the way it
// finds a real stale dev server, through netstat/lsof and the platform name lookup, rather than
// through anything this test already knows. Unit tests with a fake runner cannot catch a wrong
// cmdlet name or a missing taskkill flag; these two can.
const LISTENER = [
  "const net = require('net'), dgram = require('dgram');",
  // With `node -e`, the first argument after the script lands in argv[1], not argv[2].
  "if (process.argv[1] === 'udp') {",
  "  const s = dgram.createSocket('udp4');",
  "  s.bind(0, '127.0.0.1', () => console.log(JSON.stringify({ port: s.address().port })));",
  "} else {",
  "  const srv = net.createServer();",
  "  srv.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: srv.address().port })));",
  "}",
].join(" ");

interface Running {
  child: ChildProcess;
  pid: number;
  port: number;
}

function start(kind: "tcp" | "udp"): Promise<Running> {
  const child = spawn(process.execPath, ["-e", LISTENER, kind], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise<Running>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const end = stdout.indexOf("\n");
      if (end < 0 || child.pid === undefined) return;
      const { port } = JSON.parse(stdout.slice(0, end)) as { port: number };
      resolve({ child, pid: child.pid, port });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => reject(new Error(`listener exited early (code ${code}) ${stderr.trim()}`)));
  });
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", () => resolve()));
}

test("finds and releases a real TCP listener using the platform path", async (context) => {
  let running: Running;
  try {
    running = await start("tcp");
  } catch (error) {
    context.skip(`cannot bind a local socket in this environment: ${(error as Error).message}`);
    return;
  }
  const { child, pid, port } = running;
  const runner = createProcessRunner();
  try {
    const found = await runner.discover(port);
    const match = found.find((entry) => entry.pid === pid);
    assert.ok(match, `expected to find PID ${pid} on port ${port}, saw ${JSON.stringify(found)}`);
    assert.match(match.name, /node/i);
    assert.equal(match.protocol, "tcp");
    assert.equal(match.refusal, undefined, "a plain node server must not be protected");
    await runner.terminate(pid);
    await waitForExit(child);
    assert.equal(await runner.probe(port), "free");
  } finally {
    child.kill();
  }
});

test("finds a real UDP socket, which Windows discovery silently missed", async (context) => {
  let running: Running;
  try {
    running = await start("udp");
  } catch (error) {
    context.skip(`cannot bind a local socket in this environment: ${(error as Error).message}`);
    return;
  }
  const { child, pid, port } = running;
  const runner = createProcessRunner();
  try {
    const found = await runner.discover(port);
    const match = found.find((entry) => entry.pid === pid);
    assert.ok(match, `expected to find UDP PID ${pid} on port ${port}, saw ${JSON.stringify(found)}`);
    assert.equal(match.protocol, "udp");
    await runner.terminate(pid);
    await waitForExit(child);
  } finally {
    child.kill();
  }
});
