import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { validateConfig } from "./validator.js";

const artifactSchemas = {
  "service-intent": "../schemas/round3/service-intent.schema.json",
  "fleet-inventory": "../schemas/round3/fleet-inventory.schema.json",
  "vault-dynamic-secrets": "../schemas/round3/vault-dynamic-secrets.schema.json",
};

const validators = new Map();

export const artifactKinds = ["deploy-config", ...Object.keys(artifactSchemas)];

export function validateArtifact(kind, document, options = {}) {
  if (kind === "deploy-config") {
    return validateConfig(document);
  }

  const schemaValidator = validatorFor(kind);
  const schemaValid = schemaValidator(document);
  if (!schemaValid) {
    return result(schemaDiagnostics(schemaValidator.errors ?? []));
  }

  const diagnostics = [];
  if (kind === "service-intent") {
    validateServiceIntent(document, diagnostics, options);
  } else if (kind === "fleet-inventory") {
    validateFleetInventory(document, diagnostics);
  } else if (kind === "vault-dynamic-secrets") {
    validateVaultDynamicSecrets(document, diagnostics);
  } else {
    diagnostic(diagnostics, "E_ARTIFACT_KIND_UNKNOWN", "/", `unknown artifact kind: ${kind}`);
  }

  return result(diagnostics);
}

export function isArtifactKind(value) {
  return artifactKinds.includes(value);
}

function validatorFor(kind) {
  if (!artifactSchemas[kind]) {
    throw new Error(`unknown artifact kind: ${kind}`);
  }
  if (!validators.has(kind)) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schema = JSON.parse(readFileSync(new URL(artifactSchemas[kind], import.meta.url), "utf8"));
    validators.set(kind, ajv.compile(schema));
  }
  return validators.get(kind);
}

function result(diagnostics) {
  const sorted = [...diagnostics].sort((left, right) => {
    const path = left.path.localeCompare(right.path);
    if (path !== 0) return path;
    const code = left.code.localeCompare(right.code);
    if (code !== 0) return code;
    return left.message.localeCompare(right.message);
  });
  return {
    valid: sorted.length === 0,
    diagnostics: sorted,
  };
}

function schemaDiagnostics(errors) {
  return errors.map((error) => ({
    code: "E_SCHEMA",
    message: `schema validation failed: ${error.message}`,
    path: schemaErrorPath(error),
  }));
}

function schemaErrorPath(error) {
  if (error.keyword === "required" && error.params?.missingProperty) {
    return joinPointer(error.instancePath || "/", error.params.missingProperty);
  }
  if (error.keyword === "additionalProperties" && error.params?.additionalProperty) {
    return joinPointer(error.instancePath || "/", error.params.additionalProperty);
  }
  return error.instancePath || "/";
}

function diagnostic(diagnostics, code, path, message) {
  diagnostics.push({ code, message, path });
}

function pointer(...segments) {
  return `/${segments.map(escapePointerSegment).join("/")}`;
}

function joinPointer(base, segment) {
  const normalized = base === "/" ? "" : base;
  return `${normalized}/${escapePointerSegment(segment)}`;
}

function escapePointerSegment(segment) {
  return String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
}

function validateServiceIntent(document, diagnostics, options) {
  const rendererDomain = options.rendererDomain ?? document.renderer?.public_domain;

  for (const [serviceName, service] of Object.entries(document.services)) {
    const servicePath = pointer("services", serviceName);
    validateServiceWorkload(serviceName, service, servicePath, diagnostics);
    validateServicePorts(serviceName, service, servicePath, diagnostics);
    validateServiceStorage(serviceName, service, servicePath, diagnostics);
    validateServiceSecrets(serviceName, service, servicePath, diagnostics);
    validateServiceRoutes(serviceName, service, servicePath, rendererDomain, diagnostics);
    validateServiceProbes(serviceName, service, servicePath, diagnostics);
    validateServiceObservability(serviceName, service, servicePath, diagnostics);
  }
}

function validateServiceWorkload(serviceName, service, servicePath, diagnostics) {
  const kind = service.workload.kind;
  const hasSchedule = service.workload.schedule !== undefined;

  if (kind === "cronjob" && !hasSchedule) {
    diagnostic(
      diagnostics,
      "E_SERVICE_CRONJOB_SCHEDULE_MISSING",
      joinPointer(joinPointer(servicePath, "workload"), "schedule"),
      `cronjob service ${serviceName} must declare workload.schedule`,
    );
  }
  if (kind !== "cronjob" && hasSchedule) {
    diagnostic(
      diagnostics,
      "E_SERVICE_SCHEDULE_KIND_INVALID",
      joinPointer(joinPointer(servicePath, "workload"), "schedule"),
      `service ${serviceName} may only declare workload.schedule when workload.kind is cronjob`,
    );
  }
  if (kind === "nomad_job" && !service.nomad) {
    diagnostic(
      diagnostics,
      "E_SERVICE_NOMAD_CONTRACT_MISSING",
      joinPointer(servicePath, "nomad"),
      `nomad service ${serviceName} must declare the contract-only nomad section`,
    );
  }
  if (service.nomad && service.nomad.renderer_status !== "design_only") {
    diagnostic(
      diagnostics,
      "E_SERVICE_NOMAD_RENDERER_NOT_CONTRACT_ONLY",
      joinPointer(joinPointer(servicePath, "nomad"), "renderer_status"),
      `nomad service ${serviceName} must keep renderer_status design_only`,
    );
  }
  if (kind !== "nomad_job" && service.nomad) {
    diagnostic(
      diagnostics,
      "E_SERVICE_NOMAD_KIND_INVALID",
      joinPointer(servicePath, "nomad"),
      `service ${serviceName} must use workload.kind nomad_job before declaring nomad contract fields`,
    );
  }
}

function validateServicePorts(serviceName, service, servicePath, diagnostics) {
  const seen = new Set();
  for (const [index, port] of (service.ports ?? []).entries()) {
    const portPath = pointer("services", serviceName, "ports", index);
    if (seen.has(port.name)) {
      diagnostic(
        diagnostics,
        "E_SERVICE_PORT_DUPLICATE",
        joinPointer(portPath, "name"),
        `service ${serviceName} declares port ${port.name} more than once`,
      );
    }
    seen.add(port.name);
  }
}

function validateServiceStorage(serviceName, service, servicePath, diagnostics) {
  const volumes = new Map((service.storage?.volumes ?? []).map((volume) => [volume.name, volume]));
  for (const [index, volume] of (service.storage?.volumes ?? []).entries()) {
    const volumePath = pointer("services", serviceName, "storage", "volumes", index);
    if (volume.kind === "pvc" && !volume.size) {
      diagnostic(
        diagnostics,
        "E_SERVICE_PVC_SIZE_MISSING",
        joinPointer(volumePath, "size"),
        `pvc volume ${volume.name} for service ${serviceName} must declare size`,
      );
    }
    if (volume.kind === "host_path" && !volume.path) {
      diagnostic(
        diagnostics,
        "E_SERVICE_HOST_PATH_MISSING",
        joinPointer(volumePath, "path"),
        `host_path volume ${volume.name} for service ${serviceName} must declare path`,
      );
    }
  }
  for (const [index, mount] of (service.storage?.mounts ?? []).entries()) {
    if (!volumes.has(mount.volume)) {
      diagnostic(
        diagnostics,
        "E_SERVICE_MOUNT_VOLUME_UNKNOWN",
        pointer("services", serviceName, "storage", "mounts", index, "volume"),
        `mount for service ${serviceName} references unknown volume ${mount.volume}`,
      );
    }
  }
}

function validateServiceSecrets(serviceName, service, servicePath, diagnostics) {
  for (const [index, secret] of (service.secrets ?? []).entries()) {
    const lease = secret.lease;
    if (lease?.default_ttl && lease?.max_ttl && durationSeconds(lease.default_ttl) > durationSeconds(lease.max_ttl)) {
      diagnostic(
        diagnostics,
        "E_SERVICE_SECRET_LEASE_TTL_INVALID",
        pointer("services", serviceName, "secrets", index, "lease", "max_ttl"),
        `secret ${secret.name} for service ${serviceName} must have max_ttl greater than or equal to default_ttl`,
      );
    }
  }
}

function validateServiceRoutes(serviceName, service, servicePath, rendererDomain, diagnostics) {
  const portNames = servicePortNames(service);
  for (const [index, route] of (service.networking?.routes ?? []).entries()) {
    const routePath = pointer("services", serviceName, "networking", "routes", index);
    if (!portNames.has(route.port)) {
      diagnostic(
        diagnostics,
        "E_SERVICE_ROUTE_PORT_UNKNOWN",
        joinPointer(routePath, "port"),
        `route ${route.name} for service ${serviceName} references unknown port ${route.port}`,
      );
    }
    if (rendererDomain && route.host && !hostLabel(route.host, rendererDomain)) {
      diagnostic(
        diagnostics,
        "E_SERVICE_ROUTE_HOST_UNRENDERABLE",
        joinPointer(routePath, "host"),
        `route ${route.name} host must be root, ${rendererDomain}, or a subdomain of ${rendererDomain} for existing renderers`,
      );
    }
  }
}

function validateServiceProbes(serviceName, service, servicePath, diagnostics) {
  const portNames = servicePortNames(service);
  for (const [index, probe] of (service.gatus?.endpoints ?? []).entries()) {
    const probePath = pointer("services", serviceName, "gatus", "endpoints", index);
    validateNamedProbe(serviceName, probe, probePath, portNames, diagnostics);
  }
}

function validateServiceObservability(serviceName, service, servicePath, diagnostics) {
  const portNames = servicePortNames(service);
  for (const [index, monitor] of (service.observability?.metrics ?? []).entries()) {
    if (!portNames.has(monitor.port)) {
      diagnostic(
        diagnostics,
        "E_SERVICE_MONITOR_PORT_UNKNOWN",
        pointer("services", serviceName, "observability", "metrics", index, "port"),
        `monitor for service ${serviceName} references unknown port ${monitor.port}`,
      );
    }
  }
}

function validateNamedProbe(serviceName, probe, probePath, portNames, diagnostics) {
  if (probe.port && !portNames.has(probe.port)) {
    diagnostic(
      diagnostics,
      "E_SERVICE_PROBE_PORT_UNKNOWN",
      joinPointer(probePath, "port"),
      `probe ${probe.name} for service ${serviceName} references unknown port ${probe.port}`,
    );
  }
  if (probe.type === "tcp" && probe.path) {
    diagnostic(
      diagnostics,
      "E_SERVICE_TCP_PROBE_PATH_INVALID",
      joinPointer(probePath, "path"),
      `tcp probe ${probe.name} for service ${serviceName} must not declare path`,
    );
  }
  if (probe.type === "tcp" && probe.expected_status !== undefined) {
    diagnostic(
      diagnostics,
      "E_SERVICE_TCP_PROBE_STATUS_INVALID",
      joinPointer(probePath, "expected_status"),
      `tcp probe ${probe.name} for service ${serviceName} must not declare expected_status`,
    );
  }
}

function servicePortNames(service) {
  return new Set((service.ports ?? []).map((port) => port.name));
}

function hostLabel(host, publicDomain) {
  if (host === "root" || host === publicDomain) return "root";
  const suffix = `.${publicDomain}`;
  if (host.endsWith(suffix) && host.length > suffix.length) {
    return host.slice(0, -suffix.length);
  }
  return undefined;
}

function validateFleetInventory(document, diagnostics) {
  const fleet = document.fleet;
  const sites = new Set(Object.keys(fleet.sites));
  const nodes = new Set(Object.keys(fleet.nodes));
  const capabilities = new Set(Object.keys(fleet.capabilities ?? {}));
  const origins = new Set(Object.keys(fleet.origins));
  const exposureClasses = new Set(Object.keys(fleet.exposure.classes ?? {}));
  const ssoPolicies = new Set(Object.keys(fleet.sso.policies ?? {}));
  const acceleratorClasses = new Set(
    Object.values(fleet.nodes).flatMap((node) => (node.accelerators ?? []).map((accelerator) => accelerator.class)),
  );

  for (const [nodeName, node] of Object.entries(fleet.nodes)) {
    if (!sites.has(node.site)) {
      diagnostic(diagnostics, "E_FLEET_NODE_SITE_UNKNOWN", pointer("fleet", "nodes", nodeName, "site"), `node ${nodeName} references unknown site ${node.site}`);
    }
    for (const capability of node.capabilities) {
      if (!capabilities.has(capability)) {
        diagnostic(diagnostics, "E_FLEET_NODE_CAPABILITY_UNKNOWN", pointer("fleet", "nodes", nodeName, "capabilities"), `node ${nodeName} references unknown capability ${capability}`);
      }
    }
  }

  for (const [index, rule] of (fleet.placement.rules ?? []).entries()) {
    const selector = rule.selector;
    for (const site of selector.sites ?? []) {
      if (!sites.has(site)) {
        diagnostic(diagnostics, "E_FLEET_PLACEMENT_SITE_UNKNOWN", pointer("fleet", "placement", "rules", index, "selector", "sites"), `placement rule ${rule.name} references unknown site ${site}`);
      }
    }
    for (const node of selector.nodes ?? []) {
      if (!nodes.has(node)) {
        diagnostic(diagnostics, "E_FLEET_PLACEMENT_NODE_UNKNOWN", pointer("fleet", "placement", "rules", index, "selector", "nodes"), `placement rule ${rule.name} references unknown node ${node}`);
      }
    }
    for (const capability of selector.required_capabilities ?? []) {
      if (!capabilities.has(capability)) {
        diagnostic(diagnostics, "E_FLEET_PLACEMENT_CAPABILITY_UNKNOWN", pointer("fleet", "placement", "rules", index, "selector", "required_capabilities"), `placement rule ${rule.name} references unknown capability ${capability}`);
      }
    }
    for (const acceleratorClass of selector.accelerator_classes ?? []) {
      if (!acceleratorClasses.has(acceleratorClass)) {
        diagnostic(diagnostics, "E_FLEET_PLACEMENT_ACCELERATOR_UNKNOWN", pointer("fleet", "placement", "rules", index, "selector", "accelerator_classes"), `placement rule ${rule.name} references unknown accelerator class ${acceleratorClass}`);
      }
    }
  }

  for (const [originName, origin] of Object.entries(fleet.origins)) {
    if (origin.site && !sites.has(origin.site)) {
      diagnostic(diagnostics, "E_FLEET_ORIGIN_SITE_UNKNOWN", pointer("fleet", "origins", originName, "site"), `origin ${originName} references unknown site ${origin.site}`);
    }
    if (["direct_wan", "direct_lan"].includes(origin.kind) && !origin.site) {
      diagnostic(diagnostics, "E_FLEET_ORIGIN_SITE_REQUIRED", pointer("fleet", "origins", originName, "site"), `origin ${originName} of kind ${origin.kind} must declare site`);
    }
  }

  for (const [className, exposureClass] of Object.entries(fleet.exposure.classes ?? {})) {
    if (exposureClass.default_origin && !origins.has(exposureClass.default_origin)) {
      diagnostic(diagnostics, "E_FLEET_EXPOSURE_ORIGIN_UNKNOWN", pointer("fleet", "exposure", "classes", className, "default_origin"), `exposure class ${className} references unknown origin ${exposureClass.default_origin}`);
    }
  }
  for (const [serviceName, service] of Object.entries(fleet.exposure.services ?? {})) {
    if (!exposureClasses.has(service.class)) {
      diagnostic(diagnostics, "E_FLEET_SERVICE_EXPOSURE_CLASS_UNKNOWN", pointer("fleet", "exposure", "services", serviceName, "class"), `service ${serviceName} references unknown exposure class ${service.class}`);
    }
    if (service.origin && !origins.has(service.origin)) {
      diagnostic(diagnostics, "E_FLEET_SERVICE_ORIGIN_UNKNOWN", pointer("fleet", "exposure", "services", serviceName, "origin"), `service ${serviceName} references unknown origin ${service.origin}`);
    }
    if (service.sso_policy && !ssoPolicies.has(service.sso_policy)) {
      diagnostic(diagnostics, "E_FLEET_SERVICE_SSO_POLICY_UNKNOWN", pointer("fleet", "exposure", "services", serviceName, "sso_policy"), `service ${serviceName} references unknown SSO policy ${service.sso_policy}`);
    }
  }

  for (const [index, target] of fleet.renderer_targets.entries()) {
    if (target.kind === "nomad_jobs" && target.status !== "design_only") {
      diagnostic(diagnostics, "E_FLEET_NOMAD_RENDERER_NOT_CONTRACT_ONLY", pointer("fleet", "renderer_targets", index, "status"), "nomad_jobs renderer target must remain design_only");
    }
  }
}

function validateVaultDynamicSecrets(document, diagnostics) {
  const vault = document.vault;
  const roles = new Set(Object.keys(vault.auth.kubernetes.roles));
  const kvPaths = new Set(Object.keys(vault.kv.paths));
  const transitKeys = new Set(Object.keys(vault.transit.keys ?? {}));
  const databaseRoles = new Set(flatRoleNames(vault.database.engines ?? {}));
  const rabbitmqRoles = new Set(flatRoleNames(vault.rabbitmq.engines ?? {}));

  if (!roles.has(vault.vso.auth_role)) {
    diagnostic(diagnostics, "E_VAULT_VSO_AUTH_ROLE_UNKNOWN", "/vault/vso/auth_role", `VSO auth role ${vault.vso.auth_role} is not declared`);
  }

  for (const [syncName, sync] of Object.entries(vault.vso.static_syncs)) {
    if (!kvPaths.has(sync.kv_path_ref)) {
      diagnostic(diagnostics, "E_VAULT_VSO_KV_PATH_UNKNOWN", pointer("vault", "vso", "static_syncs", syncName, "kv_path_ref"), `VSO static sync ${syncName} references unknown KV path ${sync.kv_path_ref}`);
    }
  }
  for (const [syncName, sync] of Object.entries(vault.vso.dynamic_syncs ?? {})) {
    const roleSet = sync.engine === "database" ? databaseRoles : rabbitmqRoles;
    if (!roleSet.has(sync.role)) {
      diagnostic(diagnostics, "E_VAULT_VSO_DYNAMIC_ROLE_UNKNOWN", pointer("vault", "vso", "dynamic_syncs", syncName, "role"), `VSO dynamic sync ${syncName} references unknown ${sync.engine} role ${sync.role}`);
    }
  }

  for (const [consumerName, consumer] of Object.entries(vault.service_consumers)) {
    checkRefs(diagnostics, consumer.kubernetes_role_ref ? [consumer.kubernetes_role_ref] : [], roles, pointer("vault", "service_consumers", consumerName, "kubernetes_role_ref"), `service consumer ${consumerName}`, "Kubernetes auth role", "E_VAULT_CONSUMER_AUTH_ROLE_UNKNOWN");
    checkRefs(diagnostics, consumer.kv_path_refs ?? [], kvPaths, pointer("vault", "service_consumers", consumerName, "kv_path_refs"), `service consumer ${consumerName}`, "KV path", "E_VAULT_CONSUMER_KV_PATH_UNKNOWN");
    checkRefs(diagnostics, consumer.transit_key_refs ?? [], transitKeys, pointer("vault", "service_consumers", consumerName, "transit_key_refs"), `service consumer ${consumerName}`, "transit key", "E_VAULT_CONSUMER_TRANSIT_KEY_UNKNOWN");
    checkRefs(diagnostics, consumer.database_role_refs ?? [], databaseRoles, pointer("vault", "service_consumers", consumerName, "database_role_refs"), `service consumer ${consumerName}`, "database role", "E_VAULT_CONSUMER_DATABASE_ROLE_UNKNOWN");
    checkRefs(diagnostics, consumer.rabbitmq_role_refs ?? [], rabbitmqRoles, pointer("vault", "service_consumers", consumerName, "rabbitmq_role_refs"), `service consumer ${consumerName}`, "RabbitMQ role", "E_VAULT_CONSUMER_RABBITMQ_ROLE_UNKNOWN");
  }

  for (const [engineName, engine] of Object.entries(vault.database.engines ?? {})) {
    if (!kvPaths.has(engine.connection.admin_secret_ref)) {
      diagnostic(diagnostics, "E_VAULT_DATABASE_ADMIN_SECRET_UNKNOWN", pointer("vault", "database", "engines", engineName, "connection", "admin_secret_ref"), `database engine ${engineName} references unknown admin secret ${engine.connection.admin_secret_ref}`);
    }
    validateRoleTtls(engine.roles, pointer("vault", "database", "engines", engineName, "roles"), "database", diagnostics);
  }
  for (const [engineName, engine] of Object.entries(vault.rabbitmq.engines ?? {})) {
    if (!kvPaths.has(engine.connection.admin_secret_ref)) {
      diagnostic(diagnostics, "E_VAULT_RABBITMQ_ADMIN_SECRET_UNKNOWN", pointer("vault", "rabbitmq", "engines", engineName, "connection", "admin_secret_ref"), `RabbitMQ engine ${engineName} references unknown admin secret ${engine.connection.admin_secret_ref}`);
    }
    validateRoleTtls(engine.roles, pointer("vault", "rabbitmq", "engines", engineName, "roles"), "RabbitMQ", diagnostics);
  }
}

function flatRoleNames(engines) {
  return Object.values(engines).flatMap((engine) => Object.keys(engine.roles ?? {}));
}

function checkRefs(diagnostics, refs, known, path, owner, label, code) {
  for (const ref of refs) {
    if (!known.has(ref)) {
      diagnostic(diagnostics, code, path, `${owner} references unknown ${label} ${ref}`);
    }
  }
}

function validateRoleTtls(roles, path, label, diagnostics) {
  for (const [roleName, role] of Object.entries(roles ?? {})) {
    if (durationSeconds(role.default_ttl) > durationSeconds(role.max_ttl)) {
      diagnostic(
        diagnostics,
        "E_VAULT_ROLE_TTL_INVALID",
        pointerFrom(path, roleName, "max_ttl"),
        `${label} role ${roleName} must have max_ttl greater than or equal to default_ttl`,
      );
    }
  }
}

function pointerFrom(base, ...segments) {
  return segments.reduce((current, segment) => joinPointer(current, segment), base);
}

function durationSeconds(value) {
  const match = /^([0-9]+)(s|m|h|d)$/.exec(value);
  if (!match) return 0;
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(match[1]) * multipliers[match[2]];
}
