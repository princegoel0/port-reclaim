import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { colourEnabled, paint, setColourMode } from "../src/style.js";

test("paint wraps text only when colour is enabled", () => {
  setColourMode("always");
  assert.equal(paint("green", "ok"), "\u001b[32mok\u001b[0m");
  assert.equal(paint("dim", "PID 7"), "\u001b[2mPID 7\u001b[0m");
  setColourMode("never");
  assert.equal(paint("green", "ok"), "ok");
});

test("auto mode defers to NO_COLOR and never mode always strips", () => {
  const original = process.env.NO_COLOR;
  try {
    process.env.NO_COLOR = "1";
    setColourMode("auto");
    assert.equal(colourEnabled(), false);
    setColourMode("never");
    assert.equal(colourEnabled(), false);
    setColourMode("always");
    assert.equal(colourEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = original;
    setColourMode("auto");
  }
});
