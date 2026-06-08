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

function assertCodes(config, expectedCodes) {
  const codes = new Set(codesFor(config));
  for (const code of expectedCodes) {
    assert.ok(codes.has(code), `${code} was not reported; saw ${[...codes].join(", ")}`);
  }
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

test("reports semantic consistency diagnostics across config sections", () => {
  const config = clone(sample);
  config.cluster.kubernetes.bootstrap_control_plane = "enschede-t1000-1";
  delete config.nodes["frankfurt-contabo-1"].ssh;
  config.service_intent.kubernetes.internal_platform.push("app-ui");
  config.service_intent.host_native["missing-node"] = ["host-tool"];
  config.placement_intent.site_affinity["missing-site-service"] = "missing-site";
  config.placement_intent.node_affinity["missing-node-service"] = "missing-node";
  config.placement_intent.gpu_preferences["missing-gpu-service"] = {
    preferred_gpu_model: "missing-gpu",
    temporary_gpu_model: "also-missing-gpu",
  };
  config.exposure_intent.lan_only.push("unknown-lan");
  config.access_intent.sso_protected.push("postgres");
  config.access_intent.host_labels["unknown-host-label"] = "unknown-host";
  config.access_intent.root_redirect.vault = "vault-root-redirect";
  config.access_intent.root_redirect["unknown-root"] = "unknown-root-redirect";
  config.ingress_intent.kubernetes_backends.tailscale = {
    namespace: "edge-system",
    service: "tailscale",
    port: 41641,
  };
  config.ingress_intent.route_rules.push(
    { name: "missing-route", service: "missing-route-service" },
    { name: "app-ui", service: "app-ui" },
  );
  config.ingress_intent.wan_origin_overrides.postgres = "edge_direct";
  delete config.sites.frankfurt.networking.wan_public_ip;
  delete config.sites.enschede.networking.lan_ingress_ip;
  delete config.sites.enschede.networking.wan_public_ip;
  for (const node of Object.values(config.nodes)) {
    node.capabilities = node.capabilities.filter((capability) => capability !== "lan-ingress");
  }
  config.monitoring_intent.kubernetes_backends["assistant-api"] = {
    namespace: "assistant-system",
    service: "assistant-api",
    port: 8080,
    health: {
      type: "http",
      probe_strategy: "internal",
    },
  };
  config.monitoring_intent.kubernetes_backends.tailscale = {
    namespace: "net-system",
    service: "tailscale",
    port: 41641,
    health: {
      type: "tcp",
      path: "/tcp",
      expected_status: 200,
      probe_strategy: "external",
    },
  };
  config.image_metadata.workloads["unknown-image"] = {
    repository: "ghcr.io/extratoast/unknown-image",
    tag: "latest",
    pull_policy: "Always",
    source: "first_party",
    update: {
      eligible: true,
      strategy: "latest_tag",
    },
  };
  config.image_metadata.workloads.jellyfin.update.keel = {
    policy: "force",
    match_tag: true,
    trigger: "poll",
    poll_schedule: "@every 2m",
  };

  assertCodes(config, [
    "E_CLUSTER_BOOTSTRAP_ROLE_MISSING",
    "E_NODE_ACTIVE_SSH_MISSING",
    "E_SERVICE_DUPLICATE_CLASSIFICATION",
    "E_HOST_NATIVE_NODE_UNKNOWN",
    "E_PLACEMENT_SERVICE_UNKNOWN",
    "E_PLACEMENT_SITE_UNKNOWN",
    "E_PLACEMENT_NODE_UNKNOWN",
    "E_PLACEMENT_GPU_UNKNOWN",
    "E_EXPOSURE_SERVICE_UNKNOWN",
    "E_ACCESS_NOT_EXTERNAL",
    "E_HOST_LABEL_SERVICE_UNKNOWN",
    "E_EXTERNAL_HOST_LABEL_MISSING",
    "E_ROOT_REDIRECT_SERVICE_UNKNOWN",
    "E_ROOT_REDIRECT_HOST_LABEL_MISSING",
    "E_INGRESS_BACKEND_SERVICE_UNKNOWN",
    "E_INGRESS_BACKEND_NOT_EXTERNAL",
    "E_ROUTE_SERVICE_UNKNOWN",
    "E_ROUTE_HOST_LABEL_MISSING",
    "E_ROUTE_DUPLICATE_NAME",
    "E_WAN_OVERRIDE_SERVICE_INVALID",
    "E_WAN_HOME_SITE_MISSING",
    "E_WAN_EDGE_SITE_MISSING",
    "E_LAN_INGRESS_SITE_MISSING",
    "E_LAN_INGRESS_NODE_MISSING",
    "E_MONITORING_BACKEND_SERVICE_UNKNOWN",
    "E_MONITORING_BACKEND_DUPLICATES_INGRESS",
    "E_MONITORING_PROBE_STRATEGY_INVALID",
    "E_TCP_PROBE_PATH_INVALID",
    "E_TCP_PROBE_STATUS_INVALID",
    "E_IMAGE_SERVICE_UNKNOWN",
    "E_IMAGE_KEEL_REQUIRED",
    "E_IMAGE_PINNED_KEEL_METADATA",
  ]);
});
