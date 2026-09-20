import test from "node:test";
import assert from "node:assert/strict";
import { parseUnixLsof, parseWindowsPids } from "../src/process.js";

test("parses unique Windows PIDs", () => {
  assert.deepEqual(parseWindowsPids("1234\r\n5678\r\n1234\r\n"), [1234, 5678]);
});

test("parses lsof PID records", () => {
  assert.deepEqual(parseUnixLsof("p1234\ncnode\np5678\np1234\n"), [1234, 5678]);
});
