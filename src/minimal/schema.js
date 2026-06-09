import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";

const schema = JSON.parse(
  readFileSync(new URL("../../schemas/platform.schema.json", import.meta.url), "utf8"),
);

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});

const validateSchema = ajv.compile(schema);

const knownRoles = new Set([
  "base",
  "k3s-control-plane",
  "k3s-worker",
  "utility-host",
  "gpu-amd",
  "gpu-nvidia",
  "tailscale-network",
  "raspberry-pi-image",
  "custom",
]);

const knownPacks = new Set([
  "cert-manager",
  "core",
  "data",
  "edge",
  "external-dns",
  "traefik-public",
  "traefik-lan",
  "metallb",
  "vso",
  "cloudflare",
  "forwardAuth",
  "edgeMiddleware",
  "metrics",
  "grafana",
  "loki",
  "tempo",
  "alloy",
  "gatus",
  "rabbitmq",
  "mariadb",
  "observability",
  "utility",
  "custom",
]);

export function validatePlatform(document) {
  const schemaValid = validateSchema(document);
  if (!schemaValid) {
    return result(schemaDiagnostics(validateSchema.errors ?? []));
  }

  const diagnostics = [];
  validateHosts(document, diagnostics);
  validateServices(document, diagnostics);
  validatePacks(document.packs ?? {}, diagnostics);
  return result(diagnostics);
}

function validateHosts(document, diagnostics) {
  const sites = new Set(Object.keys(document.sites ?? {}));
  for (const [hostName, host] of Object.entries(document.hosts ?? {})) {
    if (host.site && sites.size > 0 && !sites.has(host.site)) {
      diagnostic(diagnostics, "E_PLATFORM_HOST_SITE_UNKNOWN", pointer("hosts", hostName, "site"), `host ${hostName} references unknown site ${host.site}`);
    }
    for (const [index, role] of (host.roles ?? []).entries()) {
      if (!knownRoles.has(role)) {
        diagnostic(diagnostics, "E_PLATFORM_HOST_ROLE_UNKNOWN", pointer("hosts", hostName, "roles", index), `host ${hostName} role ${role} is not a known renderer role`);
      }
    }
  }
}

function validateServices(document, diagnostics) {
  const hosts = new Set(Object.keys(document.hosts ?? {}));
  const sites = new Set(Object.keys(document.sites ?? {}));

  for (const [serviceName, service] of Object.entries(document.services ?? {})) {
    if (service.schedule?.node && hosts.size > 0 && !hosts.has(service.schedule.node)) {
      diagnostic(diagnostics, "E_PLATFORM_SERVICE_NODE_UNKNOWN", pointer("services", serviceName, "schedule", "node"), `service ${serviceName} references unknown node ${service.schedule.node}`);
    }
    if (service.schedule?.site && sites.size > 0 && !sites.has(service.schedule.site)) {
      diagnostic(diagnostics, "E_PLATFORM_SERVICE_SITE_UNKNOWN", pointer("services", serviceName, "schedule", "site"), `service ${serviceName} references unknown site ${service.schedule.site}`);
    }
    for (const [index, volume] of (service.storage ?? []).entries()) {
      if (volume.node && hosts.size > 0 && !hosts.has(volume.node)) {
        diagnostic(diagnostics, "E_PLATFORM_STORAGE_NODE_UNKNOWN", pointer("services", serviceName, "storage", index, "node"), `storage ${volume.name} for ${serviceName} references unknown node ${volume.node}`);
      }
    }
  }
}

function validatePacks(packs, diagnostics) {
  for (const [packName, value] of flattenPackNames(packs)) {
    if (!knownPacks.has(packName) && value !== "custom") {
      diagnostic(diagnostics, "E_PLATFORM_PACK_UNKNOWN", "/packs", `pack ${packName} is not known; use custom to reserve an external pack`);
    }
  }
}

function flattenPackNames(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => [entry, true]);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) => {
    if (Array.isArray(child)) {
      return child.map((entry) => [entry, true]);
    }
    if (child && typeof child === "object" && Object.keys(child).length > 0) {
      return [[key, true], ...flattenPackNames(child)];
    }
    return [[key, child]];
  });
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
