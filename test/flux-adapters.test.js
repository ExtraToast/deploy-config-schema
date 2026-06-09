import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";
import { renderFluxPacks } from "../src/adapters/flux-packs.js";
import { inferFluxLayers, renderFluxRoot } from "../src/adapters/flux-root.js";
import { renderFluxSource } from "../src/adapters/flux-source.js";
import { expandPlatform } from "../src/minimal/expand.js";
import { createPathAllocator } from "../src/render-plan/paths.js";

const website = readYaml("../fixtures/platform/single-node.platform.yaml");
const personalStack = readYaml("../fixtures/platform/multi-site.platform.yaml");

function readYaml(relativePath) {
  return YAML.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function context(platform) {
  const expansion = expandPlatform(platform);
  assert.equal(expansion.valid, true);
  const gatusGroup = expansion.platform.packs?.observability?.gatus !== undefined ? "observability" : "utility-system";
  return {
    artifacts: {
      ...expansion.artifacts,
      platform: expansion.platform,
    },
    pathAllocator: createPathAllocator({
      gitopsRoot: expansion.platform.gitops.root,
      environment: expansion.platform.gitops.environment,
      gatusGroup,
    }),
    overrides: {},
  };
}

function parseDocuments(file) {
  return YAML.parseAllDocuments(file.content).map((document) => document.toJSON());
}

test("flux-root renders deterministic website-like dependency graph", () => {
  const platform = structuredClone(website);
  platform.services.mailer = {
    group: "mail",
    image: "ghcr.io/example/mailer:1.0.0",
    port: 8080,
  };
  const input = context(platform);
  const files = renderFluxRoot(input);
  const kustomizations = files.find((file) => file.path.endsWith("/kustomizations.yaml"));
  const docs = parseDocuments(kustomizations);

  assert.deepEqual(files.map((file) => file.path), [
    "platform/cluster/flux/clusters/production/kustomization.yaml",
    "platform/cluster/flux/clusters/production/kustomizations.yaml",
  ]);
  assert.deepEqual(docs.map((doc) => doc.metadata.name), [
    "apps-core",
    "apps-vso-secrets",
    "apps-edge",
    "apps-data",
    "apps-mail",
    "apps-stateless",
    "apps-utility-system",
  ]);
  assert.deepEqual(docs.find((doc) => doc.metadata.name === "apps-stateless").spec.dependsOn, [
    { name: "apps-core" },
    { name: "apps-data" },
    { name: "apps-edge" },
    { name: "apps-vso-secrets" },
  ]);
  assert.deepEqual(renderFluxRoot(input), files);
});

test("flux-root models personal-stack optional layers", () => {
  const layers = inferFluxLayers(context(personalStack)).map((layer) => layer.name);

  assert.deepEqual(layers, [
    "apps-core",
    "apps-vso-secrets",
    "apps-metallb-config",
    "apps-edge",
    "apps-observability",
    "apps-media",
    "apps-stateless",
  ]);
});

test("flux-source renders known pack sources and declared chart services", () => {
  const platform = structuredClone(website);
  platform.packs.data = {
    mariadb: {
      values: {
        database: "site",
        username: "site",
        storageSize: "20Gi",
      },
    },
    search: {
      namespace: "search-system",
      source: {
        kind: "OCIRepository",
        name: "search-chart",
        url: "oci://registry.example.test/charts/search",
      },
      chart: {
        name: "search",
        version: "1.2.3",
      },
      values: {
        replicaCount: 2,
      },
    },
  };
  const files = renderFluxSource(context(platform));
  const byPath = new Map(files.map((file) => [file.path, file]));

  assert.ok(byPath.has("platform/cluster/flux/apps/core/cert-manager/source.yaml"));
  assert.ok(byPath.has("platform/cluster/flux/apps/core/traefik/source.yaml"));
  assert.ok(byPath.has("platform/cluster/flux/apps/data/bitnami-source.yaml"));
  assert.ok(byPath.has("platform/cluster/flux/apps/data/bitnami-oci-source.yaml"));
  assert.ok(byPath.has("platform/cluster/flux/apps/data/mariadb/release.yaml"));
  assert.ok(byPath.has("platform/cluster/flux/apps/data/search/source.yaml"));
  assert.ok(byPath.has("platform/cluster/flux/apps/data/search/release.yaml"));
  assert.match(byPath.get("platform/cluster/flux/apps/data/search/source.yaml").content, /kind: OCIRepository/);
  assert.match(byPath.get("platform/cluster/flux/apps/data/search/release.yaml").content, /replicaCount: 2/);
  assert.doesNotMatch(files.map((file) => file.content).join("\n"), /\$\{[A-Z0-9_]+\}/);
});

test("flux-packs composes blueprint manifests into consumer-owned paths", () => {
  const files = renderFluxPacks(context(personalStack));
  const byPath = new Map(files.map((file) => [file.path, file]));

  assert.ok(byPath.has("platform/cluster/flux/apps/core/ingress-controller/kustomization.yaml"));
  assert.ok(byPath.has("platform/cluster/flux/apps/core/lan-ingress-controller/kustomization.yaml"));
  assert.ok(byPath.has("platform/cluster/flux/apps/core/kustomization.yaml"));
  assert.ok(byPath.has("platform/cluster/flux/apps/metallb-config/config.yaml"));
  assert.ok(byPath.has("platform/cluster/flux/apps/metallb-config/kustomization.yaml"));
  assert.ok(byPath.has("platform/cluster/flux/apps/edge/cluster-issuer-cloudflare.yaml"));
  assert.ok(byPath.has("platform/cluster/flux/apps/observability/gatus/kustomization.yaml"));
  assert.equal(byPath.has("platform/cluster/flux/apps/observability/gatus/gatus-endpoints-configmap.yaml"), false);
  assert.equal(byPath.has("platform/cluster/flux/apps/core/ingress-controller/source.yaml"), false);
  assert.match(byPath.get("platform/cluster/flux/apps/observability/gatus/kustomization.yaml").content, /gatus-endpoints-configmap.yaml/);
  assert.doesNotMatch(files.map((file) => file.content).join("\n"), /\$\{[A-Z0-9_]+\}/);
  assert.deepEqual(renderFluxPacks(context(personalStack)), files);
});
