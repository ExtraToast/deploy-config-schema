import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";
import { renderGatus } from "../src/adapters/gatus.js";

const sample = YAML.parse(readFileSync(new URL("../samples/deploy-config.yaml", import.meta.url), "utf8"));

test("gatus renders deterministic endpoint ConfigMap for ingress and monitoring backends", () => {
  const first = renderGatus(sample);
  const second = renderGatus(sample);

  assert.equal(first, second);
  assert.match(first, /kind: ConfigMap/);
  assert.match(first, /name: gatus-endpoints/);
  assert.match(first, /namespace: observability/);
  assert.match(first, /endpoints\.yaml: \|/);
  assert.match(first, /name: app-ui/);
  assert.match(first, /url: https:\/\/example\.net\/healthz/);
  assert.match(first, /name: assistant-api \(internal\)/);
  assert.match(first, /url: http:\/\/assistant-api\.assistant-system\.svc\.cluster\.local:8080\/api\/actuator\/health/);
  assert.match(first, /name: assistant-api \(external\)/);
  assert.match(first, /name: jellyfin-https/);
  assert.match(first, /url: tcp:\/\/jellyfin\.media\.svc\.cluster\.local:8920/);
  assert.match(first, /\[CONNECTED\] == true/);
  assert.match(first, /name: postgres/);
  assert.match(first, /url: tcp:\/\/postgres-rw\.data-system\.svc\.cluster\.local:5432/);
});
