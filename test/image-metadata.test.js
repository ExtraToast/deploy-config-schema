import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";
import { renderImageMetadata } from "../src/adapters/image-metadata.js";

const sample = YAML.parse(readFileSync(new URL("../samples/deploy-config.yaml", import.meta.url), "utf8"));

test("image metadata renders deterministic workload audit output", () => {
  const first = renderImageMetadata(sample);
  const second = renderImageMetadata(sample);

  assert.equal(first, second);
  assert.match(first, /cluster: personal-stack/);
  assert.match(first, /service: app-ui/);
  assert.match(first, /repository: ghcr\.io\/extratoast\/app-ui/);
  assert.match(first, /strategy: latest_tag/);
  assert.match(first, /poll_schedule: "@every 2m"/);
  assert.match(first, /service: jellyfin/);
  assert.match(first, /source: third_party/);
  assert.match(first, /strategy: pinned/);
});
