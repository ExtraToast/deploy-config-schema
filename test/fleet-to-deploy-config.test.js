import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";
import { runCli } from "../src/cli.js";
import { fleetToDeployConfig } from "../src/index.js";

const fleetPath = new URL("./fixtures/fleet-to-deploy-config/fleet.yaml", import.meta.url);
const expectedPath = new URL("./fixtures/fleet-to-deploy-config/expected.deploy-config.json", import.meta.url);

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

test("fleetToDeployConfig converts fleet inventory with explicit and generated route rules", () => {
  const fleet = YAML.parse(readFileSync(fleetPath, "utf8"));
  const expected = readFileSync(expectedPath, "utf8");

  assert.equal(`${JSON.stringify(fleetToDeployConfig(fleet), null, 2)}\n`, expected);
});

test("fleet-to-deploy-config CLI emits byte-stable deploy-config JSON", async () => {
  const stdout = stream();
  const stderr = stream();
  const expected = readFileSync(expectedPath, "utf8");

  const exitCode = await runCli(["fleet-to-deploy-config", fleetPath.pathname], { stdout, stderr });

  assert.equal(exitCode, 0);
  assert.equal(stderr.text(), "");
  assert.equal(stdout.text(), expected);
});
