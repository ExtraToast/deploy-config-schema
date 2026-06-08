import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";
import { renderTraefik } from "../src/adapters/traefik.js";

const sample = YAML.parse(readFileSync(new URL("../samples/deploy-config.yaml", import.meta.url), "utf8"));

function clone(value) {
  return structuredClone(value);
}

test("public Traefik output is deterministic and contains required route fields", () => {
  const first = renderTraefik(sample, "traefik-public");
  const second = renderTraefik(sample, "traefik-public");

  assert.equal(first, second);
  assert.match(first, /kind: IngressRoute/);
  assert.match(first, /name: app-ui/);
  assert.match(first, /namespace: edge-system/);
  assert.match(first, /kubernetes\.io\/ingress\.class: traefik-public/);
  assert.match(first, /match: 'Host\(`example\.net`\)'/);
  assert.match(first, /name: assistant-api/);
  assert.match(first, /namespace: assistant-system/);
  assert.match(first, /port: 8080/);
  assert.match(first, /tls: \{\}/);
  assert.match(first, /external-dns\.alpha\.kubernetes\.io\/target: 203\.0\.113\.10/);
  assert.match(first, /external-dns\.alpha\.kubernetes\.io\/target: 198\.51\.100\.25/);
  assert.doesNotMatch(first, /name: postgres/);
});

test("LAN Traefik output includes only LAN-eligible routes with LAN class", () => {
  const rendered = renderTraefik(sample, "traefik-lan");

  assert.match(rendered, /name: jellyfin-lan/);
  assert.match(rendered, /kubernetes\.io\/ingress\.class: traefik-lan/);
  assert.match(rendered, /match: 'Host\(`media\.example\.net`\)'/);
  assert.doesNotMatch(rendered, /name: app-ui/);
  assert.doesNotMatch(rendered, /external-dns\.alpha\.kubernetes\.io\/target/);
  assert.doesNotMatch(rendered, /name: forward-auth/);
});

test("Traefik rendering falls back to host labels when routes are omitted", () => {
  const config = clone(sample);
  config.ingress_intent.route_rules = [];
  delete config.ingress_intent.defaults.public_dns_target;

  const rendered = renderTraefik(config, "traefik-public");

  assert.match(rendered, /external-dns\.alpha\.kubernetes\.io\/target: ingress\.example\.net/);
  assert.match(rendered, /name: gatus-root-redirect/);
  assert.match(rendered, /match: 'Host\(`example\.net`\)'/);
});

test("Traefik rendering rejects unsupported adapters", () => {
  assert.throws(() => renderTraefik(sample, "gatus"), /unsupported Traefik adapter/);
});
