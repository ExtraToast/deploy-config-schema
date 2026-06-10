import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { adapterContract, adapterNames } from "../src/adapters/registry.js";
import { runCli } from "../src/cli.js";
import { validateArtifact } from "../src/artifact-validator.js";
import { expandPlatform } from "../src/minimal/expand.js";
import { validatePlatform } from "../src/minimal/schema.js";
import { createPathAllocator } from "../src/render-plan/paths.js";
import { createRenderPlan, renderPlanFiles } from "../src/render-plan/plan.js";
import { generatedHeader, renderManagedContent, writeGeneratedFiles } from "../src/render-plan/writer.js";

const singleNode = readYaml("../fixtures/platform/single-node.platform.yaml");
const multiSite = readYaml("../fixtures/platform/multi-site.platform.yaml");
const fullTree = readYaml("../fixtures/platform/full-tree.platform.yaml");

function readYaml(relativePath) {
  return YAML.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function stream() {
  return {
    chunks: [],
    write(chunk) {
      this.chunks.push(String(chunk));
      return true;
    },
    text() {
      return this.chunks.join("");
    },
  };
}

test("minimal platform fixtures validate and expand into canonical artifacts", () => {
  for (const platform of [singleNode, multiSite]) {
    const platformValidation = validatePlatform(platform);
    const expansion = expandPlatform(platform);

    assert.deepEqual(platformValidation.diagnostics, []);
    assert.equal(expansion.valid, true);
    assert.deepEqual(validateArtifact("service-intent", expansion.artifacts["service-intent"]).diagnostics, []);
    assert.deepEqual(validateArtifact("fleet-inventory", expansion.artifacts["fleet-inventory"]).diagnostics, []);
    assert.deepEqual(validateArtifact("vault-dynamic-secrets", expansion.artifacts["vault-dynamic-secrets"]).diagnostics, []);
    assert.deepEqual(validateArtifact("deploy-config", expansion.artifacts["deploy-config"]).diagnostics, []);
  }
});

test("minimal platform validation reports unknown packs and roles", () => {
  const platform = structuredClone(singleNode);
  platform.packs.core.push("mystery-pack");
  platform.hosts["frankfurt-contabo-1"].roles.push("mystery-role");

  const codes = validatePlatform(platform).diagnostics.map((diagnostic) => diagnostic.code);

  assert.ok(codes.includes("E_PLATFORM_PACK_UNKNOWN"));
  assert.ok(codes.includes("E_PLATFORM_HOST_ROLE_UNKNOWN"));
});

test("render plan lists deterministic paths before writes", () => {
  const singlePlan = createRenderPlan(expandPlatform(singleNode));
  const multiPlan = createRenderPlan(expandPlatform(multiSite));
  const paths = singlePlan.targets.map((target) => target.path);

  assert.deepEqual(paths, [...paths].sort());
  assert.ok(paths.includes("platform/cluster/flux/apps/edge/traefik-ingressroutes.yaml"));
  assert.equal(singlePlan.targets.some((target) => target.adapter === "traefik-lan"), false);
  assert.equal(multiPlan.targets.some((target) => target.adapter === "traefik-lan"), true);
  assert.deepEqual(createRenderPlan(expandPlatform(singleNode)), singlePlan);
});

test("path allocator rejects unsafe relative paths", () => {
  const allocator = createPathAllocator({ gitopsRoot: "platform/cluster/flux", environment: "production" });

  assert.equal(allocator.clusterRoot, "platform/cluster/flux/clusters/production");
  assert.throws(() => createPathAllocator({ gitopsRoot: "../outside" }), /unsafe output path/);
});

test("generated-file writer adds ownership header and blocks unmanaged overwrites", () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-config-schema-platform-"));
  const file = {
    path: "platform/cluster/flux/apps/edge/example.yaml",
    adapter: "example",
    content: "kind: ConfigMap\n",
  };

  const first = writeGeneratedFiles([file], { root });
  const second = writeGeneratedFiles([file], { root });
  const renderedPath = join(root, file.path);

  assert.equal(first.ok, true);
  assert.equal(second.results[0].action, "unchanged");
  assert.ok(readFileSync(renderedPath, "utf8").startsWith(generatedHeader));

  writeFileSync(renderedPath, "manual: true\n");
  const blocked = writeGeneratedFiles([file], { root });
  const forced = writeGeneratedFiles([file], { root, force: true });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.diagnostics[0].code, "E_RENDER_OVERWRITE_REFUSED");
  assert.equal(forced.ok, true);
  assert.ok(renderManagedContent("value\n").endsWith("value\n"));
});

test("generated-file writer supports dry-run and diff drift checks", () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-config-schema-platform-"));
  const file = {
    path: "generated.yaml",
    adapter: "example",
    content: "kind: ConfigMap\n",
  };

  const dryRun = writeGeneratedFiles([file], { root, dryRun: true });
  const existsAfterDryRun = existsSync(join(root, file.path));
  const diffMissing = writeGeneratedFiles([file], { root, diff: true });
  writeGeneratedFiles([file], { root });
  const diffClean = writeGeneratedFiles([file], { root, diff: true });

  assert.equal(dryRun.results[0].action, "create");
  assert.equal(existsAfterDryRun, false);
  assert.equal(diffMissing.ok, false);
  assert.equal(diffMissing.diagnostics[0].code, "E_RENDER_DIFF");
  assert.equal(diffClean.ok, true);
});

test("adapter registry exposes implemented adapters and planned extension contracts", () => {
  const contract = adapterContract();

  assert.ok(adapterNames().includes("traefik-public"));
  assert.ok(contract.implemented.some((adapter) => adapter.name === "gatus"));
  assert.ok(contract.implemented.some((adapter) => adapter.name === "kubernetes"));
  assert.ok(contract.implemented.some((adapter) => adapter.name === "nix-hosts"));
  assert.ok(contract.implemented.some((adapter) => adapter.name === "vso"));
  assert.equal(contract.planned.some((adapter) => adapter.name === "kubernetes"), false);
  assert.deepEqual(contract.context.artifacts, ["service-intent", "fleet-inventory", "vault-dynamic-secrets", "deploy-config"]);
});

test("CLI platform commands validate, expand, plan, and render tree", async () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-config-schema-platform-"));
  const initPath = join(root, "platform.yaml");
  const renderRoot = join(root, "rendered");
  const initStdout = stream();
  const validateStdout = stream();
  const expandStdout = stream();
  const planStdout = stream();
  const renderStdout = stream();
  const stderr = stream();

  assert.equal(await runCli(["init", "platform", "--template", "single-node", "--output", initPath], { stdout: initStdout, stderr }), 0);
  assert.equal(await runCli(["validate", "platform", initPath], { stdout: validateStdout, stderr }), 0);
  assert.equal(await runCli(["expand", initPath, "--output", join(root, ".render")], { stdout: expandStdout, stderr }), 0);
  assert.equal(await runCli(["render-plan", initPath, "--target", "edge"], { stdout: planStdout, stderr }), 0);
  assert.equal(await runCli(["render-tree", initPath, "--output", renderRoot], { stdout: renderStdout, stderr }), 0);

  assert.equal(JSON.parse(validateStdout.text()).valid, true);
  assert.equal(JSON.parse(validateStdout.text()).results[0].kind, "platform");
  assert.match(planStdout.text(), /traefik-public/);
  assert.ok(existsSync(join(root, ".render", "service-intent.generated.yaml")));
  assert.ok(readFileSync(join(renderRoot, "platform/cluster/flux/apps/edge/traefik-ingressroutes.yaml"), "utf8").startsWith(generatedHeader));
});

test("CLI render-tree --target all renders full deterministic consumer tree", async () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-config-schema-platform-"));
  const fixturePath = "fixtures/platform/full-tree.platform.yaml";
  const planStdout = stream();
  const renderStdout = stream();
  const checkStdout = stream();
  const driftStdout = stream();
  const stderr = stream();

  assert.deepEqual(validatePlatform(fullTree).diagnostics, []);
  assert.equal(await runCli(["render-plan", fixturePath, "--target", "all", "--output", root], { stdout: planStdout, stderr }), 0);
  assert.equal(await runCli(["render-tree", fixturePath, "--output", root, "--target", "all"], { stdout: renderStdout, stderr }), 0);

  const plan = YAML.parse(planStdout.text());
  const response = JSON.parse(renderStdout.text());
  const paths = response.plan.targets.map((target) => target.path);
  const renderedSnapshot = snapshotTree(root);

  assert.deepEqual(paths, [...paths].sort());
  assert.deepEqual(response.plan.targets.map((target) => target.path), plan.targets.map((target) => target.path));
  assert.ok(paths.includes("platform/flake.nix"));
  assert.ok(paths.includes("platform/nix/hosts/alpha-control-1/default.nix"));
  assert.ok(paths.includes("platform/nix/hosts/beta-worker-1/README.md"));
  assert.ok(paths.includes("platform/cluster/flux/apps/core/controller/deployment.yaml"));
  assert.ok(paths.includes("platform/cluster/flux/apps/data/postgres/deployment.yaml"));
  assert.ok(paths.includes("platform/cluster/flux/apps/edge/traefik-ingressroutes.yaml"));
  assert.ok(paths.includes("platform/cluster/flux/apps/stateless/frontend/deployment.yaml"));
  assert.equal(response.results.length, response.plan.targets.length);
  assert.equal(await runCli(["render-tree", fixturePath, "--output", root, "--target", "all", "--check"], { stdout: checkStdout, stderr }), 0);
  assert.deepEqual(snapshotTree(root), renderedSnapshot);
  assert.equal(JSON.parse(checkStdout.text()).ok, true);

  writeFileSync(join(root, "platform/nix/generated/beta-worker-1-labels.nix"), `${generatedHeader}\nchanged = true;\n`);
  assert.equal(await runCli(["render-tree", fixturePath, "--output", root, "--target", "all", "--check"], { stdout: driftStdout, stderr }), 1);
  assert.equal(JSON.parse(driftStdout.text()).diagnostics[0].code, "E_RENDER_DIFF");
});

test("CLI render-tree preserves consumer-owned nix override modules", async () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-config-schema-platform-"));
  const hostRoot = join(root, "platform/nix/hosts/alpha-control-1");
  const stdout = stream();
  const stderr = stream();
  mkdirSync(hostRoot, { recursive: true });
  writeFileSync(join(hostRoot, "network.nix"), "{ networking.useDHCP = false; }\n");
  writeFileSync(join(hostRoot, "disko.nix"), "{ disk.main.device = \"/dev/sda\"; }\n");
  writeFileSync(join(hostRoot, "secrets.nix"), "{ age.secrets = {}; }\n");

  assert.equal(await runCli(["render-tree", "fixtures/platform/full-tree.platform.yaml", "--output", root, "--target", "nix-hosts"], { stdout, stderr }), 0);

  assert.equal(readFileSync(join(hostRoot, "network.nix"), "utf8"), "{ networking.useDHCP = false; }\n");
  assert.equal(readFileSync(join(hostRoot, "disko.nix"), "utf8"), "{ disk.main.device = \"/dev/sda\"; }\n");
  assert.equal(readFileSync(join(hostRoot, "secrets.nix"), "utf8"), "{ age.secrets = {}; }\n");
  assert.match(readFileSync(join(hostRoot, "default.nix"), "utf8"), /builtins.pathExists \.\/network\.nix/);
});

test("CLI render-tree --check reports deterministic generated tree drift", async () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-config-schema-platform-"));
  const writeStdout = stream();
  const cleanStdout = stream();
  const driftStdout = stream();
  const stderr = stream();

  assert.equal(await runCli([
    "render-tree",
    "fixtures/platform/single-node.platform.yaml",
    "--output",
    root,
    "--target",
    "traefik-public",
  ], { stdout: writeStdout, stderr }), 0);
  assert.equal(await runCli([
    "render-tree",
    "fixtures/platform/single-node.platform.yaml",
    "--output",
    root,
    "--target",
    "traefik-public",
    "--check",
  ], { stdout: cleanStdout, stderr }), 0);

  writeFileSync(
    join(root, "platform/cluster/flux/apps/edge/traefik-ingressroutes.yaml"),
    `${generatedHeader}\nchanged: true\n`,
  );
  const driftExitCode = await runCli([
    "render-tree",
    "fixtures/platform/single-node.platform.yaml",
    "--output",
    root,
    "--target",
    "traefik-public",
    "--check",
  ], { stdout: driftStdout, stderr });

  assert.equal(driftExitCode, 1);
  assert.equal(JSON.parse(cleanStdout.text()).ok, true);
  assert.equal(JSON.parse(driftStdout.text()).diagnostics[0].code, "E_RENDER_DIFF");
});

function snapshotTree(root) {
  return Object.fromEntries(walkFiles(root).map((path) => [
    path,
    readFileSync(join(root, path), "utf8"),
  ]));
}

function walkFiles(root, prefix = "") {
  const dir = join(root, prefix);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry}` : entry;
    const absolute = join(root, relative);
    if (statSync(absolute).isDirectory()) return walkFiles(root, relative);
    return [relative];
  });
}

test("CLI render-tree refuses unmanaged files unless forced", async () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-config-schema-platform-"));
  const unmanagedPath = join(root, "platform/cluster/flux/apps/edge/traefik-ingressroutes.yaml");
  mkdirSync(join(root, "platform/cluster/flux/apps/edge"), { recursive: true });
  writeFileSync(unmanagedPath, "manual: true\n");
  const stdout = stream();
  const stderr = stream();

  const exitCode = await runCli(["render-tree", "fixtures/platform/single-node.platform.yaml", "--output", root, "--target", "traefik-public"], { stdout, stderr });
  const forcedExitCode = await runCli(["render-tree", "fixtures/platform/single-node.platform.yaml", "--output", root, "--target", "traefik-public", "--force"], { stdout: stream(), stderr });

  assert.equal(exitCode, 1);
  assert.equal(JSON.parse(stdout.text()).diagnostics[0].code, "E_RENDER_OVERWRITE_REFUSED");
  assert.equal(forcedExitCode, 0);
});

test("CLI platform command usage errors are structured", async () => {
  const badTemplateStdout = stream();
  const badTemplateStderr = stream();
  const missingTargetStdout = stream();
  const missingTargetStderr = stream();
  const contractStdout = stream();
  const contractStderr = stream();

  const badTemplateExitCode = await runCli(
    ["init", "platform", "--template", "unknown", "--output", join(tmpdir(), "platform.yaml")],
    { stdout: badTemplateStdout, stderr: badTemplateStderr },
  );
  const missingTargetExitCode = await runCli(
    ["render-plan", "fixtures/platform/single-node.platform.yaml", "--target"],
    { stdout: missingTargetStdout, stderr: missingTargetStderr },
  );
  const contractExitCode = await runCli(["adapter-contract"], { stdout: contractStdout, stderr: contractStderr });

  assert.equal(badTemplateExitCode, 1);
  assert.equal(JSON.parse(badTemplateStderr.text()).diagnostics[0].code, "E_TEMPLATE_UNKNOWN");
  assert.equal(missingTargetExitCode, 1);
  assert.equal(JSON.parse(missingTargetStderr.text()).diagnostics[0].message, "--target requires a value");
  assert.equal(contractExitCode, 0);
  assert.ok(JSON.parse(contractStdout.text()).implemented.some((adapter) => adapter.name === "flux-root"));
});
