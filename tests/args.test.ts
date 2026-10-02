import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/args.js";

const EMPTY = { ports: [], help: false, version: false, yes: false, list: false, noColor: false };

test("parses multiple ports and deduplicates", () => {
  assert.deepEqual(parseArgs(["3000", "5173", "3000"]), { ...EMPTY, ports: [3000, 5173] });
});

test("parses flags", () => {
  assert.deepEqual(parseArgs(["-l", "--yes"]), { ...EMPTY, yes: true, list: true });
  assert.deepEqual(parseArgs(["--list", "-y", "-f"]), { ...EMPTY, yes: true, list: true });
  assert.deepEqual(parseArgs(["--help"]), { ...EMPTY, help: true });
  assert.deepEqual(parseArgs(["-v"]), { ...EMPTY, version: true });
  assert.deepEqual(parseArgs(["--no-color", "3000"]), { ...EMPTY, noColor: true, ports: [3000] });
});

test("parses --match with a pattern", () => {
  assert.deepEqual(parseArgs(["--match", "next-server"]), { ...EMPTY, match: "next-server" });
  assert.deepEqual(parseArgs(["-m", "^node$"]), { ...EMPTY, match: "^node$" });
  assert.deepEqual(parseArgs(["--match=vue-cli"]), { ...EMPTY, match: "vue-cli" });
});

test("rejects invalid input", () => {
  assert.equal(parseArgs(["abc"]), undefined);
  assert.equal(parseArgs(["0"]), undefined);
  assert.equal(parseArgs(["65536"]), undefined);
  assert.equal(parseArgs(["3000", "--nope"]), undefined);
  assert.equal(parseArgs(["-1"]), undefined);
  assert.equal(parseArgs(["--match"]), undefined);
  assert.equal(parseArgs(["--match", "--yes"]), undefined);
  assert.equal(parseArgs(["--match", "a", "--match", "b"]), undefined);
  assert.equal(parseArgs(["--match="]), undefined);
});
