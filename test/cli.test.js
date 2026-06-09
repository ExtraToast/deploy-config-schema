import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { runCli } from "../src/cli.js";

const sample = YAML.parse(readFileSync(new URL("../samples/deploy-config.yaml", import.meta.url), "utf8"));

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

function tempFile(name, content) {
  const path = join(mkdtempSync(join(tmpdir(), "deploy-config-schema-")), name);
  writeFileSync(path, content);
  return path;
}

function tempConfig(config) {
  return tempFile("deploy-config.yaml", YAML.stringify(config));
}

function parseDiagnostic(text) {
  return JSON.parse(text).diagnostics[0];
}

test("help and missing command usage write to stderr", async () => {
  const helpStdout = stream();
  const helpStderr = stream();
  const missingStdout = stream();
  const missingStderr = stream();

  const helpExitCode = await runCli(["--help"], { stdout: helpStdout, stderr: helpStderr });
  const missingExitCode = await runCli([], { stdout: missingStdout, stderr: missingStderr });

  assert.equal(helpExitCode, 0);
  assert.equal(helpStdout.text(), "");
  assert.match(helpStderr.text(), /deploy-config-schema validate/);
  assert.equal(missingExitCode, 1);
  assert.equal(missingStdout.text(), "");
  assert.match(missingStderr.text(), /deploy-config-schema render/);
});

test("validate command emits structured success", async () => {
  const stdout = stream();
  const stderr = stream();

  const exitCode = await runCli(["validate", "deploy-config", "samples/deploy-config.yaml"], { stdout, stderr });

  assert.equal(exitCode, 0);
  assert.equal(stderr.text(), "");
  const result = JSON.parse(stdout.text());
  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.results[0], {
    file: "samples/deploy-config.yaml",
    kind: "deploy-config",
    valid: true,
    diagnostics: [],
  });
});

test("validate command supports text output", async () => {
  const stdout = stream();
  const stderr = stream();

  const exitCode = await runCli(["validate", "deploy-config", "samples/deploy-config.yaml", "--format", "text"], { stdout, stderr });

  assert.equal(exitCode, 0);
  assert.equal(stdout.text(), "deploy-config samples/deploy-config.yaml: valid\n");
  assert.equal(stderr.text(), "");
});

test("validate command supports auto kind inference and multiple files", async () => {
  const stdout = stream();
  const stderr = stream();
  const arbitraryPlatformPath = tempFile("config.yaml", readFileSync(new URL("../fixtures/platform/single-node.platform.yaml", import.meta.url), "utf8"));

  const exitCode = await runCli([
    "validate",
    "auto",
    arbitraryPlatformPath,
    "fixtures/round4/service-intent-renderable.sample.yaml",
    "fixtures/round3/fleet-inventory.sample.yaml",
    "fixtures/round3/vault-dynamic-secrets.sample.yaml",
  ], { stdout, stderr });

  const result = JSON.parse(stdout.text());

  assert.equal(exitCode, 0);
  assert.equal(stderr.text(), "");
  assert.deepEqual(result.results.map((item) => item.kind), [
    "platform",
    "service-intent",
    "fleet-inventory",
    "vault-dynamic-secrets",
  ]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, []);
});

test("validate command reports malformed config diagnostics", async () => {
  const stdout = stream();
  const stderr = stream();
  const configPath = tempFile("broken.yaml", "version: [\n");

  const exitCode = await runCli(["validate", "auto", configPath], { stdout, stderr });
  const result = JSON.parse(stdout.text());

  assert.equal(exitCode, 1);
  assert.equal(stderr.text(), "");
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "E_PARSE");
  assert.equal(result.diagnostics[0].file, configPath);
  assert.equal(result.results[0].kind, "auto");
  assert.equal(result.results[0].valid, false);
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

test("render command writes output to stdout without an output path", async () => {
  const stdout = stream();
  const stderr = stream();

  const exitCode = await runCli(["render", "traefik-public", "samples/deploy-config.yaml"], { stdout, stderr });

  assert.equal(exitCode, 0);
  assert.equal(stderr.text(), "");
  assert.match(stdout.text(), /kind: IngressRoute/);
  assert.match(stdout.text(), /name: assistant-api-health/);
});

test("usage errors are reported for invalid commands and options", async () => {
  const unknownCommandStdout = stream();
  const unknownCommandStderr = stream();
  const badFormatStdout = stream();
  const badFormatStderr = stream();
  const missingOutputStdout = stream();
  const missingOutputStderr = stream();
  const unknownOptionStdout = stream();
  const unknownOptionStderr = stream();

  const unknownCommandExitCode = await runCli(["unknown"], {
    stdout: unknownCommandStdout,
    stderr: unknownCommandStderr,
  });
  const badFormatExitCode = await runCli(
    ["validate", "deploy-config", "samples/deploy-config.yaml", "--format", "xml"],
    { stdout: badFormatStdout, stderr: badFormatStderr },
  );
  const missingOutputExitCode = await runCli(
    ["render", "traefik-public", "samples/deploy-config.yaml", "--output"],
    { stdout: missingOutputStdout, stderr: missingOutputStderr },
  );
  const unknownOptionExitCode = await runCli(
    ["validate", "deploy-config", "samples/deploy-config.yaml", "--bad-option"],
    { stdout: unknownOptionStdout, stderr: unknownOptionStderr },
  );

  assert.equal(unknownCommandExitCode, 1);
  assert.equal(parseDiagnostic(unknownCommandStderr.text()).message, "unknown command: unknown");
  assert.equal(badFormatExitCode, 1);
  assert.equal(parseDiagnostic(badFormatStderr.text()).message, "--format must be json or text");
  assert.equal(missingOutputExitCode, 1);
  assert.equal(parseDiagnostic(missingOutputStderr.text()).message, "--output requires a path");
  assert.equal(unknownOptionExitCode, 1);
  assert.equal(parseDiagnostic(unknownOptionStderr.text()).message, "unknown option: --bad-option");
});

test("render command reports adapter selection errors", async () => {
  const unknownAdapterStdout = stream();
  const unknownAdapterStderr = stream();
  const notSelectedStdout = stream();
  const notSelectedStderr = stream();
  const config = structuredClone(sample);
  config.adapter_output_intent.adapters = ["traefik-public"];
  const configPath = tempConfig(config);

  const unknownAdapterExitCode = await runCli(
    ["render", "unknown-adapter", "samples/deploy-config.yaml"],
    { stdout: unknownAdapterStdout, stderr: unknownAdapterStderr },
  );
  const notSelectedExitCode = await runCli(
    ["render", "traefik-lan", configPath],
    { stdout: notSelectedStdout, stderr: notSelectedStderr },
  );

  assert.equal(unknownAdapterExitCode, 1);
  assert.equal(parseDiagnostic(unknownAdapterStderr.text()).code, "E_ADAPTER_UNKNOWN");
  assert.equal(notSelectedExitCode, 1);
  assert.equal(parseDiagnostic(notSelectedStderr.text()).code, "E_ADAPTER_NOT_SELECTED");
});

test("non-Traefik adapters render implemented output", async () => {
  const stdout = stream();
  const stderr = stream();

  const exitCode = await runCli(["render", "gatus", "samples/deploy-config.yaml"], { stdout, stderr });

  assert.equal(exitCode, 0);
  assert.equal(stderr.text(), "");
  assert.match(stdout.text(), /kind: ConfigMap/);
  assert.match(stdout.text(), /name: gatus-endpoints/);
});
