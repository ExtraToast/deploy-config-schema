import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";
import { validateConfig } from "../src/validator.js";

const sample = YAML.parse(readFileSync(new URL("../samples/deploy-config.yaml", import.meta.url), "utf8"));

function clone(value) {
  return structuredClone(value);
}

function codesFor(config) {
  return validateConfig(config).diagnostics.map((diagnostic) => diagnostic.code);
}

test("valid sample has no diagnostics", () => {
  const result = validateConfig(clone(sample));

  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, []);
});

test("reports missing site references", () => {
  const config = clone(sample);
  config.nodes["frankfurt-contabo-1"].site = "missing-site";

  assert.ok(codesFor(config).includes("E_NODE_SITE_UNKNOWN"));
});

test("reports missing node references", () => {
  const config = clone(sample);
  config.placement_intent.node_affinity["app-ui"] = "missing-node";

  assert.ok(codesFor(config).includes("E_PLACEMENT_NODE_UNKNOWN"));
});

test("reports missing service references", () => {
  const config = clone(sample);
  config.access_intent.sso_protected.push("missing-service");

  assert.ok(codesFor(config).includes("E_ACCESS_SERVICE_UNKNOWN"));
});

test("reports missing backend for externally exposed kubernetes services", () => {
  const config = clone(sample);
  delete config.ingress_intent.kubernetes_backends["app-ui"];

  assert.ok(codesFor(config).includes("E_EXTERNAL_BACKEND_MISSING"));
});

test("reports missing host label for externally exposed services", () => {
  const config = clone(sample);
  delete config.access_intent.host_labels["app-ui"];

  assert.ok(codesFor(config).includes("E_EXTERNAL_HOST_LABEL_MISSING"));
});

test("reports duplicate exposure entries", () => {
  const config = clone(sample);
  config.exposure_intent.public_and_lan.push("app-ui");

  assert.ok(codesFor(config).includes("E_EXPOSURE_DUPLICATE"));
});

test("reports unsupported health probe type through schema diagnostics", () => {
  const config = clone(sample);
  config.ingress_intent.kubernetes_backends["app-ui"].health.type = "icmp";

  assert.ok(codesFor(config).includes("E_SCHEMA"));
});

test("reports image rollout contradictions", () => {
  const config = clone(sample);
  config.image_metadata.workloads.postgres.update.eligible = true;
  config.image_metadata.workloads.postgres.update.strategy = "latest_tag";

  const codes = codesFor(config);

  assert.ok(codes.includes("E_IMAGE_THIRD_PARTY_AUTO_UPDATE"));
  assert.ok(codes.includes("E_IMAGE_PINNED_LATEST_STRATEGY"));
});
