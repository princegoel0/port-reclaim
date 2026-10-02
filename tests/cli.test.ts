import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { main } from "../src/cli.js";
import { refusalReason, isProtectedService } from "../src/process.js";
import type { PortProcess, PortState, ProcessRunner } from "../src/process.js";

interface Calls {
  discovered: number[];
  terminated: number[];
  probed: number[];
  patterns: string[];
}

function fakeRunner(byPort: Record<number, PortProcess[]>, probeState: PortState = "free", listening: PortProcess[] = []): { runner: ProcessRunner; calls: Calls } {
  const calls: Calls = { discovered: [], terminated: [], probed: [], patterns: [] };
  return {
    calls,
    runner: {
      async discover(port) {
        calls.discovered.push(port);
        return byPort[port] ?? [];
      },
      async discoverListening(match) {
        calls.patterns.push(match.source);
        return listening;
      },
      async terminate(pid) {
        calls.terminated.push(pid);
      },
      async probe(port) {
        calls.probed.push(port);
        return probeState;
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

test("reports a port held by a process it cannot see and exits 1", async () => {
  const { runner, calls } = fakeRunner({}, "occupied");
  const output = capture();
  try {
    assert.equal(await main(["3000"], runner), 1);
    assert.deepEqual(calls.probed, [3000]);
    assert.match(output.error.join("\n"), /cannot see/);
  } finally {
    output.restore();
  }
});

test("does not probe ports that already have visible processes", async () => {
  const { runner, calls } = fakeRunner({ 3000: [{ pid: 42, name: "node", cwd: process.cwd() }] });
  const output = capture();
  try {
    assert.equal(await main(["3000"], runner), 0);
    assert.deepEqual(calls.probed, []);
    assert.deepEqual(calls.terminated, [42]);
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

test("prompts before killing a database even when it shares the project directory", async () => {
  const postgres = { pid: 4242, name: "postgres", cwd: process.cwd(), alwaysConfirm: isProtectedService("postgres") };
  const { runner, calls } = fakeRunner({ 5432: [postgres] });
  const output = capture();
  try {
    assert.equal(await main(["5432"], runner), 1);
    assert.deepEqual(calls.terminated, []);
    assert.match(output.error.join("\n"), /interactive terminal/);
  } finally {
    output.restore();
  }
});

test("--yes still overrides the protected-service prompt", async () => {
  const postgres = { pid: 4242, name: "postgres", cwd: process.cwd(), alwaysConfirm: isProtectedService("postgres") };
  const { runner, calls } = fakeRunner({ 5432: [postgres] });
  const output = capture();
  try {
    assert.equal(await main(["5432", "--yes"], runner), 0);
    assert.deepEqual(calls.terminated, [4242]);
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
  const { runner, calls } = fakeRunner({ 3000: [{ pid: 9, name: "docker-proxy", refusal: refusalReason(9, "docker-proxy") }] });
  const output = capture();
  try {
    assert.equal(await main(["3000", "--yes"], runner), 1);
    assert.deepEqual(calls.terminated, []);
    assert.match(output.error.join("\n"), /Docker/);
  } finally {
    output.restore();
  }
});

test("refuses to kill operating-system PIDs even with --yes", async () => {
  const { runner, calls } = fakeRunner({ 8080: [{ pid: 4, name: "System", refusal: refusalReason(4, "System") }] });
  const output = capture();
  try {
    assert.equal(await main(["8080", "--yes"], runner), 1);
    assert.deepEqual(calls.terminated, []);
    assert.match(output.error.join("\n"), /operating system/);
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

function staleServer(): PortProcess[] {
  return [{ pid: 77, name: "next-server", cwd: "/elsewhere", ports: [3000, 5173] }];
}

test("--match reclaims every port a matching process holds and kills it once", async () => {
  const { runner, calls } = fakeRunner({}, "free", staleServer());
  const output = capture();
  try {
    assert.equal(await main(["--match", "next-server", "--yes"], runner), 0);
    assert.deepEqual(calls.patterns, ["next-server"]);
    assert.deepEqual(calls.discovered, []);
    assert.deepEqual(calls.terminated, [77]);
    assert.match(output.log.join("\n"), /Released ports 3000, 5173 from next-server \(PID 77\)/);
  } finally {
    output.restore();
  }
});

test("--match honours refusals for protected processes", async () => {
  const docker = { pid: 9, name: "docker-proxy", ports: [8080], refusal: refusalReason(9, "docker-proxy") };
  const { runner, calls } = fakeRunner({}, "free", [docker]);
  const output = capture();
  try {
    assert.equal(await main(["--match", "docker", "--yes"], runner), 1);
    assert.deepEqual(calls.terminated, []);
    assert.match(output.error.join("\n"), /Docker/);
  } finally {
    output.restore();
  }
});

test("--match skips a process holding a protected port", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "port-reclaim-"));
  const originalCwd = process.cwd();
  const postgres = { pid: 4242, name: "postgres", cwd: "/var/lib/postgresql", ports: [5432], alwaysConfirm: isProtectedService("postgres") };
  const { runner, calls } = fakeRunner({}, "free", [postgres]);
  const output = capture();
  try {
    await writeFile(path.join(dir, ".reclaimignore"), "5432\n");
    process.chdir(dir);
    assert.equal(await main(["--match", "postgres", "--yes"], runner), 0);
    assert.deepEqual(calls.terminated, []);
    assert.match(output.log.join("\n"), /protected/);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
    output.restore();
  }
});

test("--match reports when nothing listens under that name", async () => {
  const { runner, calls } = fakeRunner({}, "free", []);
  const output = capture();
  try {
    assert.equal(await main(["--match", "nothing-here", "--yes"], runner), 0);
    assert.deepEqual(calls.terminated, []);
    assert.match(output.log.join("\n"), /No listening process matches/);
  } finally {
    output.restore();
  }
});

test("an invalid --match pattern exits 2", async () => {
  const { runner } = fakeRunner({});
  const output = capture();
  try {
    assert.equal(await main(["--match", "("], runner), 2);
    assert.match(output.error.join("\n"), /not a valid regular expression/);
  } finally {
    output.restore();
  }
});

test("--match cannot be combined with ports", async () => {
  const { runner } = fakeRunner({});
  const output = capture();
  try {
    assert.equal(await main(["3000", "--match", "node"], runner), 2);
    assert.match(output.error.join("\n"), /either ports or --match/);
  } finally {
    output.restore();
  }
});

test("colour codes reach a terminal and --no-color suppresses them", async () => {
  const originalTty = process.stdout.isTTY;
  const originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  const byPort = { 3000: [{ pid: 42, name: "node", cwd: process.cwd() }] };
  try {
    const coloured = capture();
    await main(["3000"], fakeRunner(byPort).runner);
    coloured.restore();
    const plain = capture();
    await main(["3000", "--no-color"], fakeRunner(byPort).runner);
    plain.restore();
    assert.match(coloured.log.join("\n"), /\u001b\[32m/);
    assert.doesNotMatch(plain.log.join("\n"), /\u001b\[/);
  } finally {
    Object.defineProperty(process.stdout, "isTTY", { value: originalTty, configurable: true });
    if (originalNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNoColor;
  }
});
