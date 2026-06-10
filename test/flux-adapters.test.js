import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { renderFluxPacks } from "../src/adapters/flux-packs.js";
import { FLUX_PACKS } from "../src/adapters/flux-utils.js";
import { inferFluxLayers, renderFluxRoot } from "../src/adapters/flux-root.js";
import { renderFluxSource } from "../src/adapters/flux-source.js";
import { expandPlatform } from "../src/minimal/expand.js";
import { createPathAllocator } from "../src/render-plan/paths.js";

const website = readYaml("../fixtures/platform/single-node.platform.yaml");
const personalStack = readYaml("../fixtures/platform/multi-site.platform.yaml");

function readYaml(relativePath) {
  return YAML.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

const fixtureBlueprintRegistry = {
  "packs/flux-core/cert-manager": coreBlueprint("cert-manager", "cert-manager", "cert-manager"),
  "packs/flux-core/external-dns-cloudflare": coreBlueprint("external-dns", "external-dns", "external-dns"),
  "packs/flux-core/traefik-public": coreBlueprint("ingress-system", "traefik", "traefik"),
  "packs/flux-core/traefik-lan": coreBlueprint("lan-ingress-system", "traefik", "traefik-lan"),
  "packs/flux-core/metallb": {
    ...coreBlueprint("metallb-system", "metallb", "metallb"),
    "address-pool.yaml": yaml({
      apiVersion: "metallb.io/v1beta1",
      kind: "IPAddressPool",
      metadata: { name: "lan-ingress", namespace: "metallb-system" },
      spec: { addresses: ["192.168.0.99-192.168.0.99"] },
    }),
  },
  "packs/flux-core/vso": coreBlueprint("vault-secrets-operator", "hashicorp", "vault-secrets-operator"),
  "packs/edge": {
    "namespace.yaml": namespace("edge-system"),
    "cluster-issuer-cloudflare.yaml": yaml({
      apiVersion: "cert-manager.io/v1",
      kind: "ClusterIssuer",
      metadata: { name: "cloudflare" },
      spec: { acme: { email: "admin@example.net" } },
    }),
    "traefik-default-tls.yaml": yaml({
      apiVersion: "traefik.io/v1alpha1",
      kind: "TLSStore",
      metadata: { name: "default", namespace: "edge-system" },
      spec: { defaultCertificate: { secretName: "wildcard-tls" } },
    }),
    "traefik-forward-auth-middleware.yaml": yaml({
      apiVersion: "traefik.io/v1alpha1",
      kind: "Middleware",
      metadata: { name: "forward-auth", namespace: "edge-system" },
      spec: { forwardAuth: { address: "http://forward-auth.edge-system.svc.cluster.local:4181" } },
    }),
    "kustomization.yaml": kustomization(["namespace.yaml", "cluster-issuer-cloudflare.yaml", "traefik-default-tls.yaml", "traefik-forward-auth-middleware.yaml"]),
  },
  "packs/observability": {
    "namespace.yaml": namespace("observability"),
    "kustomization.yaml": kustomization(["namespace.yaml", "gatus/kustomization.yaml"]),
    "gatus/config.yaml": yaml({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "gatus-config", namespace: "observability" },
    }),
    "gatus/deployment.yaml": yaml({
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "gatus", namespace: "observability" },
    }),
    "gatus/endpoints-placeholder.yaml": yaml({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "gatus-endpoints", namespace: "observability" },
    }),
    "gatus/kustomization.yaml": kustomization(["config.yaml", "endpoints-placeholder.yaml", "deployment.yaml", "service.yaml"]),
    "gatus/service.yaml": yaml({
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: "gatus", namespace: "observability" },
    }),
  },
};

function coreBlueprint(namespaceName, sourceName, releaseName) {
  return {
    "namespace.yaml": namespace(namespaceName),
    "source.yaml": yaml({
      apiVersion: "source.toolkit.fluxcd.io/v1",
      kind: "HelmRepository",
      metadata: { name: sourceName, namespace: namespaceName },
      spec: { interval: "1h", url: `https://charts.example.test/${sourceName}` },
    }),
    "release.yaml": yaml({
      apiVersion: "helm.toolkit.fluxcd.io/v2",
      kind: "HelmRelease",
      metadata: { name: releaseName, namespace: namespaceName },
      spec: {
        interval: "30m",
        chart: {
          spec: {
            chart: releaseName,
            version: "*",
            sourceRef: { kind: "HelmRepository", name: sourceName, namespace: namespaceName },
          },
        },
      },
    }),
    "kustomization.yaml": kustomization(["namespace.yaml", "source.yaml", "release.yaml"]),
  };
}

function namespace(name) {
  return yaml({
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name },
  });
}

function kustomization(resources) {
  return yaml({
    apiVersion: "kustomize.config.k8s.io/v1beta1",
    kind: "Kustomization",
    resources,
  });
}

function yaml(document) {
  return YAML.stringify(document, {
    indent: 2,
    lineWidth: 0,
    sortMapEntries: false,
  }).trimEnd();
}

function context(platform, options = {}) {
  const expansion = expandPlatform(platform);
  assert.equal(expansion.valid, true);
  const gatusGroup = expansion.platform.packs?.observability?.gatus !== undefined ? "observability" : "utility-system";
  const input = {
    artifacts: {
      ...expansion.artifacts,
      platform: expansion.platform,
    },
    pathAllocator: createPathAllocator({
      gitopsRoot: expansion.platform.gitops.root,
      environment: expansion.platform.gitops.environment,
      gatusGroup,
    }),
    overrides: options.overrides ?? {},
  };
  if (Object.hasOwn(options, "blueprintRegistry")) {
    input.blueprintRegistry = options.blueprintRegistry;
  } else {
    input.blueprintRegistry = fixtureBlueprintRegistry;
  }
  if (options.diagnostics) input.diagnostics = options.diagnostics;
  return input;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function realBlueprintRegistry() {
  const entries = {};
  for (const definition of Object.values(FLUX_PACKS)) {
    const absolutePath = `/workspace/platform-blueprints/${definition.sourcePath}`;
    entries[definition.sourcePath] = {};
    for (const file of walk(absolutePath)) {
      if (file.endsWith(".md")) continue;
      entries[definition.sourcePath][file] = readFileSync(`${absolutePath}/${file}`, "utf8").trimEnd();
    }
  }
  return entries;
}

function walk(root, prefix = "") {
  return readdirSync(posix.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = posix.join(prefix, entry.name);
    if (entry.isDirectory()) return walk(root, relativePath);
    if (!entry.isFile()) return [];
    return [relativePath];
  }).sort();
}

function platformForNamedPack(packName) {
  const base = structuredClone(packName.includes("traefik-lan") || packName.includes("metallb") || packName.includes("observability")
    ? personalStack
    : website);
  base.packs = {
    "flux-core-cert-manager": { core: ["cert-manager"] },
    "flux-core-external-dns-cloudflare": { core: ["external-dns"] },
    "flux-core-traefik-public": { core: ["traefik-public"] },
    "flux-core-traefik-lan": { core: ["traefik-lan"] },
    "flux-core-metallb": { core: ["metallb"] },
    "flux-core-vso": { core: ["vso"] },
    "edge-pack": { edge: {} },
    "edge-middleware-pack": { edgeMiddleware: true },
    "observability-gatus-pack": { utility: { gatus: {} } },
    "observability-stack-pack": { observability: { gatus: true } },
    "rabbitmq-data-service-pack": { data: ["rabbitmq"] },
  }[packName];
  return base;
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

test("flux-packs does not read implicit machine-local blueprints", () => {
  const diagnostics = [];
  const files = renderFluxPacks(context(personalStack, { blueprintRegistry: undefined, diagnostics }));

  assert.equal(files.some((file) => file.path.includes("ingress-controller")), false);
  assert.equal(diagnostics.length > 0, true);
  assert.equal(diagnostics[0].code, "E_BLUEPRINT_REGISTRY_MISSING");
});

for (const packName of Object.keys(FLUX_PACKS)) {
  test(`flux-packs renders ${packName} deterministically from registry fixture`, () => {
    const input = context(platformForNamedPack(packName), { blueprintRegistry: realBlueprintRegistry() });
    const files = renderFluxPacks(input);
    const expected = readJson(`../fixtures/flux-packs/${packName}.json`);

    assert.deepEqual(files, expected);
    assert.deepEqual(renderFluxPacks(input), files);
    assert.doesNotMatch(files.map((file) => file.content).join("\n"), /\$\{[A-Z0-9_]+\}/);
  });
}

test("flux-packs reports missing placeholder inputs with pack context", () => {
  assert.throws(
    () => renderFluxPacks(context(platformForNamedPack("flux-core-cert-manager"), {
      blueprintRegistry: realBlueprintRegistry(),
      overrides: { "flux-packs": { substitutions: { CERT_MANAGER_NAMESPACE: undefined } } },
    })),
    /flux pack flux-core-cert-manager is missing placeholder input\(s\): CERT_MANAGER_NAMESPACE/,
  );
});

test("flux-packs reports undeclared placeholders with source context", () => {
  const registry = {
    ...realBlueprintRegistry(),
    "packs/flux-core/cert-manager": {
      ...realBlueprintRegistry()["packs/flux-core/cert-manager"],
      "namespace.yaml": "kind: Namespace\nmetadata:\n  name: \"${NOT_DECLARED}\"",
    },
  };

  assert.throws(
    () => renderFluxPacks(context(platformForNamedPack("flux-core-cert-manager"), { blueprintRegistry: registry })),
    /flux pack flux-core-cert-manager source packs\/flux-core\/cert-manager\/namespace.yaml uses undeclared placeholder NOT_DECLARED/,
  );
});
