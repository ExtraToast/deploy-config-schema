import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ConfigLoadError, loadConfig } from "../src/config-loader.js";

function tempFile(name, content) {
  const path = join(mkdtempSync(join(tmpdir(), "deploy-config-schema-")), name);
  writeFileSync(path, content);
  return path;
}

test("loads JSON configs by extension", () => {
  const path = tempFile("deploy-config.json", JSON.stringify({ version: 1 }));

  assert.deepEqual(loadConfig(path), { version: 1 });
});

test("wraps parser failures in config load diagnostics", () => {
  const path = tempFile("deploy-config.json", "{");

  assert.throws(
    () => loadConfig(path),
    (error) => error instanceof ConfigLoadError && error.diagnostics[0].code === "E_PARSE",
  );
});
