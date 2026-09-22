import test from "node:test";
import assert from "node:assert/strict";
import { parseEtime, parseNetstatPids, parseUnixLsof, parseWindowsPids } from "../src/process.js";

test("parses unique Windows PIDs", () => {
  assert.deepEqual(parseWindowsPids("1234\r\n5678\r\n1234\r\n"), [1234, 5678]);
});

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
