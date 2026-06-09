import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";
import { validateArtifact } from "../src/artifact-validator.js";
import { runCli } from "../src/cli.js";
import { normalizeServiceIntentForRender } from "../src/service-intent-normalizer.js";
import { renderEdgeCatalog } from "../src/adapters/catalog.js";

const serviceIntent = readYaml("../fixtures/round3/service-intent.sample.yaml");
const renderableServiceIntent = readYaml("../fixtures/round4/service-intent-renderable.sample.yaml");
const fleetInventory = readYaml("../fixtures/round3/fleet-inventory.sample.yaml");
const vaultDynamicSecrets = readYaml("../fixtures/round3/vault-dynamic-secrets.sample.yaml");

function readYaml(relativePath) {
  return YAML.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function clone(value) {
  return structuredClone(value);
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

function codesFor(kind, document, options) {
  return validateArtifact(kind, document, options).diagnostics.map((diagnostic) => diagnostic.code);
}

test("round-4 artifact validators accept valid standalone fixtures", () => {
  assert.deepEqual(validateArtifact("service-intent", serviceIntent).diagnostics, []);
  assert.deepEqual(validateArtifact("service-intent", renderableServiceIntent).diagnostics, []);
  assert.deepEqual(validateArtifact("fleet-inventory", fleetInventory).diagnostics, []);
  assert.deepEqual(validateArtifact("vault-dynamic-secrets", vaultDynamicSecrets).diagnostics, []);
});

test("service-intent semantic validator reports broken references and contract violations", () => {
  const document = clone(renderableServiceIntent);
  document.services["api-service"].networking.routes[0].port = "missing";
  document.services["api-service"].gatus.endpoints[0].port = "missing";
  document.services["api-service"].observability = {
    metrics: [{ kind: "ServiceMonitor", port: "missing" }],
  };
  document.services["api-service"].storage = {
    volumes: [{ name: "data", kind: "pvc" }],
    mounts: [{ volume: "missing", path: "/data" }],
  };
  document.services["worker-cron"].workload.schedule = undefined;
  document.services["api-service"].nomad = {
    renderer_status: "design_only",
    implementation_prerequisites: ["representative_input_fixture"],
  };

  const codes = new Set(codesFor("service-intent", document));

  assert.ok(codes.has("E_SERVICE_ROUTE_PORT_UNKNOWN"));
  assert.ok(codes.has("E_SERVICE_PROBE_PORT_UNKNOWN"));
  assert.ok(codes.has("E_SERVICE_MONITOR_PORT_UNKNOWN"));
  assert.ok(codes.has("E_SERVICE_PVC_SIZE_MISSING"));
  assert.ok(codes.has("E_SERVICE_MOUNT_VOLUME_UNKNOWN"));
  assert.ok(codes.has("E_SERVICE_CRONJOB_SCHEDULE_MISSING"));
  assert.ok(codes.has("E_SERVICE_NOMAD_KIND_INVALID"));
});

test("service-intent renderer host validation is explicit when renderer domain is configured", () => {
  const document = clone(renderableServiceIntent);
  document.services["api-service"].networking.routes[0].host = "api.other.example";

  assert.ok(codesFor("service-intent", document).includes("E_SERVICE_ROUTE_HOST_UNRENDERABLE"));
});

test("fleet inventory semantic validator reports broken cross references", () => {
  const document = clone(fleetInventory);
  document.fleet.nodes["edge-node-1"].site = "missing-site";
  document.fleet.nodes["edge-node-1"].capabilities.push("missing-capability");
  document.fleet.placement.rules[0].selector.sites.push("missing-site");
  document.fleet.placement.rules[0].selector.nodes = ["missing-node"];
  document.fleet.placement.rules[0].selector.accelerator_classes = ["missing-accelerator"];
  document.fleet.origins["edge-direct"].site = "missing-site";
  document.fleet.exposure.classes.public.default_origin = "missing-origin";
  document.fleet.exposure.services["api-service"].class = "missing-class";
  document.fleet.exposure.services["api-service"].origin = "missing-origin";
  document.fleet.exposure.services["api-service"].sso_policy = "missing-sso";
  document.fleet.renderer_targets.find((target) => target.kind === "nomad_jobs").status = "implemented";

  const codes = new Set(codesFor("fleet-inventory", document));

  assert.ok(codes.has("E_FLEET_NODE_SITE_UNKNOWN"));
  assert.ok(codes.has("E_FLEET_NODE_CAPABILITY_UNKNOWN"));
  assert.ok(codes.has("E_FLEET_PLACEMENT_SITE_UNKNOWN"));
  assert.ok(codes.has("E_FLEET_PLACEMENT_NODE_UNKNOWN"));
  assert.ok(codes.has("E_FLEET_PLACEMENT_ACCELERATOR_UNKNOWN"));
  assert.ok(codes.has("E_FLEET_ORIGIN_SITE_UNKNOWN"));
  assert.ok(codes.has("E_FLEET_EXPOSURE_ORIGIN_UNKNOWN"));
  assert.ok(codes.has("E_FLEET_SERVICE_EXPOSURE_CLASS_UNKNOWN"));
  assert.ok(codes.has("E_FLEET_SERVICE_ORIGIN_UNKNOWN"));
  assert.ok(codes.has("E_FLEET_SERVICE_SSO_POLICY_UNKNOWN"));
  assert.ok(codes.has("E_FLEET_NOMAD_RENDERER_NOT_CONTRACT_ONLY"));
});

test("vault dynamic-secret semantic validator reports broken cross references", () => {
  const document = clone(vaultDynamicSecrets);
  document.vault.vso.auth_role = "missing-role";
  document.vault.vso.static_syncs["api-runtime"].kv_path_ref = "missing-kv";
  document.vault.vso.dynamic_syncs["worker-database"].role = "missing-db-role";
  document.vault.service_consumers["api-service"].kubernetes_role_ref = "missing-role";
  document.vault.service_consumers["api-service"].kv_path_refs.push("missing-kv");
  document.vault.service_consumers["api-service"].transit_key_refs.push("missing-key");
  document.vault.service_consumers["api-service"].database_role_refs.push("missing-db-role");
  document.vault.service_consumers["api-service"].rabbitmq_role_refs.push("missing-broker-role");
  document.vault.database.engines["app-database"].connection.admin_secret_ref = "missing-kv";
  document.vault.database.engines["app-database"].roles["api-db-role"].max_ttl = "1h";
  document.vault.rabbitmq.engines["app-broker"].connection.admin_secret_ref = "missing-kv";

  const codes = new Set(codesFor("vault-dynamic-secrets", document));

  assert.ok(codes.has("E_VAULT_VSO_AUTH_ROLE_UNKNOWN"));
  assert.ok(codes.has("E_VAULT_VSO_KV_PATH_UNKNOWN"));
  assert.ok(codes.has("E_VAULT_VSO_DYNAMIC_ROLE_UNKNOWN"));
  assert.ok(codes.has("E_VAULT_CONSUMER_AUTH_ROLE_UNKNOWN"));
  assert.ok(codes.has("E_VAULT_CONSUMER_KV_PATH_UNKNOWN"));
  assert.ok(codes.has("E_VAULT_CONSUMER_TRANSIT_KEY_UNKNOWN"));
  assert.ok(codes.has("E_VAULT_CONSUMER_DATABASE_ROLE_UNKNOWN"));
  assert.ok(codes.has("E_VAULT_CONSUMER_RABBITMQ_ROLE_UNKNOWN"));
  assert.ok(codes.has("E_VAULT_DATABASE_ADMIN_SECRET_UNKNOWN"));
  assert.ok(codes.has("E_VAULT_ROLE_TTL_INVALID"));
  assert.ok(codes.has("E_VAULT_RABBITMQ_ADMIN_SECRET_UNKNOWN"));
});

test("service-intent normalizer feeds existing generic catalog renderer", () => {
  const config = normalizeServiceIntentForRender(renderableServiceIntent);
  const rendered = renderEdgeCatalog(config);

  assert.match(rendered, /cluster: example-cluster/);
  assert.match(rendered, /name: api-service/);
  assert.match(rendered, /exposure: public/);
  assert.match(rendered, /access: sso_protected/);
  assert.match(rendered, /host: api\.example\.net/);
  assert.match(rendered, /name: worker-cron/);
  assert.match(rendered, /exposure: internal_only/);
});

test("CLI validates standalone artifacts and renders service-intent through implemented adapters", async () => {
  const validateStdout = stream();
  const validateStderr = stream();
  const renderStdout = stream();
  const renderStderr = stream();

  const validateExitCode = await runCli(
    ["validate", "service-intent", "fixtures/round4/service-intent-renderable.sample.yaml"],
    { stdout: validateStdout, stderr: validateStderr },
  );
  const renderExitCode = await runCli(
    ["render", "gatus", "fixtures/round4/service-intent-renderable.sample.yaml", "--input", "service-intent"],
    { stdout: renderStdout, stderr: renderStderr },
  );

  assert.equal(validateExitCode, 0);
  assert.equal(validateStderr.text(), "");
  assert.deepEqual(JSON.parse(validateStdout.text()), { valid: true, diagnostics: [] });
  assert.equal(renderExitCode, 0);
  assert.equal(renderStderr.text(), "");
  assert.match(renderStdout.text(), /name: service-intent-gatus-endpoints/);
  assert.match(renderStdout.text(), /name: api-service \(internal\)/);
  assert.match(renderStdout.text(), /url: https:\/\/api\.example\.net\/api\/health/);
});

test("CLI requires renderer domain before rendering service-intent input", async () => {
  const stdout = stream();
  const stderr = stream();

  const exitCode = await runCli(
    ["render", "gatus", "fixtures/round3/service-intent.sample.yaml", "--input", "service-intent"],
    { stdout, stderr },
  );

  assert.equal(exitCode, 1);
  assert.equal(stdout.text(), "");
  assert.equal(JSON.parse(stderr.text()).diagnostics[0].code, "E_RENDERER_DOMAIN_REQUIRED");
});
