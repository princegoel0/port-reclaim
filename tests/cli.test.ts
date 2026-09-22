import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { main } from "../src/cli.js";
import type { PortProcess, ProcessRunner } from "../src/process.js";

interface Calls {
  discovered: number[];
  terminated: number[];
}

function fakeRunner(byPort: Record<number, PortProcess[]>): { runner: ProcessRunner; calls: Calls } {
  const calls: Calls = { discovered: [], terminated: [] };
  return {
    calls,
    runner: {
      async discover(port) {
        calls.discovered.push(port);
        return byPort[port] ?? [];
      },
      async terminate(pid) {
        calls.terminated.push(pid);
      },
    },
  };
}

function capture(): { log: string[]; error: string[]; restore: () => void } {
  const log: string[] = [];
  const error: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => log.push(args.join(" "));
  console.error = (...args: unknown[]) => error.push(args.join(" "));
  return {
    log,
    error,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

test("exits 0 when all ports are free", async () => {
  const { runner, calls } = fakeRunner({});
  const output = capture();
  try {
    assert.equal(await main(["3000", "5173"], runner), 0);
    assert.deepEqual(calls.discovered, [3000, 5173]);
    assert.deepEqual(calls.terminated, []);
  } finally {
    output.restore();
  }
});

test("terminates processes from the current directory without prompting", async () => {
  const { runner, calls } = fakeRunner({ 3000: [{ pid: 42, name: "node", cwd: process.cwd() }] });
  const output = capture();
  try {
    assert.equal(await main(["3000"], runner), 0);
    assert.deepEqual(calls.terminated, [42]);
  } finally {
    output.restore();
  }
});

test("declines foreign processes when not interactive", async () => {
  const { runner, calls } = fakeRunner({ 3000: [{ pid: 7, name: "node", cwd: "/somewhere/else" }] });
  const output = capture();
  try {
    assert.equal(await main(["3000"], runner), 1);
    assert.deepEqual(calls.terminated, []);
    assert.match(output.error.join("\n"), /interactive terminal/);
  } finally {
    output.restore();
  }
});

test("--yes terminates foreign processes across multiple ports", async () => {
  const { runner, calls } = fakeRunner({
    3000: [{ pid: 7, name: "node", cwd: "/somewhere/else" }],
    5173: [{ pid: 8, name: "node", cwd: "/elsewhere" }],
  });
  const output = capture();
  try {
    assert.equal(await main(["3000", "5173", "--yes"], runner), 0);
    assert.deepEqual(calls.terminated, [7, 8]);
  } finally {
    output.restore();
  }
});

test("--list reports without terminating", async () => {
  const { runner, calls } = fakeRunner({
    3000: [{ pid: 7, name: "node", cwd: "/somewhere/else", ageMs: 93784000, protocol: "tcp" }],
  });
  const output = capture();
  try {
    assert.equal(await main(["--list", "3000"], runner), 0);
    assert.deepEqual(calls.terminated, []);
    assert.match(output.log.join("\n"), /PID 7/);
    assert.match(output.log.join("\n"), /up 1d 2h/);
    assert.match(output.log.join("\n"), /\/somewhere\/else/);
  } finally {
    output.restore();
  }
});

test("refuses to kill Docker processes even with --yes", async () => {
  const { runner, calls } = fakeRunner({ 3000: [{ pid: 9, name: "docker-proxy", docker: true }] });
  const output = capture();
  try {
    assert.equal(await main(["3000", "--yes"], runner), 1);
    assert.deepEqual(calls.terminated, []);
    assert.match(output.error.join("\n"), /Docker/);
  } finally {
    output.restore();
  }
});

test("skips ports protected by .reclaimignore in the current directory", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "port-reclaim-"));
  const originalCwd = process.cwd();
  const { runner, calls } = fakeRunner({ 5432: [{ pid: 1, name: "postgres", cwd: "/var/lib/postgresql" }] });
  const output = capture();
  try {
    await writeFile(path.join(dir, ".reclaimignore"), "5432\n");
    process.chdir(dir);
    assert.equal(await main(["5432"], runner), 0);
    assert.deepEqual(calls.discovered, []);
    assert.match(output.log.join("\n"), /protected/);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
    output.restore();
  }
});

test("invalid input exits 2", async () => {
  const { runner } = fakeRunner({});
  const output = capture();
  try {
    assert.equal(await main(["nope"], runner), 2);
    assert.match(output.error.join("\n"), /Usage: port-reclaim/);
  } finally {
    output.restore();
  }
});
