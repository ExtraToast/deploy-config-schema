import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";
import { renderTraefik } from "../src/adapters/traefik.js";

const sample = YAML.parse(readFileSync(new URL("../samples/deploy-config.yaml", import.meta.url), "utf8"));

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
