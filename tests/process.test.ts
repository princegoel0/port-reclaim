import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEtime,
  parseNetstatListeners,
  parseNetstatPids,
  parsePipeTable,
  parsePsTable,
  parseUnixLsof,
  parseUnixLsofListeners,
  isProtectedService,
  refusalReason,
} from "../src/process.js";

test("parses lsof PID records", () => {
  assert.deepEqual(parseUnixLsof("p1234\ncnode\np5678\np1234\n"), [1234, 5678]);
});

test("parses ps etime durations", () => {
  assert.equal(parseEtime("45"), undefined);
  assert.equal(parseEtime("34:56"), 2096000);
  assert.equal(parseEtime("12:34:56"), 45296000);
  assert.equal(parseEtime("1-02:03:04"), 93784000);
  assert.equal(parseEtime(""), undefined);
  assert.equal(parseEtime("abc"), undefined);
  assert.equal(parseEtime("1:2:3:4"), undefined);
});

test("parses one batched ps table, keeping spaces in command names", () => {
  const output = [
    "  1234 node             01:02:03",
    "  5678 Google Chrome        45:00",
    "ps: unknown process 9999",
  ].join("\n");
  assert.deepEqual(parsePsTable(output), [
    { pid: 1234, name: "node", ageMs: 3723000 },
    { pid: 5678, name: "Google Chrome", ageMs: 2700000 },
  ]);
});

test("parses pipe-delimited process rows", () => {
  assert.deepEqual(parsePipeTable("7|node|1500.5|udp\r\n8|python||\r\n"), [
    { pid: 7, name: "node", ageMs: 1500.5, protocol: "udp" },
    { pid: 8, name: "python", ageMs: undefined, protocol: undefined },
  ]);
});

test("drops PID 0, keeps PID 4 for the refusal layer, and deduplicates rows", () => {
  assert.deepEqual(parsePipeTable(["0|Idle|10|", "4|System|20|", "77|node|30|", "77|node|30|", "junk"].join("\r\n")), [
    { pid: 4, name: "System", ageMs: 20, protocol: undefined },
    { pid: 77, name: "node", ageMs: 30, protocol: undefined },
  ]);
});

test("parses every listener from a full netstat table", () => {
  const output = [
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       4",
    "  TCP    127.0.0.1:3000         127.0.0.1:51234        ESTABLISHED     9999",
    "  TCP    [::]:5173              [::]:0                 LISTENING       2222",
    "  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       2222",
    "  UDP    0.0.0.0:5353           *:*                                    3333",
    "  UDP    [::]:54321             *:*                                    0",
  ].join("\r\n");
  assert.deepEqual(parseNetstatListeners(output), [
    { pid: 4, port: 135, protocol: "tcp" },
    { pid: 2222, port: 5173, protocol: "tcp" },
    { pid: 3333, port: 5353, protocol: "udp" },
  ]);
});

test("parses grouped lsof field output into listeners", () => {
  const output = [
    "p4242",
    "n127.0.0.1:5432",
    "n[::1]:5432",
    "p77",
    "n*:3000",
    "n/tcp",
    "n/var/run/docker.sock",
  ].join("\n");
  assert.deepEqual(parseUnixLsofListeners(output, "tcp"), [
    { pid: 4242, port: 5432, protocol: "tcp" },
    { pid: 77, port: 3000, protocol: "tcp" },
  ]);
});

test("recognises data services that must never auto-kill", () => {
  assert.equal(isProtectedService("postgres"), true);
  assert.equal(isProtectedService("Redis-Server"), true);
  assert.equal(isProtectedService("  mysqld  "), true);
  assert.equal(isProtectedService("node"), false);
  assert.equal(isProtectedService("redis-cli"), false);
  assert.equal(isProtectedService("mongo"), false);
});

test("refuses Docker-named processes and operating-system PIDs", () => {
  assert.match(refusalReason(9, "docker-proxy") ?? "", /Docker/);
  assert.match(refusalReason(9, "vpnkit") ?? "", /Docker/);
  assert.match(refusalReason(4, "System") ?? "", /operating system/);
  assert.match(refusalReason(1, "systemd") ?? "", /operating system/);
  assert.equal(refusalReason(4242, "node"), undefined);
});

test("parses netstat TCP listeners and UDP sockets for an exact port", () => {
  const output = [
    "Active Connections",
    "",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1111",
    "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       2222",
    "  TCP    0.0.0.0:13000          0.0.0.0:0              LISTENING       3333",
    "  TCP    127.0.0.1:3000         127.0.0.1:51234        ESTABLISHED     4444",
    "  UDP    0.0.0.0:3000           *:*                                    5555",
    "  UDP    [::]:5353             *:*                                    6666",
  ].join("\r\n");
  assert.deepEqual(parseNetstatPids(output, 3000), [
    { pid: 2222, protocol: "tcp" },
    { pid: 5555, protocol: "udp" },
  ]);
});
