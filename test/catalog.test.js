import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";
import { renderEdgeCatalog, renderEdgeRouteCatalog } from "../src/adapters/catalog.js";

const sample = YAML.parse(readFileSync(new URL("../samples/deploy-config.yaml", import.meta.url), "utf8"));

test("edge catalog renders deterministic ConfigMap entries for exposure intent", () => {
  const first = renderEdgeCatalog(sample);
  const second = renderEdgeCatalog(sample);

  assert.equal(first, second);
  assert.match(first, /kind: ConfigMap/);
  assert.match(first, /name: platform-edge-catalog/);
  assert.match(first, /edge-catalog\.yaml: \|/);
  assert.match(first, /cluster: personal-stack/);
  assert.match(first, /name: app-ui/);
  assert.match(first, /exposure: public/);
  assert.match(first, /access: direct/);
  assert.match(first, /host: example\.net/);
  assert.match(first, /name: vault/);
  assert.match(first, /access: cluster_internal/);
});

test("edge route catalog renders generic route rules with path exceptions", () => {
  const rendered = renderEdgeRouteCatalog(sample);

  assert.match(rendered, /name: platform-edge-route-catalog/);
  assert.match(rendered, /edge-route-catalog\.yaml: \|/);
  assert.match(rendered, /name: assistant-api-health/);
  assert.match(rendered, /service: assistant-api/);
  assert.match(rendered, /exact_paths:/);
  assert.match(rendered, /- \/api\/actuator\/health/);
  assert.match(rendered, /excluded_exact_paths:/);
  assert.match(rendered, /host: assistant\.example\.net/);
});
