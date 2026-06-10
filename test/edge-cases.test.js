import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";
import { renderGatus } from "../src/adapters/gatus.js";
import { renderKubernetes } from "../src/adapters/kubernetes.js";
import { renderNixHosts } from "../src/adapters/nix-hosts.js";
import { renderVso } from "../src/adapters/vso.js";
import { validatePlatform } from "../src/minimal/schema.js";
import { normalizeServiceIntentForRender } from "../src/service-intent-normalizer.js";

function file(files, suffix) {
  return files.find((item) => item.path.endsWith(suffix));
}

function service(overrides = {}) {
  return {
    workload: { kind: "deployment", restart_policy: "Always" },
    image: { repository: "ghcr.io/example/app", tag: "1.0.0" },
    ports: [{ name: "http", container_port: 8080, service_port: 80, exposure: "internal" }],
    ...overrides,
  };
}

test("service-intent normalizer covers renderer defaults and route exposure variants", () => {
  const config = normalizeServiceIntentForRender({
    version: "1.0",
    services: {
      hosttool: service({ workload: { kind: "host_native" } }),
      nomad: service({ workload: { kind: "nomad_job" } }),
      web: service({
        image: { repository: "ghcr.io/example/web", tag: "latest" },
        ports: [{ name: "http", container_port: 8080, service_port: 80, exposure: "public" }],
        networking: {
          routes: [
            { name: "web", host: "root", port: "http", paths: ["/"], bypass_paths: ["/healthz"], access: "sso" },
            { name: "web-lan", host: "web.example.invalid", port: "http", origin: "home-lan" },
          ],
        },
        gatus: {
          endpoints: [
            { name: "tcp", type: "tcp", port: "http", group: "edge" },
            { name: "http", type: "http", port: "http", path: "/healthz", expected_status: 204, strategy: "both" },
          ],
        },
      }),
      lan: service({ ports: [{ name: "http", container_port: 8080, service_port: 80, exposure: "lan" }] }),
      monitor: service({
        gatus: { endpoints: [{ name: "health", type: "http", port: "http", path: "/ready" }] },
      }),
    },
  });

  assert.deepEqual(config.service_intent.host_native["host-native"], ["hosttool"]);
  assert.deepEqual(config.service_intent.kubernetes.service_intent, ["lan", "monitor", "web"]);
  assert.deepEqual(config.exposure_intent.public_and_lan, ["web"]);
  assert.ok(config.exposure_intent.lan_only.includes("lan"));
  assert.ok(config.exposure_intent.internal_only.includes("monitor"));
  assert.equal(config.access_intent.host_labels.web, "root");
  assert.equal(config.access_intent.sso_protected[0], "web");
  assert.deepEqual(config.ingress_intent.route_rules.find((route) => route.name === "web").excluded_exact_paths, ["/healthz"]);
  assert.equal(config.ingress_intent.kubernetes_backends.web.health.expected_status, 204);
  assert.equal(config.ingress_intent.kubernetes_backends.web.extra_probes[0].type, "tcp");
  assert.equal(config.monitoring_intent.kubernetes_backends.monitor.health.path, "/ready");
  assert.deepEqual(config.adapter_output_intent.adapters, [
    "traefik-public",
    "traefik-lan",
    "gatus",
    "edge-catalog",
    "edge-route-catalog",
    "image-metadata",
  ]);
});

test("gatus renders protected, hostless, tcp, explicit, and default probe strategies", () => {
  const config = {
    cluster: { public_domain: "example.net" },
    service_intent: { kubernetes: { apps: ["web", "tcp", "protected", "hostless"] }, host_native: {} },
    exposure_intent: { public: ["web", "hostless"], public_and_lan: [], lan_only: [], internal_only: ["tcp", "protected"] },
    access_intent: {
      sso_protected: ["protected"],
      host_labels: { web: "web", protected: "protected" },
      root_redirect: {},
    },
    ingress_intent: {
      kubernetes_backends: {
        web: { namespace: "default", service: "web", port: 80, health: { path: "/ready", probe_strategy: "both" } },
        tcp: { namespace: "default", service: "tcp", port: 5432, health: { type: "tcp" } },
        protected: { namespace: "default", service: "protected", port: 80, health: { path: "/health" } },
        hostless: { namespace: "default", service: "hostless", port: 80, health: { path: "/health" } },
      },
      route_rules: [],
      defaults: {},
    },
    monitoring_intent: {
      kubernetes_backends: {
        metrics: {
          namespace: "observability",
          service: "metrics",
          port: 9090,
          health: { path: "/-/ready", response_time_ms: 500 },
          extra_probes: [{ name: "grpc", port: 9091 }],
        },
      },
    },
    adapter_output_intent: { adapters: ["gatus"], output_paths: {}, namespaces: {}, configmap_names: { gatus: "custom-gatus" } },
  };
  const rendered = renderGatus(config);
  const endpoints = YAML.parse(rendered).data["endpoints.yaml"];

  assert.match(rendered, /name: custom-gatus/);
  assert.match(endpoints, /name: "web \(internal\)"/);
  assert.match(endpoints, /name: "web \(external\)"/);
  assert.match(endpoints, /url: "tcp:\/\/tcp\.default\.svc\.cluster\.local:5432"/);
  assert.match(endpoints, /name: "protected"/);
  assert.doesNotMatch(endpoints, /hostless \(external\)/);
  assert.match(endpoints, /name: "metrics-grpc"/);
  assert.match(endpoints, /\[RESPONSE_TIME\] < 500/);
});

test("kubernetes adapter handles workload variants, namespace defaults, and skipped services", () => {
  const services = {
    stateful: service({ workload: { kind: "statefulset", replicas: 2 }, kubernetes: { namespace_ref: "data-system" } }),
    batch: service({ workload: { kind: "job", restart_policy: "Never" } }),
    cron: service({ workload: { kind: "cronjob", schedule: "*/5 * * * *" } }),
    external: service({ workload: { kind: "external_service" }, image: { repository: "ghcr.io/example/external", tag: "1.0.0" } }),
    skipped: service({ kubernetes: { render_status: "implemented_elsewhere" } }),
    podmon: service({ observability: { metrics: [{ kind: "PodMonitor", port: "http", path: "/metrics" }] } }),
  };
  const files = renderKubernetes({
    artifacts: {
      "service-intent": { services },
      "deploy-config": { service_intent: { kubernetes: { batch_jobs: ["batch", "cron"], data: ["stateful"] } } },
      "vault-dynamic-secrets": { vault: { vso: { dynamic_syncs: { db: { target: { name: "db-creds" } } } } } },
    },
  });

  assert.ok(file(files, "stateful/statefulset.yaml"));
  assert.ok(file(files, "batch/job.yaml"));
  assert.ok(file(files, "cron/cronjob.yaml"));
  assert.ok(file(files, "external/kustomization.yaml"));
  assert.ok(file(files, "podmon/podmonitor.yaml"));
  assert.equal(files.some((item) => item.path.includes("skipped")), false);
  assert.match(file(files, "stateful/statefulset.yaml").content, /serviceName: stateful/);
  assert.match(file(files, "batch/job.yaml").content, /restartPolicy: Never/);
  assert.match(file(files, "cron/cronjob.yaml").content, /schedule: '\*\/5 \* \* \* \*'/);
});

test("nix-hosts adapter handles empty input, arch variants, ssh forms, and role aliases", () => {
  assert.deepEqual(renderNixHosts({ artifacts: {} }), []);

  const files = renderNixHosts({
    artifacts: {
      "fleet-inventory": {
        fleet: {
          cluster: { name: "lab", domain: "example.net" },
          nodes: {
            pi: { site: "home", arch: "arm64", roles: ["worker", "raspberry-pi-image"], addresses: { ssh: "root@pi.local:2222" } },
            sensor: { site: "home", arch: "armv7", roles: ["utility", "tailscale-network"], addresses: { management: "sensor.local" } },
            cp: { site: "edge", arch: "amd64", roles: ["control-plane", "gpu-nvidia"], capabilities: ["cuda"] },
          },
        },
      },
    },
  });
  const flake = file(files, "platform/flake.nix").content;
  const pi = file(files, "platform/nix/hosts/pi/default.nix").content;
  const sensor = file(files, "platform/nix/hosts/sensor/default.nix").content;
  const cpLabels = file(files, "platform/nix/generated/cp-labels.nix").content;

  assert.match(flake, /system = "aarch64-linux"/);
  assert.match(flake, /sshOpts = \[ "-p" "2222" \]/);
  assert.match(flake, /hostname = "sensor.local"/);
  assert.match(pi, /roleRaspberryPiImage/);
  assert.match(pi, /apiServerEndpoint = lib\.mkDefault "https:\/\/lab\.example\.net:6443"/);
  assert.match(sensor, /roleNetworkTailscale/);
  assert.match(sensor, /nixpkgs.hostPlatform = lib.mkDefault "armv7l-linux"/);
  assert.match(cpLabels, /node-role\.kubernetes\.io\/control-plane=true:NoSchedule/);
  assert.ok(file(files, "platform/nix/generated/sensor-deploy-metadata.nix"));
});

test("vso adapter covers overrides, empty input, path normalization, and optional rollout targets", () => {
  assert.deepEqual(renderVso({ artifacts: {} }), []);

  const files = renderVso({
    artifacts: {
      "vault-dynamic-secrets": {
        vault: {
          auth: { kubernetes: { mount: "custom-kubernetes" } },
          kv: {
            mount: "secret",
            paths: {
              app: { path: "secret/data/platform/app" },
              bare: { path: "platform/bare" },
            },
          },
          vso: {
            auth_role: "renderer",
            static_syncs: {
              app: {
                kv_path_ref: "app",
                target: { namespace: "apps", name: "app-secret" },
                rollout_restart_targets: [{ kind: "Deployment", namespace: "apps", name: "app" }],
              },
              bare: { kv_path_ref: "bare", target: { namespace: "ops", name: "bare-secret" } },
            },
            dynamic_syncs: {
              database: { engine: "database/app", role: "readonly", target: { namespace: "apps", name: "db-secret" } },
            },
          },
        },
      },
    },
    overrides: {
      vso: {
        namespace: "vault-operator",
        vaultConnectionName: "in-cluster",
        vaultAddress: "https://vault.example.net",
        operatorServiceAccount: "vso-controller",
      },
    },
  });
  const appSecret = file(files, "app.yaml").content;
  const bareSecret = file(files, "bare.yaml").content;
  const dynamicSecret = file(files, "database.yaml").content;

  assert.match(file(files, "vault-connection.yaml").content, /address: https:\/\/vault\.example\.net/);
  assert.match(file(files, "vault-auth.yaml").content, /vaultConnectionRef: in-cluster/);
  assert.match(file(files, "apps-serviceaccount.yaml").content, /name: vso-controller/);
  assert.match(appSecret, /path: platform\/app/);
  assert.doesNotMatch(appSecret, /namespace: apps\n\s+name: app/);
  assert.match(bareSecret, /path: platform\/bare/);
  assert.doesNotMatch(bareSecret, /rolloutRestartTargets/);
  assert.match(dynamicSecret, /path: creds\/readonly/);
});

test("platform validator reports schema and semantic edge diagnostics", () => {
  const schemaResult = validatePlatform({ version: "1.0", unknown: true });
  const semanticResult = validatePlatform({
    version: 1,
    name: "edge",
    domain: "example.net",
    sites: { home: {} },
    hosts: {
      node: { site: "missing", roles: ["base"] },
    },
    services: {
      app: {
        image: "ghcr.io/example/app:1",
        port: 8080,
        schedule: { node: "missing-node", site: "missing-site" },
      },
    },
    packs: {
      utility: {},
      external: "custom",
      group: false,
    },
  });

  assert.equal(schemaResult.diagnostics[0].code, "E_SCHEMA");
  assert.ok(semanticResult.diagnostics.map((diagnostic) => diagnostic.code).includes("E_PLATFORM_HOST_SITE_UNKNOWN"));
  assert.ok(semanticResult.diagnostics.map((diagnostic) => diagnostic.code).includes("E_PLATFORM_SERVICE_NODE_UNKNOWN"));
  assert.ok(semanticResult.diagnostics.map((diagnostic) => diagnostic.code).includes("E_PLATFORM_SERVICE_SITE_UNKNOWN"));
  assert.ok(semanticResult.diagnostics.map((diagnostic) => diagnostic.code).includes("E_PLATFORM_PACK_UNKNOWN"));
});
