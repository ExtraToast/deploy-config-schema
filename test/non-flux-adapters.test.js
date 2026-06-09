import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

  assert.deepEqual(files, renderNixHosts(context));
  assert.match(flake, /platform-blueprints.url = "github:ExtraToast\/platform-blueprints"/);
  assert.match(flake, /frankfurt-contabo-1 = \{/);
  assert.match(controlPlane, /inputs.platform-blueprints.nixosModules.roleControlPlane/);
  assert.ok(controlPlane.includes("builtins.pathExists ./overrides.nix"));
  assert.ok(controlPlane.includes("builtins.pathExists ./disko.nix"));
  assert.match(gpuWorker, /inputs.platform-blueprints.nixosModules.roleGpuAmd/);
  assert.match(gpuWorker, /platformBlueprints.roles.gpuAmd.enable = lib.mkDefault true/);
  assert.match(labels, /"personal-stack\/capability-amd-gpu" = "true";/);
  assert.equal(files.some((item) => item.path.endsWith("/disko.nix") || item.path.endsWith("/overrides.nix")), false);
});
