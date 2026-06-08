import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCli } from "../src/cli.js";

function stream() {
  return {
    chunks: [],
    write(chunk) {
      this.chunks.push(String(chunk));
      return true;
    },
    text() {
      return this.chunks.join("");
    },
  };
}

test("validate command emits structured success", async () => {
  const stdout = stream();
  const stderr = stream();

  const exitCode = await runCli(["validate", "samples/deploy-config.yaml"], { stdout, stderr });

  assert.equal(exitCode, 0);
  assert.equal(stderr.text(), "");
  assert.deepEqual(JSON.parse(stdout.text()), { valid: true, diagnostics: [] });
});

test("render command writes deterministic output to a requested path", async () => {
  const stdout = stream();
  const stderr = stream();
  const outputPath = join(mkdtempSync(join(tmpdir(), "deploy-config-schema-")), "traefik.yaml");

  const exitCode = await runCli(
    ["render", "traefik-public", "samples/deploy-config.yaml", "--output", outputPath],
    { stdout, stderr },
  );

  const rendered = readFileSync(outputPath, "utf8");
  assert.equal(exitCode, 0);
  assert.equal(stdout.text(), "");
  assert.equal(stderr.text(), "");
  assert.match(rendered, /kind: IngressRoute/);
  assert.match(rendered, /name: assistant-api-health/);
});

test("stub adapters validate input and return TODO diagnostics", async () => {
  const stdout = stream();
  const stderr = stream();

  const exitCode = await runCli(["render", "gatus", "samples/deploy-config.yaml"], { stdout, stderr });
  const body = JSON.parse(stderr.text());

  assert.equal(exitCode, 2);
  assert.equal(stdout.text(), "");
  assert.equal(body.valid, false);
  assert.equal(body.diagnostics[0].code, "E_ADAPTER_TODO");
});
