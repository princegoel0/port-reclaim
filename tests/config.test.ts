import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, parsePackageConfig, parseReclaimignore } from "../src/config.js";

test("parses .reclaimignore with comments and invalid lines", () => {
  const content = "# databases\n5432\n\n  6379  \nnot-a-port\n70000\n5432\n";
  assert.deepEqual(parseReclaimignore(content), [5432, 6379]);
});

test("parses the package.json config key", () => {
  assert.deepEqual(parsePackageConfig({ "port-reclaim": { ports: [3000, "5173"], ignore: [5432] } }), { ports: [3000, 5173], ignore: [5432] });
  assert.deepEqual(parsePackageConfig({}), { ports: [], ignore: [] });
  assert.deepEqual(parsePackageConfig({ "port-reclaim": "nope" }), { ports: [], ignore: [] });
  assert.deepEqual(parsePackageConfig(null), { ports: [], ignore: [] });
});

test("loadConfig merges package.json key and .reclaimignore", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "port-reclaim-"));
  try {
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "demo", "port-reclaim": { ports: [3000, "5173"], ignore: [5432] } }));
    await writeFile(path.join(dir, ".reclaimignore"), "# db\n5432\n6379\n");
    const config = await loadConfig(dir);
    assert.deepEqual(config, { ports: [3000, 5173], ignore: [5432, 6379] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig returns an empty config when nothing is configured", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "port-reclaim-"));
  try {
    assert.deepEqual(await loadConfig(dir), { ports: [], ignore: [] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
