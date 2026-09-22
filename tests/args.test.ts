import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/args.js";

test("parses multiple ports and deduplicates", () => {
  assert.deepEqual(parseArgs(["3000", "5173", "3000"]), {
    ports: [3000, 5173],
    help: false,
    version: false,
    yes: false,
    list: false,
  });
});

test("parses flags", () => {
  assert.deepEqual(parseArgs(["-l", "--yes"]), { ports: [], help: false, version: false, yes: true, list: true });
  assert.deepEqual(parseArgs(["--list", "-y", "-f"]), { ports: [], help: false, version: false, yes: true, list: true });
  assert.deepEqual(parseArgs(["--help"]), { ports: [], help: true, version: false, yes: false, list: false });
  assert.deepEqual(parseArgs(["-v"]), { ports: [], help: false, version: true, yes: false, list: false });
});

test("rejects invalid input", () => {
  assert.equal(parseArgs(["abc"]), undefined);
  assert.equal(parseArgs(["0"]), undefined);
  assert.equal(parseArgs(["65536"]), undefined);
  assert.equal(parseArgs(["3000", "--nope"]), undefined);
  assert.equal(parseArgs(["-1"]), undefined);
});
