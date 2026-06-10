import { createRequire } from "node:module";
import type { ErrorObject } from "ajv";
import type { Ajv2020 as Ajv2020Class } from "ajv/dist/2020.js";
import { platformJsonSchema as schema } from "../schemas/generated-json.js";

export type Diagnostic = {
  code: string;
  message: string;
  path: string;
};

export type ValidationResult = {
  valid: boolean;
  diagnostics: Diagnostic[];
};

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js").default as typeof Ajv2020Class;

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

export function validatePlatform(document: unknown): ValidationResult {
  const schemaValid = validateSchema(document);
  if (!schemaValid) {
    return result(schemaDiagnostics(validateSchema.errors ?? []));
  }

  const diagnostics: Diagnostic[] = [];
  validateHosts(document, diagnostics);
  validateServices(document, diagnostics);
  validatePacks(document.packs ?? {}, diagnostics);
  return result(diagnostics);
}

function validateHosts(document: any, diagnostics: Diagnostic[]): void {
  const sites = new Set(Object.keys(document.sites ?? {}));
  for (const [hostName, host] of Object.entries(document.hosts ?? {}) as Array<[string, any]>) {
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

function validateServices(document: any, diagnostics: Diagnostic[]): void {
  const hosts = new Set(Object.keys(document.hosts ?? {}));
  const sites = new Set(Object.keys(document.sites ?? {}));

  for (const [serviceName, service] of Object.entries(document.services ?? {}) as Array<[string, any]>) {
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

function validatePacks(packs: unknown, diagnostics: Diagnostic[]): void {
  for (const [packName, value] of flattenPackNames(packs)) {
    if (!knownPacks.has(packName) && value !== "custom") {
      diagnostic(diagnostics, "E_PLATFORM_PACK_UNKNOWN", "/packs", `pack ${packName} is not known; use custom to reserve an external pack`);
    }
  }
}

function flattenPackNames(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    return value.map((entry): [string, unknown] => [String(entry), true]);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    if (Array.isArray(child)) {
      return child.map((entry): [string, unknown] => [String(entry), true]);
    }
    if (child && typeof child === "object" && Object.keys(child).length > 0) {
      return [[key, true], ...flattenPackNames(child)];
    }
    return [[key, child]];
  });
}

function result(diagnostics: Diagnostic[]): ValidationResult {
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

function schemaDiagnostics(errors: ErrorObject[]): Diagnostic[] {
  return errors.map((error) => ({
    code: "E_SCHEMA",
    message: `schema validation failed: ${error.message}`,
    path: schemaErrorPath(error),
  }));
}

function schemaErrorPath(error: ErrorObject): string {
  if (error.keyword === "required" && error.params?.missingProperty) {
    return joinPointer(error.instancePath || "/", error.params.missingProperty);
  }
  if (error.keyword === "additionalProperties" && error.params?.additionalProperty) {
    return joinPointer(error.instancePath || "/", error.params.additionalProperty);
  }
  return error.instancePath || "/";
}

function diagnostic(diagnostics: Diagnostic[], code: string, path: string, message: string): void {
  diagnostics.push({ code, message, path });
}

function pointer(...segments: Array<string | number>): string {
  return `/${segments.map(escapePointerSegment).join("/")}`;
}

function joinPointer(base: string, segment: string | number): string {
  const normalized = base === "/" ? "" : base;
  return `${normalized}/${escapePointerSegment(segment)}`;
}

function escapePointerSegment(segment: string | number): string {
  return String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
}
