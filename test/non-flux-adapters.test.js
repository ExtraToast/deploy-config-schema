import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import YAML from "yaml";
import { renderKubernetes } from "../src/adapters/kubernetes.js";
import { renderNixHosts } from "../src/adapters/nix-hosts.js";
import { renderVso } from "../src/adapters/vso.js";
import { expandPlatform } from "../src/minimal/expand.js";
import { createPathAllocator } from "../src/render-plan/paths.js";

const singleNode = readYaml("../fixtures/platform/single-node.platform.yaml");
const multiSite = readYaml("../fixtures/platform/multi-site.platform.yaml");
const vaultFixture = readYaml("../fixtures/round3/vault-dynamic-secrets.sample.yaml");

function readYaml(relativePath) {
  return YAML.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function contextFromPlatform(platform) {
  const expansion = expandPlatform(platform);
  return {
    artifacts: expansion.artifacts,
    renderPlan: { version: 1, targets: [] },
    pathAllocator: createPathAllocator({
      gitopsRoot: expansion.platform.gitops.root,
      environment: expansion.platform.gitops.environment,
    }),
    blueprintRegistry: {},
    overrides: {},
  };
}

function file(files, path) {
  return files.find((item) => item.path === path);
}

function docs(content) {
  return YAML.parseAllDocuments(content).map((document) => document.toJSON());
}

function doc(files, path, kind) {
  return docs(file(files, path).content).find((item) => item.kind === kind);
}

function kubernetesContext(services, extraArtifacts = {}) {
  return {
    artifacts: {
      "service-intent": {
        version: 1,
        renderer: { cluster_name: "personal-stack" },
        services,
      },
      ...extraArtifacts,
    },
    renderPlan: { version: 1, targets: [] },
    pathAllocator: createPathAllocator(),
    blueprintRegistry: {},
    overrides: {},
  };
}

test("kubernetes adapter renders deterministic app-local workload resources", () => {
  const context = contextFromPlatform(singleNode);
  context.artifacts["service-intent"].services.api.observability = {
    metrics: [{ kind: "ServiceMonitor", port: "http", path: "/actuator/prometheus", interval: "30s" }],
  };
  context.artifacts["service-intent"].services.api.rollout = { availability: { pdb_min_available: 1 } };

  const first = renderKubernetes(context);
  const second = renderKubernetes(context);
  const deployment = file(first, "platform/cluster/flux/apps/stateless/api/deployment.yaml").content;
  const pvc = file(first, "platform/cluster/flux/apps/stateless/api/pvc.yaml").content;
  const monitor = file(first, "platform/cluster/flux/apps/stateless/api/servicemonitor.yaml").content;
  const frontend = file(first, "platform/cluster/flux/apps/stateless/frontend/deployment.yaml").content;

  assert.deepEqual(first, second);
  assert.ok(file(first, "platform/cluster/flux/apps/stateless/api/namespace.yaml"));
  assert.ok(file(first, "platform/cluster/flux/apps/stateless/api/serviceaccount.yaml"));
  assert.match(deployment, /kind: Deployment/);
  assert.match(deployment, /kind: Service/);
  assert.match(deployment, /secretKeyRef:/);
  assert.match(deployment, /configMapKeyRef:/);
  assert.match(deployment, /readinessProbe:/);
  assert.doesNotMatch(deployment, /&a[0-9]|\\*a[0-9]/);
  assert.match(pvc, /kind: PersistentVolume/);
  assert.match(pvc, /storageClassName: ''/);
  assert.match(monitor, /kind: ServiceMonitor/);
  assert.match(monitor, /jobLabel: app.kubernetes.io\/name/);
  assert.match(file(first, "platform/cluster/flux/apps/stateless/api/pdb.yaml").content, /minAvailable: 1/);
  assert.match(frontend, /keel.sh\/policy: force/);
  assert.equal(new Set(first.map((item) => item.adapter)).size, 1);
});

test("kubernetes adapter renders deployment statefulset job and cronjob depth", () => {
  const services = {
    web: {
      workload: { kind: "deployment", replicas: 2 },
      image: { repository: "example/web", tag: "1.0.0" },
      ports: [{ name: "http", container_port: 8080, service_port: 80 }],
      runtime: {
        env: { mode: "prod" },
        files: { "app.conf": "listen=:8080" },
        env_from: [{ name: "web-runtime", optional: true }],
        init_containers: [{ name: "prepare", image: { repository: "example/prepare", tag: "1.0.0" }, args: ["init"] }],
        sidecars: [{ name: "metrics", image: { repository: "example/metrics", tag: "latest" }, env: { SCRAPE: "true" } }],
      },
      storage: {
        volumes: [{ name: "cache", kind: "empty_dir" }],
        mounts: [{ volume: "cache", path: "/cache" }],
      },
      gatus: { endpoints: [{ name: "ready", type: "http", port: "http", path: "/ready" }] },
      observability: { metrics: [{ kind: "PodMonitor", port: "http", path: "/metrics" }] },
      rollout: {
        availability: { max_unavailable: 1 },
        autoscaling: { enabled: true, min_replicas: 2, max_replicas: 5, target_cpu_utilization: 70 },
      },
      kubernetes: {
        namespace_ref: "apps",
        pod_spec: { priorityClassName: "platform-apps" },
        raw_manifests: [{
          apiVersion: "v1",
          kind: "ServiceAccount",
          metadata: { name: "web-extra" },
        }],
      },
    },
    queue: {
      workload: { kind: "statefulset", replicas: 1 },
      image: { repository: "example/queue", tag: "2.0.0" },
      ports: [{ name: "amqp", container_port: 5672, service_port: 5672 }],
      storage: {
        volumes: [
          { name: "data", kind: "pvc", size: "8Gi", claim_template: true },
          { name: "plugins", kind: "config_map" },
        ],
        mounts: [
          { volume: "data", path: "/var/lib/queue" },
          { volume: "plugins", path: "/etc/queue" },
        ],
      },
      kubernetes: { namespace_ref: "data", service_ref: "queue-headless" },
    },
    migrate: {
      workload: { kind: "job", restart_policy: "Never" },
      image: { repository: "example/migrate", tag: "3.0.0" },
      runtime: { args: ["up"] },
      kubernetes: { namespace_ref: "jobs" },
    },
    sweep: {
      workload: { kind: "cronjob", schedule: "*/15 * * * *", restart_policy: "OnFailure" },
      image: { repository: "example/sweep", tag: "4.0.0" },
      kubernetes: { namespace_ref: "jobs" },
    },
  };

  const files = renderKubernetes(kubernetesContext(services));
  assert.deepEqual(files, renderKubernetes(kubernetesContext(services)));

  const deployment = doc(files, "platform/cluster/flux/apps/apps/web/deployment.yaml", "Deployment");
  assert.equal(deployment.spec.template.spec.priorityClassName, "platform-apps");
  assert.equal(deployment.spec.template.spec.initContainers[0].image, "example/prepare:1.0.0");
  assert.equal(deployment.spec.template.spec.containers[1].imagePullPolicy, "Always");
  assert.deepEqual(deployment.spec.template.spec.containers[0].envFrom, [{ secretRef: { name: "web-runtime", optional: true } }]);
  assert.match(file(files, "platform/cluster/flux/apps/apps/web/configmap.yaml").content, /app.conf: listen=:8080/);
  assert.match(file(files, "platform/cluster/flux/apps/apps/web/podmonitor.yaml").content, /kind: PodMonitor/);
  assert.match(file(files, "platform/cluster/flux/apps/apps/web/hpa.yaml").content, /kind: HorizontalPodAutoscaler/);
  assert.match(file(files, "platform/cluster/flux/apps/apps/web/pdb.yaml").content, /maxUnavailable: 1/);
  assert.match(file(files, "platform/cluster/flux/apps/apps/web/raw.yaml").content, /namespace: apps/);

  const statefulSet = doc(files, "platform/cluster/flux/apps/data/queue/statefulset.yaml", "StatefulSet");
  assert.equal(statefulSet.spec.serviceName, "queue-headless");
  assert.deepEqual(statefulSet.spec.volumeClaimTemplates[0].metadata, { name: "queue-data" });
  assert.equal(statefulSet.spec.volumeClaimTemplates[0].spec.resources.requests.storage, "8Gi");
  assert.equal(doc(files, "platform/cluster/flux/apps/data/queue/statefulset.yaml", "Service").metadata.name, "queue-headless");

  assert.equal(doc(files, "platform/cluster/flux/apps/jobs/migrate/job.yaml", "Job").spec.template.spec.restartPolicy, "Never");
  assert.equal(doc(files, "platform/cluster/flux/apps/jobs/sweep/cronjob.yaml", "CronJob").spec.schedule, "*/15 * * * *");
});

test("kubernetes adapter parity samples match vendored workload structures", () => {
  const services = {
    postgres: {
      workload: { kind: "deployment", replicas: 1, strategy: "recreate" },
      image: { repository: "pgvector/pgvector", tag: "pg17" },
      ports: [
        { name: "db", container_port: 5432, service_port: 5432 },
        { name: "metrics", container_port: 9187, service_port: 9187 },
      ],
      secrets: [{ name: "postgres-runtime", source: "vso_static", ref: "postgres" }],
      storage: {
        volumes: [
          { name: "postgres-data", kind: "pvc", size: "20Gi" },
          { name: "postgres-config", kind: "config_map" },
        ],
        mounts: [
          { volume: "postgres-data", path: "/var/lib/postgresql/data" },
          { volume: "postgres-config", path: "/etc/postgresql", read_only: true },
        ],
      },
      gatus: { endpoints: [{ name: "db", type: "tcp", port: "db" }] },
      observability: { metrics: [{ kind: "ServiceMonitor", port: "metrics", path: "/metrics", interval: "30s" }] },
      scheduling: { site_affinity: "frankfurt" },
      kubernetes: {
        namespace_ref: "data-system",
        service_account_ref: "postgres",
        pod_spec: { nodeSelector: { "personal-stack/site": "frankfurt" } },
      },
    },
    api: {
      workload: { kind: "deployment", replicas: 1 },
      image: { repository: "ghcr.io/esa-blueshell/api", tag: "latest" },
      ports: [{ name: "http", container_port: 8080, service_port: 80 }],
      storage: {
        volumes: [{ name: "storage", kind: "host_path", path: "/srv/blueshell/storage", size: "20Gi" }],
        mounts: [{ volume: "storage", path: "/srv/storage" }],
      },
      scheduling: { node_affinity: "frankfurt-contabo-1" },
    },
  };
  const files = renderKubernetes(kubernetesContext(services));
  const postgresExpected = docs(readFileSync(new URL("fixtures/kubernetes-parity/postgres-derived.yaml", import.meta.url), "utf8"));
  const apiStorageExpected = docs(readFileSync(new URL("fixtures/kubernetes-parity/website-api-storage-derived.yaml", import.meta.url), "utf8"));

  const postgresDeployment = doc(files, "platform/cluster/flux/apps/data/postgres/deployment.yaml", "Deployment");
  assert.equal(postgresDeployment.spec.strategy.type, postgresExpected[0].spec.strategy.type);
  assert.deepEqual(postgresDeployment.spec.template.spec.nodeSelector, postgresExpected[0].spec.template.spec.nodeSelector);
  assert.deepEqual(doc(files, "platform/cluster/flux/apps/data/postgres/deployment.yaml", "Service").spec.ports, postgresExpected[1].spec.ports);
  assert.deepEqual(doc(files, "platform/cluster/flux/apps/data/postgres/servicemonitor.yaml", "ServiceMonitor").spec.endpoints, postgresExpected[2].spec.endpoints);

  const storageDocs = docs(file(files, "platform/cluster/flux/apps/stateless/api/pvc.yaml").content);
  assert.deepEqual(storageDocs[0].spec.hostPath, apiStorageExpected[0].spec.hostPath);
  assert.deepEqual(storageDocs[0].spec.nodeAffinity, apiStorageExpected[0].spec.nodeAffinity);
  assert.equal(storageDocs[1].spec.storageClassName, "");
  assert.equal(storageDocs[1].spec.volumeName, "api-storage");
});

test("kubernetes adapter rejects invalid references and secret material", () => {
  const base = {
    workload: { kind: "deployment" },
    image: { repository: "example/api", tag: "1.0.0" },
    ports: [{ name: "http", container_port: 8080, service_port: 80 }],
  };

  assert.throws(
    () => renderKubernetes(kubernetesContext({ api: { ...base, networking: { routes: [{ name: "bad", port: "admin" }] } } })),
    /route bad references undeclared port admin/,
  );
  assert.throws(
    () => renderKubernetes(kubernetesContext({ api: { ...base, gatus: { endpoints: [{ name: "bad", type: "tcp", port: "admin" }] } } })),
    /probe bad references undeclared port admin/,
  );
  assert.throws(
    () => renderKubernetes(kubernetesContext({ api: { ...base, storage: { volumes: [{ name: "data", kind: "empty_dir" }], mounts: [{ volume: "missing", path: "/data" }] } } })),
    /mount \/data references undeclared volume missing/,
  );
  assert.throws(
    () => renderKubernetes(kubernetesContext({ api: { ...base, storage: { volumes: [{ name: "data", kind: "host_path", path: "/srv/data" }] } } })),
    /host_path volume data requires node or host affinity/,
  );
  assert.throws(
    () => renderKubernetes(kubernetesContext({ api: { ...base, secrets: [{ name: "api", source: "kubernetes_secret", value: "plaintext" }] } })),
    /contains secret material/,
  );
  assert.throws(
    () => renderKubernetes(kubernetesContext({ api: { ...base, kubernetes: { raw_manifests: [{ apiVersion: "v1", kind: "Secret", metadata: { name: "bad" }, stringData: { token: "plaintext" } }] } } })),
    /contains Secret data/,
  );
});

test("vso adapter renders static and dynamic CRs without secret material", () => {
  const files = renderVso({
    artifacts: { "vault-dynamic-secrets": vaultFixture },
    pathAllocator: createPathAllocator(),
    overrides: {},
  });
  const rendered = files.map((item) => item.content).join("\n---\n");

  assert.deepEqual(files, renderVso({
    artifacts: { "vault-dynamic-secrets": vaultFixture },
    pathAllocator: createPathAllocator(),
    overrides: {},
  }));
  assert.ok(file(files, "platform/cluster/flux/apps/vso-secrets/vault-connection.yaml"));
  assert.ok(file(files, "platform/cluster/flux/apps/vso-secrets/vault-auth.yaml"));
  assert.match(file(files, "platform/cluster/flux/apps/vso-secrets/api-runtime.yaml").content, /kind: VaultStaticSecret/);
  assert.match(file(files, "platform/cluster/flux/apps/vso-secrets/worker-database.yaml").content, /kind: VaultDynamicSecret/);
  assert.match(file(files, "platform/cluster/flux/apps/vso-secrets/app-system-serviceaccount.yaml").content, /name: vault-secrets-operator/);
  assert.doesNotMatch(rendered, /CREATE ROLE|admin_password|database\\.service\\.internal|password:|token:/);
});

test("nix-hosts adapter renders flake and guarded host scaffolds from fleet roles", () => {
  const context = contextFromPlatform(multiSite);
  const files = renderNixHosts(context);
  const flake = file(files, "platform/flake.nix").content;
  const controlPlane = file(files, "platform/nix/hosts/frankfurt-contabo-1/default.nix").content;
  const gpuWorker = file(files, "platform/nix/hosts/enschede-rx7900xtx-1/default.nix").content;
  const labels = file(files, "platform/nix/generated/enschede-rx7900xtx-1-labels.nix").content;
  const metadata = file(files, "platform/nix/generated/frankfurt-contabo-1-deploy-metadata.nix").content;
  const readme = file(files, "platform/nix/hosts/frankfurt-contabo-1/README.md").content;

  assert.deepEqual(files, renderNixHosts(context));
  assert.match(flake, /platform-blueprints.url = "github:ExtraToast\/platform-blueprints"/);
  assert.match(flake, /frankfurt-contabo-1 = \{/);
  assert.match(controlPlane, /inputs.platform-blueprints.nixosModules.roleControlPlane/);
  assert.ok(controlPlane.includes("builtins.pathExists ./network.nix"));
  assert.ok(controlPlane.includes("builtins.pathExists ./disko.nix"));
  assert.ok(controlPlane.includes("builtins.pathExists ./secrets.nix"));
  assert.ok(controlPlane.includes("builtins.pathExists ./overrides.nix"));
  assert.match(gpuWorker, /inputs.platform-blueprints.nixosModules.roleGpuAmd/);
  assert.match(gpuWorker, /platformBlueprints.roles.gpuAmd.enable = lib.mkDefault true/);
  assert.match(labels, /"personal-stack\/capability-amd-gpu" = "true";/);
  assert.match(metadata, /roles = \[ "base" "k3s-control-plane" "k3s-worker" \];/);
  assert.match(metadata, /sshPort = 2222;/);
  assert.match(readme, /network\.nix/);
  assert.equal(files.some((item) => item.path.endsWith("/network.nix") || item.path.endsWith("/disko.nix") || item.path.endsWith("/secrets.nix") || item.path.endsWith("/overrides.nix")), false);
});

test("nix-hosts adapter maps roles through injected blueprint registry", () => {
  const context = contextFromPlatform(singleNode);
  context.blueprintRegistry = {
    nixosHostRoles: {
      roleModuleNames: {
        base: "customBase",
        "k3s-control-plane": "customServer",
        "k3s-worker": "customAgent",
      },
    },
  };

  const files = renderNixHosts(context);
  const host = file(files, "platform/nix/hosts/frankfurt-contabo-1/default.nix").content;

  assert.match(host, /inputs.platform-blueprints.nixosModules.customBase/);
  assert.match(host, /inputs.platform-blueprints.nixosModules.customServer/);
  assert.match(host, /inputs.platform-blueprints.nixosModules.customAgent/);
  assert.doesNotMatch(host, /roleControlPlane/);
});

test("nix-hosts generated Nix files parse when nix-instantiate is available", (t) => {
  const probe = spawnSync("nix-instantiate", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    t.skip("nix-instantiate is not available; structural nix-hosts assertions cover offline CI");
    return;
  }

  const root = mkdtempSync(join(tmpdir(), "deploy-config-schema-nix-"));
  const files = renderNixHosts(contextFromPlatform(multiSite)).filter((item) => item.path.endsWith(".nix"));
  for (const generated of files) {
    const path = join(root, generated.path.replaceAll("/", "__"));
    writeFileSync(path, generated.content);
    const parsed = spawnSync("nix-instantiate", ["--parse", path], { encoding: "utf8" });
    assert.equal(parsed.status, 0, `${generated.path}: ${parsed.stderr}`);
  }
});
