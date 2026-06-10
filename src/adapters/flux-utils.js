import { existsSync, readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import YAML from "yaml";
import { safeRelativePath } from "../render-plan/paths.js";

const CORE_CERT_MANAGER_PLACEHOLDERS = [
  "CERT_MANAGER_CHART_NAME",
  "CERT_MANAGER_CHART_VERSION",
  "CERT_MANAGER_HELM_REPOSITORY_INTERVAL",
  "CERT_MANAGER_HELM_REPOSITORY_NAME",
  "CERT_MANAGER_HELM_REPOSITORY_URL",
  "CERT_MANAGER_NAMESPACE",
  "CERT_MANAGER_RELEASE_INTERVAL",
  "CERT_MANAGER_RELEASE_NAME",
];

const CORE_EXTERNAL_DNS_CLOUDFLARE_PLACEHOLDERS = [
  "EXTERNAL_DNS_ANNOTATION_FILTER",
  "EXTERNAL_DNS_CHART_NAME",
  "EXTERNAL_DNS_CHART_VERSION",
  "EXTERNAL_DNS_CLOUDFLARE_TOKEN_SECRET_KEY",
  "EXTERNAL_DNS_CLOUDFLARE_TOKEN_SECRET_NAME",
  "EXTERNAL_DNS_DOMAIN_FILTER",
  "EXTERNAL_DNS_HELM_REPOSITORY_INTERVAL",
  "EXTERNAL_DNS_HELM_REPOSITORY_NAME",
  "EXTERNAL_DNS_HELM_REPOSITORY_URL",
  "EXTERNAL_DNS_NAMESPACE",
  "EXTERNAL_DNS_NODE_SELECTOR_KEY",
  "EXTERNAL_DNS_NODE_SELECTOR_VALUE",
  "EXTERNAL_DNS_RELEASE_INTERVAL",
  "EXTERNAL_DNS_RELEASE_NAME",
  "EXTERNAL_DNS_TXT_OWNER_ID",
];

const CORE_TRAEFIK_PUBLIC_PLACEHOLDERS = [
  "TRAEFIK_PUBLIC_CHART_NAME",
  "TRAEFIK_PUBLIC_CHART_VERSION",
  "TRAEFIK_PUBLIC_CLOUDFLARE_PROXIED",
  "TRAEFIK_PUBLIC_EXTERNAL_DNS_HOSTNAME",
  "TRAEFIK_PUBLIC_EXTERNAL_TRAFFIC_POLICY",
  "TRAEFIK_PUBLIC_HELM_REPOSITORY_INTERVAL",
  "TRAEFIK_PUBLIC_HELM_REPOSITORY_NAME",
  "TRAEFIK_PUBLIC_HELM_REPOSITORY_URL",
  "TRAEFIK_PUBLIC_INGRESS_CLASS",
  "TRAEFIK_PUBLIC_METRICS_PORT",
  "TRAEFIK_PUBLIC_NAMESPACE",
  "TRAEFIK_PUBLIC_NODE_SELECTOR_KEY",
  "TRAEFIK_PUBLIC_NODE_SELECTOR_VALUE",
  "TRAEFIK_PUBLIC_OTLP_ENABLED",
  "TRAEFIK_PUBLIC_OTLP_ENDPOINT",
  "TRAEFIK_PUBLIC_RELEASE_INTERVAL",
  "TRAEFIK_PUBLIC_RELEASE_NAME",
  "TRAEFIK_PUBLIC_SERVICE_TYPE",
  "TRAEFIK_PUBLIC_TRACE_SAMPLE_RATE",
  "TRAEFIK_PUBLIC_WEB_HOST_PORT",
  "TRAEFIK_PUBLIC_WEBSECURE_HOST_PORT",
];

const CORE_TRAEFIK_LAN_PLACEHOLDERS = [
  "TRAEFIK_LAN_CHART_NAME",
  "TRAEFIK_LAN_CHART_VERSION",
  "TRAEFIK_LAN_HELM_REPOSITORY_INTERVAL",
  "TRAEFIK_LAN_HELM_REPOSITORY_NAME",
  "TRAEFIK_LAN_HELM_REPOSITORY_URL",
  "TRAEFIK_LAN_INGRESS_CLASS",
  "TRAEFIK_LAN_METALLB_ADDRESS_POOL",
  "TRAEFIK_LAN_NAMESPACE",
  "TRAEFIK_LAN_NODE_SELECTOR_KEY",
  "TRAEFIK_LAN_NODE_SELECTOR_VALUE",
  "TRAEFIK_LAN_RELEASE_INTERVAL",
  "TRAEFIK_LAN_RELEASE_NAME",
  "TRAEFIK_LAN_WEB_PORT",
  "TRAEFIK_LAN_WEBSECURE_PORT",
];

const CORE_METALLB_PLACEHOLDERS = [
  "METALLB_ADDRESS_POOL_NAME",
  "METALLB_ADDRESS_RANGE",
  "METALLB_CHART_NAME",
  "METALLB_CHART_VERSION",
  "METALLB_HELM_REPOSITORY_INTERVAL",
  "METALLB_HELM_REPOSITORY_NAME",
  "METALLB_HELM_REPOSITORY_URL",
  "METALLB_L2_ADVERTISEMENT_NAME",
  "METALLB_NAMESPACE",
  "METALLB_RELEASE_INTERVAL",
  "METALLB_RELEASE_NAME",
];

const CORE_VSO_PLACEHOLDERS = [
  "VSO_CHART_NAME",
  "VSO_CHART_VERSION",
  "VSO_DEFAULT_VAULT_ADDRESS",
  "VSO_HELM_REPOSITORY_INTERVAL",
  "VSO_HELM_REPOSITORY_NAME",
  "VSO_HELM_REPOSITORY_URL",
  "VSO_KUBERNETES_AUTH_MOUNT",
  "VSO_KUBERNETES_AUTH_ROLE",
  "VSO_NAMESPACE",
  "VSO_RELEASE_INTERVAL",
  "VSO_RELEASE_NAME",
  "VSO_SERVICE_ACCOUNT_NAME",
  "VSO_TOKEN_AUDIENCE",
];

const EDGE_PACK_PLACEHOLDERS = [
  "EDGE_ACME_EMAIL",
  "EDGE_ACME_PRIVATE_KEY_SECRET_NAME",
  "EDGE_ACME_SERVER",
  "EDGE_CLOUDFLARE_CLUSTER_ISSUER_NAME",
  "EDGE_CLOUDFLARE_TOKEN_SECRET_KEY",
  "EDGE_CLOUDFLARE_TOKEN_SECRET_NAME",
  "EDGE_DEFAULT_TLS_SECRET_NAME",
  "EDGE_DEFAULT_TLS_STORE_NAME",
  "EDGE_FORWARD_AUTH_ADDRESS",
  "EDGE_FORWARD_AUTH_MIDDLEWARE_NAME",
  "EDGE_FORWARD_AUTH_RESPONSE_HEADER_1",
  "EDGE_FORWARD_AUTH_RESPONSE_HEADER_2",
  "EDGE_FORWARD_AUTH_TRUST_FORWARD_HEADER",
  "EDGE_NAMESPACE",
];

const EDGE_MIDDLEWARE_PLACEHOLDERS = [
  "EDGE_CSP_ADMIN_MIDDLEWARE_NAME",
  "EDGE_CSP_ADMIN_POLICY",
  "EDGE_CSP_STRICT_MIDDLEWARE_NAME",
  "EDGE_CSP_STRICT_POLICY",
  "EDGE_CSP_WORKFLOW_MIDDLEWARE_NAME",
  "EDGE_CSP_WORKFLOW_POLICY",
  "EDGE_DASHBOARD_CHAIN_MIDDLEWARE_NAME",
  "EDGE_DASHBOARD_ENTRYPOINT",
  "EDGE_DASHBOARD_HOSTNAME",
  "EDGE_DASHBOARD_INGRESSROUTE_NAME",
  "EDGE_DASHBOARD_TLS_SECRET_NAME",
  "EDGE_FORWARD_AUTH_ADDRESS",
  "EDGE_FORWARD_AUTH_MIDDLEWARE_NAME",
  "EDGE_FORWARD_AUTH_RESPONSE_HEADER_EMAIL",
  "EDGE_FORWARD_AUTH_RESPONSE_HEADER_GROUPS",
  "EDGE_FORWARD_AUTH_RESPONSE_HEADER_USER",
  "EDGE_FORWARD_AUTH_TRUST_FORWARD_HEADER",
  "EDGE_LOCAL_CERT_CONFIGMAP_NAME",
  "EDGE_LOCAL_CERT_FILE_PATH",
  "EDGE_LOCAL_DEFAULT_CERT_FILE_PATH",
  "EDGE_LOCAL_DEFAULT_KEY_FILE_PATH",
  "EDGE_LOCAL_KEY_FILE_PATH",
  "EDGE_MIDDLEWARE_NAMESPACE",
  "EDGE_SECURITY_BROWSER_XSS_FILTER",
  "EDGE_SECURITY_CONTENT_TYPE_NOSNIFF",
  "EDGE_SECURITY_FRAME_DENY",
  "EDGE_SECURITY_HEADERS_MIDDLEWARE_NAME",
  "EDGE_SECURITY_PERMISSIONS_POLICY",
  "EDGE_SECURITY_REFERRER_POLICY",
  "EDGE_SECURITY_STS_INCLUDE_SUBDOMAINS",
  "EDGE_SECURITY_STS_PRELOAD",
  "EDGE_SECURITY_STS_SECONDS",
  "EDGE_SECURITY_X_CONTENT_TYPE_OPTIONS",
  "EDGE_SECURITY_X_FRAME_OPTIONS",
];

const OBSERVABILITY_GATUS_PLACEHOLDERS = [
  "GATUS_APP_LABEL",
  "GATUS_CONFIG_CONFIGMAP_NAME",
  "GATUS_DEPLOYMENT_NAME",
  "GATUS_ENDPOINTS_CONFIGMAP_NAME",
  "GATUS_IMAGE",
  "GATUS_LIMIT_MEMORY",
  "GATUS_NAMESPACE",
  "GATUS_NODE_SELECTOR_KEY",
  "GATUS_NODE_SELECTOR_VALUE",
  "GATUS_PVC_NAME",
  "GATUS_REQUEST_CPU",
  "GATUS_REQUEST_MEMORY",
  "GATUS_SERVICE_NAME",
  "GATUS_SERVICE_PORT",
  "GATUS_STORAGE_CLASS",
  "GATUS_STORAGE_SIZE",
  "GATUS_UI_DESCRIPTION",
  "GATUS_UI_HEADER",
  "GATUS_UI_TITLE",
];

const OBSERVABILITY_STACK_ONLY_PLACEHOLDERS = [
  "OBSERVABILITY_ALERTMANAGER_ENABLED",
  "OBSERVABILITY_ALLOY_ALLOWED_ORIGINS",
  "OBSERVABILITY_ALLOY_CHART_NAME",
  "OBSERVABILITY_ALLOY_CHART_VERSION",
  "OBSERVABILITY_ALLOY_NODE_SELECTOR_KEY",
  "OBSERVABILITY_ALLOY_NODE_SELECTOR_VALUE",
  "OBSERVABILITY_ALLOY_OTLP_GRPC_PORT",
  "OBSERVABILITY_ALLOY_OTLP_HTTP_PORT",
  "OBSERVABILITY_ALLOY_RELEASE_NAME",
  "OBSERVABILITY_DCGM_CHART_NAME",
  "OBSERVABILITY_DCGM_CHART_VERSION",
  "OBSERVABILITY_DCGM_HELM_REPOSITORY_NAME",
  "OBSERVABILITY_DCGM_NODE_SELECTOR_KEY",
  "OBSERVABILITY_DCGM_NODE_SELECTOR_VALUE",
  "OBSERVABILITY_DCGM_RELEASE_NAME",
  "OBSERVABILITY_FLUX_ALERT_FOR",
  "OBSERVABILITY_GRAFANA_CHART_NAME",
  "OBSERVABILITY_GRAFANA_CHART_VERSION",
  "OBSERVABILITY_GRAFANA_DATASOURCES_CONFIGMAP_NAME",
  "OBSERVABILITY_GRAFANA_HELM_REPOSITORY_NAME",
  "OBSERVABILITY_GRAFANA_HELM_REPOSITORY_URL",
  "OBSERVABILITY_GRAFANA_NODE_SELECTOR_KEY",
  "OBSERVABILITY_GRAFANA_NODE_SELECTOR_VALUE",
  "OBSERVABILITY_GRAFANA_OIDC_API_URL",
  "OBSERVABILITY_GRAFANA_OIDC_AUTH_URL",
  "OBSERVABILITY_GRAFANA_OIDC_CLIENT_ID",
  "OBSERVABILITY_GRAFANA_OIDC_ENABLED",
  "OBSERVABILITY_GRAFANA_OIDC_NAME",
  "OBSERVABILITY_GRAFANA_OIDC_ROLE_ATTRIBUTE_PATH",
  "OBSERVABILITY_GRAFANA_OIDC_SCOPES",
  "OBSERVABILITY_GRAFANA_OIDC_SECRET_KEY",
  "OBSERVABILITY_GRAFANA_OIDC_SECRET_NAME",
  "OBSERVABILITY_GRAFANA_OIDC_TOKEN_URL",
  "OBSERVABILITY_GRAFANA_OPERATOR_CHART_NAME",
  "OBSERVABILITY_GRAFANA_OPERATOR_CHART_VERSION",
  "OBSERVABILITY_GRAFANA_OPERATOR_RELEASE_NAME",
  "OBSERVABILITY_GRAFANA_RELEASE_NAME",
  "OBSERVABILITY_GRAFANA_ROOT_URL",
  "OBSERVABILITY_GRAFANA_STORAGE_CLASS",
  "OBSERVABILITY_GRAFANA_STORAGE_SIZE",
  "OBSERVABILITY_HELM_REPOSITORY_INTERVAL",
  "OBSERVABILITY_LOGS_NODE_SELECTOR_KEY",
  "OBSERVABILITY_LOGS_NODE_SELECTOR_VALUE",
  "OBSERVABILITY_LOKI_CHART_NAME",
  "OBSERVABILITY_LOKI_CHART_VERSION",
  "OBSERVABILITY_LOKI_PUSH_URL",
  "OBSERVABILITY_LOKI_RELEASE_NAME",
  "OBSERVABILITY_LOKI_SCHEMA_FROM",
  "OBSERVABILITY_LOKI_STORAGE_CLASS",
  "OBSERVABILITY_LOKI_STORAGE_SIZE",
  "OBSERVABILITY_LOKI_URL",
  "OBSERVABILITY_METRICS_CHART_NAME",
  "OBSERVABILITY_METRICS_CHART_VERSION",
  "OBSERVABILITY_METRICS_NODE_SELECTOR_KEY",
  "OBSERVABILITY_METRICS_NODE_SELECTOR_VALUE",
  "OBSERVABILITY_METRICS_RELEASE_NAME",
  "OBSERVABILITY_NAMESPACE",
  "OBSERVABILITY_OPEN_TELEMETRY_HELM_REPOSITORY_NAME",
  "OBSERVABILITY_OPEN_TELEMETRY_HELM_REPOSITORY_URL",
  "OBSERVABILITY_PLATFORM_ALERTS_NAME",
  "OBSERVABILITY_POD_RESTART_ALERT_FOR",
  "OBSERVABILITY_POD_RESTART_RATE_THRESHOLD",
  "OBSERVABILITY_PROMETHEUS_HELM_REPOSITORY_NAME",
  "OBSERVABILITY_PROMETHEUS_HELM_REPOSITORY_URL",
  "OBSERVABILITY_PROMETHEUS_REMOTE_WRITE_RECEIVER",
  "OBSERVABILITY_PROMETHEUS_REMOTE_WRITE_URL",
  "OBSERVABILITY_PROMETHEUS_RETENTION",
  "OBSERVABILITY_PROMETHEUS_STORAGE_CLASS",
  "OBSERVABILITY_PROMETHEUS_STORAGE_SIZE",
  "OBSERVABILITY_PROMETHEUS_URL",
  "OBSERVABILITY_PYROSCOPE_CHART_NAME",
  "OBSERVABILITY_PYROSCOPE_CHART_VERSION",
  "OBSERVABILITY_PYROSCOPE_RELEASE_NAME",
  "OBSERVABILITY_PYROSCOPE_STORAGE_CLASS",
  "OBSERVABILITY_PYROSCOPE_STORAGE_SIZE",
  "OBSERVABILITY_PYROSCOPE_URL",
  "OBSERVABILITY_RELEASE_INTERVAL",
  "OBSERVABILITY_TEMPO_CHART_NAME",
  "OBSERVABILITY_TEMPO_CHART_VERSION",
  "OBSERVABILITY_TEMPO_METRICS_GENERATOR_ENABLED",
  "OBSERVABILITY_TEMPO_OTLP_HTTP_URL",
  "OBSERVABILITY_TEMPO_RELEASE_NAME",
  "OBSERVABILITY_TEMPO_RETENTION",
  "OBSERVABILITY_TEMPO_STORAGE_CLASS",
  "OBSERVABILITY_TEMPO_STORAGE_SIZE",
  "OBSERVABILITY_TEMPO_URL",
  "OBSERVABILITY_TRACES_NODE_SELECTOR_KEY",
  "OBSERVABILITY_TRACES_NODE_SELECTOR_VALUE",
];

const RABBITMQ_DATA_SERVICE_PLACEHOLDERS = [
  "RABBITMQ_ANTI_AFFINITY_TOPOLOGY_KEY",
  "RABBITMQ_ANTI_AFFINITY_WEIGHT",
  "RABBITMQ_APP_LABEL",
  "RABBITMQ_CHART_NAME",
  "RABBITMQ_CHART_VERSION",
  "RABBITMQ_ERLANG_COOKIE_PLACEHOLDER",
  "RABBITMQ_EXTRA_PLUGINS",
  "RABBITMQ_HELM_REPOSITORY_INTERVAL",
  "RABBITMQ_HELM_REPOSITORY_NAME",
  "RABBITMQ_HELM_REPOSITORY_URL",
  "RABBITMQ_INTERNAL_CREDENTIALS_REFRESH_AFTER",
  "RABBITMQ_INTERNAL_CREDENTIALS_SECRET_NAME",
  "RABBITMQ_INTERNAL_CREDENTIALS_STATIC_SECRET_NAME",
  "RABBITMQ_INTERNAL_CREDENTIALS_VAULT_MOUNT",
  "RABBITMQ_INTERNAL_CREDENTIALS_VAULT_PATH",
  "RABBITMQ_INTERNAL_PASSWORD_KEY",
  "RABBITMQ_INTERNAL_USERNAME",
  "RABBITMQ_LIMIT_MEMORY",
  "RABBITMQ_MANAGEMENT_OAUTH_CLIENT_ID",
  "RABBITMQ_MANAGEMENT_OAUTH_DISABLE_BASIC_AUTH",
  "RABBITMQ_MANAGEMENT_OAUTH_SCOPES",
  "RABBITMQ_METRICS_INTERVAL",
  "RABBITMQ_METRICS_SCRAPE_TIMEOUT",
  "RABBITMQ_NAMESPACE",
  "RABBITMQ_NODE_SELECTOR_KEY",
  "RABBITMQ_NODE_SELECTOR_VALUE",
  "RABBITMQ_OAUTH2_ADDITIONAL_SCOPES_KEY",
  "RABBITMQ_OAUTH2_ADMIN_ALIAS_NAME",
  "RABBITMQ_OAUTH2_ADMIN_ALIAS_SCOPES",
  "RABBITMQ_OAUTH2_ISSUER_URL",
  "RABBITMQ_OAUTH2_RESOURCE_SERVER_ID",
  "RABBITMQ_OAUTH2_SCOPE_PREFIX",
  "RABBITMQ_OAUTH2_SERVICE_ALIAS_NAME",
  "RABBITMQ_OAUTH2_SERVICE_ALIAS_SCOPES",
  "RABBITMQ_OAUTH2_USERNAME_CLAIM_1",
  "RABBITMQ_OAUTH2_USERNAME_CLAIM_2",
  "RABBITMQ_PART_OF_LABEL",
  "RABBITMQ_RELEASE_INTERVAL",
  "RABBITMQ_RELEASE_NAME",
  "RABBITMQ_REPLICA_COUNT",
  "RABBITMQ_REQUEST_CPU",
  "RABBITMQ_REQUEST_MEMORY",
  "RABBITMQ_SERVICEMONITOR_NAME",
  "RABBITMQ_SERVICEMONITOR_RELEASE_LABEL",
  "RABBITMQ_STORAGE_CLASS",
  "RABBITMQ_STORAGE_SIZE",
  "RABBITMQ_TOLERATION_EFFECT",
  "RABBITMQ_TOLERATION_KEY",
  "RABBITMQ_TOLERATION_OPERATOR",
  "RABBITMQ_TOLERATION_VALUE",
  "RABBITMQ_VAULT_AUTH_REF",
];

export const FLUX_PACKS = Object.freeze({
  "flux-core-cert-manager": {
    sourcePath: "packs/flux-core/cert-manager",
    placeholders: CORE_CERT_MANAGER_PLACEHOLDERS,
  },
  "flux-core-external-dns-cloudflare": {
    sourcePath: "packs/flux-core/external-dns-cloudflare",
    placeholders: CORE_EXTERNAL_DNS_CLOUDFLARE_PLACEHOLDERS,
  },
  "flux-core-traefik-public": {
    sourcePath: "packs/flux-core/traefik-public",
    placeholders: CORE_TRAEFIK_PUBLIC_PLACEHOLDERS,
  },
  "flux-core-traefik-lan": {
    sourcePath: "packs/flux-core/traefik-lan",
    placeholders: CORE_TRAEFIK_LAN_PLACEHOLDERS,
  },
  "flux-core-metallb": {
    sourcePath: "packs/flux-core/metallb",
    placeholders: CORE_METALLB_PLACEHOLDERS,
  },
  "flux-core-vso": {
    sourcePath: "packs/flux-core/vso",
    placeholders: CORE_VSO_PLACEHOLDERS,
  },
  "edge-pack": {
    sourcePath: "packs/edge",
    placeholders: EDGE_PACK_PLACEHOLDERS,
  },
  "edge-middleware-pack": {
    sourcePath: "packs/edge-middleware",
    placeholders: EDGE_MIDDLEWARE_PLACEHOLDERS,
  },
  "observability-gatus-pack": {
    sourcePath: "packs/observability/gatus",
    placeholders: OBSERVABILITY_GATUS_PLACEHOLDERS,
  },
  "observability-stack-pack": {
    sourcePath: "packs/observability",
    placeholders: [...OBSERVABILITY_GATUS_PLACEHOLDERS, ...OBSERVABILITY_STACK_ONLY_PLACEHOLDERS].sort(),
  },
  "rabbitmq-data-service-pack": {
    sourcePath: "packs/rabbitmq-data-service",
    placeholders: RABBITMQ_DATA_SERVICE_PLACEHOLDERS,
  },
});

export function contextArtifacts(input) {
  if (input?.artifacts) return input.artifacts;
  return { "deploy-config": input };
}

export function platformFromContext(input) {
  return contextArtifacts(input).platform ?? {};
}

export function deployConfigFromContext(input) {
  return contextArtifacts(input)["deploy-config"] ?? input;
}

export function pathAllocatorFromContext(input) {
  return input?.pathAllocator;
}

export function overridesFromContext(input, adapterName) {
  return {
    ...(input?.overrides ?? {}),
    ...(input?.overrides?.[adapterName] ?? {}),
  };
}

export function yamlDocument(document) {
  return YAML.stringify(document, {
    indent: 2,
    lineWidth: 0,
    sortMapEntries: false,
  }).trimEnd();
}

export function yamlDocuments(documents) {
  return documents.map((document) => yamlDocument(document)).join("\n---\n");
}

export function fluxFile(path, content, adapter) {
  return {
    path: safeRelativePath(path),
    content: content.endsWith("\n") ? content.trimEnd() : content,
    adapter,
  };
}

export function appPath(input, group, ...segments) {
  const allocator = pathAllocatorFromContext(input);
  const appsRoot = allocator?.appsRoot ?? posix.join(gitopsRoot(input), "apps");
  return posix.join(appsRoot, group, ...segments);
}

export function clusterPath(input, ...segments) {
  const allocator = pathAllocatorFromContext(input);
  const clusterRoot = allocator?.clusterRoot ?? posix.join(gitopsRoot(input), "clusters", environment(input));
  return posix.join(clusterRoot, ...segments);
}

export function gitopsRoot(input) {
  return platformFromContext(input).gitops?.root
    ?? deployConfigFromContext(input).gitops?.root
    ?? "platform/cluster/flux";
}

export function environment(input) {
  return platformFromContext(input).gitops?.environment
    ?? deployConfigFromContext(input).gitops?.environment
    ?? "production";
}

export function fluxInterval(input) {
  return normalizeDuration(platformFromContext(input).gitops?.interval ?? "10m");
}

export function hasPack(platform, ...names) {
  const flattened = flattenPackEntries(platform.packs ?? {});
  return names.some((name) => flattened.some((entry) => entry.name === name));
}

export function packValue(platform, ...path) {
  let cursor = platform.packs ?? {};
  for (const segment of path) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

export function flattenPackEntries(value, parents = []) {
  if (Array.isArray(value)) {
    return value.map((name) => ({ name, value: true, path: [...parents, name] }));
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([name, child]) => {
    if (Array.isArray(child)) {
      return child.map((entry) => ({ name: entry, value: true, path: [...parents, name, entry] }));
    }
    if (child && typeof child === "object" && Object.keys(child).length > 0) {
      return [
        { name, value: child, path: [...parents, name] },
        ...flattenPackEntries(child, [...parents, name]),
      ];
    }
    return [{ name, value: child, path: [...parents, name] }];
  });
}

export function serviceGroups(artifacts) {
  const config = artifacts["deploy-config"];
  return new Map(Object.entries(config?.service_intent?.kubernetes ?? {}).flatMap(([group, names]) => (
    names.map((name) => [name, group.replaceAll("_", "-")])
  )));
}

export function servicesInGroup(artifacts, group) {
  const config = artifacts["deploy-config"];
  return config?.service_intent?.kubernetes?.[group.replaceAll("-", "_")] ?? [];
}

export function hasServiceGroup(artifacts, group) {
  return servicesInGroup(artifacts, group).length > 0;
}

export function serviceUsesSecrets(artifacts, serviceName) {
  return Object.hasOwn(artifacts["vault-dynamic-secrets"]?.vault?.service_consumers ?? {}, serviceName);
}

export function serviceHasRoute(artifacts, serviceName) {
  const config = artifacts["deploy-config"];
  return Object.hasOwn(config?.ingress_intent?.kubernetes_backends ?? {}, serviceName);
}

export function serviceHasDataDependency(artifacts, serviceName) {
  const service = artifacts["service-intent"]?.services?.[serviceName];
  return (service?.storage?.volumes ?? []).length > 0
    || (service?.secrets ?? []).some((secret) => secret.source === "vault_dynamic_database" || secret.source === "vault_dynamic_rabbitmq");
}

export function blueprintFiles(input, blueprintPath) {
  const registry = input?.blueprintRegistry;
  const registryFiles = blueprintRegistryFiles(registry, blueprintPath);
  if (registryFiles) return registryFiles;

  const root = explicitBlueprintRoot(input);
  if (!root) {
    addBlueprintDiagnostic(input, blueprintPath);
    return [];
  }

  const absolute = posix.join(root, blueprintPath);
  if (!existsSync(absolute)) return [];
  return walk(absolute).map((relativePath) => ({
    relativePath,
    content: readFileSync(posix.join(absolute, relativePath), "utf8"),
  }));
}

function blueprintRegistryFiles(registry, blueprintPath) {
  if (!registry) return undefined;
  if (typeof registry.files === "function") return normalizeBlueprintFiles(registry.files(blueprintPath));
  if (typeof registry.readFiles === "function") return normalizeBlueprintFiles(registry.readFiles(blueprintPath));
  if (registry instanceof Map) return normalizeBlueprintFiles(registry.get(blueprintPath));
  return normalizeBlueprintFiles(registry[blueprintPath] ?? registry.packs?.[blueprintPath]);
}

function normalizeBlueprintFiles(files) {
  if (!files) return undefined;
  const entries = Array.isArray(files)
    ? files
    : Object.entries(files.files ?? files).map(([relativePath, content]) => ({ relativePath, content }));
  return entries.map((file) => ({
    relativePath: safeRelativePath(file.relativePath ?? file.path),
    content: String(file.content),
  })).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function explicitBlueprintRoot(input) {
  const overrides = overridesFromContext(input, "flux");
  return overrides.blueprintRoot ?? overrides.blueprintPath;
}

function addBlueprintDiagnostic(input, blueprintPath) {
  if (!Array.isArray(input?.diagnostics)) return;
  input.diagnostics.push({
    code: "E_BLUEPRINT_REGISTRY_MISSING",
    path: blueprintPath,
    message: `blueprint pack ${blueprintPath} requires blueprintRegistry or overrides.flux.blueprintRoot`,
  });
}

export function substitutePlaceholders(content, substitutions) {
  return content.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name) => {
    if (Object.hasOwn(substitutions, name)) return String(substitutions[name]);
    return placeholderFallback(name);
  });
}

export function substitutionMap(input, extra = {}) {
  const platform = platformFromContext(input);
  const config = deployConfigFromContext(input);
  const domain = platform.domain ?? config?.cluster?.public_domain ?? "example.invalid";
  const cluster = platform.name ?? config?.cluster?.name ?? "cluster";
  const publicIngressHost = `ingress.${domain}`;
  const lanIngress = firstLanIngress(platform) ?? "192.0.2.10-192.0.2.10";
  const publicNodeSelector = firstHostSelector(platform, "public-ingress");
  const lanNodeSelector = firstHostSelector(platform, "lan-ingress") ?? publicNodeSelector;
  const defaultOverrides = overridesFromContext(input, "flux");
  const map = {
    CERT_MANAGER_NAMESPACE: "cert-manager",
    CERT_MANAGER_HELM_REPOSITORY_NAME: "jetstack",
    CERT_MANAGER_HELM_REPOSITORY_INTERVAL: "1h",
    CERT_MANAGER_HELM_REPOSITORY_URL: "https://charts.jetstack.io",
    CERT_MANAGER_RELEASE_NAME: "cert-manager",
    CERT_MANAGER_RELEASE_INTERVAL: "30m",
    CERT_MANAGER_CHART_NAME: "cert-manager",
    CERT_MANAGER_CHART_VERSION: "*",

    EXTERNAL_DNS_NAMESPACE: "external-dns",
    EXTERNAL_DNS_HELM_REPOSITORY_NAME: "external-dns",
    EXTERNAL_DNS_HELM_REPOSITORY_INTERVAL: "1h",
    EXTERNAL_DNS_HELM_REPOSITORY_URL: "https://kubernetes-sigs.github.io/external-dns/",
    EXTERNAL_DNS_RELEASE_NAME: "external-dns",
    EXTERNAL_DNS_RELEASE_INTERVAL: "30m",
    EXTERNAL_DNS_CHART_NAME: "external-dns",
    EXTERNAL_DNS_CHART_VERSION: "*",
    EXTERNAL_DNS_CLOUDFLARE_TOKEN_SECRET_NAME: "cloudflare-api-token",
    EXTERNAL_DNS_CLOUDFLARE_TOKEN_SECRET_KEY: "api-token",
    EXTERNAL_DNS_ANNOTATION_FILTER: "external-dns.alpha.kubernetes.io/hostname",
    EXTERNAL_DNS_DOMAIN_FILTER: domain,
    EXTERNAL_DNS_TXT_OWNER_ID: cluster,
    EXTERNAL_DNS_NODE_SELECTOR_KEY: publicNodeSelector.key,
    EXTERNAL_DNS_NODE_SELECTOR_VALUE: publicNodeSelector.value,

    TRAEFIK_PUBLIC_NAMESPACE: "ingress-system",
    TRAEFIK_PUBLIC_HELM_REPOSITORY_NAME: "traefik",
    TRAEFIK_PUBLIC_HELM_REPOSITORY_INTERVAL: "1h",
    TRAEFIK_PUBLIC_HELM_REPOSITORY_URL: "https://traefik.github.io/charts",
    TRAEFIK_PUBLIC_RELEASE_NAME: "traefik",
    TRAEFIK_PUBLIC_RELEASE_INTERVAL: "30m",
    TRAEFIK_PUBLIC_CHART_NAME: "traefik",
    TRAEFIK_PUBLIC_CHART_VERSION: "*",
    TRAEFIK_PUBLIC_INGRESS_CLASS: "traefik-public",
    TRAEFIK_PUBLIC_SERVICE_TYPE: "LoadBalancer",
    TRAEFIK_PUBLIC_CLOUDFLARE_PROXIED: "true",
    TRAEFIK_PUBLIC_EXTERNAL_DNS_HOSTNAME: publicIngressHost,
    TRAEFIK_PUBLIC_EXTERNAL_TRAFFIC_POLICY: "Local",
    TRAEFIK_PUBLIC_WEB_HOST_PORT: 80,
    TRAEFIK_PUBLIC_WEBSECURE_HOST_PORT: 443,
    TRAEFIK_PUBLIC_METRICS_PORT: 9100,
    TRAEFIK_PUBLIC_OTLP_ENABLED: "false",
    TRAEFIK_PUBLIC_OTLP_ENDPOINT: "http://alloy.observability.svc.cluster.local:4318/v1/traces",
    TRAEFIK_PUBLIC_TRACE_SAMPLE_RATE: 1,
    TRAEFIK_PUBLIC_NODE_SELECTOR_KEY: publicNodeSelector.key,
    TRAEFIK_PUBLIC_NODE_SELECTOR_VALUE: publicNodeSelector.value,

    TRAEFIK_LAN_NAMESPACE: "lan-ingress-system",
    TRAEFIK_LAN_HELM_REPOSITORY_NAME: "traefik",
    TRAEFIK_LAN_HELM_REPOSITORY_INTERVAL: "1h",
    TRAEFIK_LAN_HELM_REPOSITORY_URL: "https://traefik.github.io/charts",
    TRAEFIK_LAN_RELEASE_NAME: "traefik-lan",
    TRAEFIK_LAN_RELEASE_INTERVAL: "30m",
    TRAEFIK_LAN_CHART_NAME: "traefik",
    TRAEFIK_LAN_CHART_VERSION: "*",
    TRAEFIK_LAN_INGRESS_CLASS: "traefik-lan",
    TRAEFIK_LAN_METALLB_ADDRESS_POOL: "lan-ingress",
    TRAEFIK_LAN_WEB_PORT: 80,
    TRAEFIK_LAN_WEBSECURE_PORT: 443,
    TRAEFIK_LAN_NODE_SELECTOR_KEY: lanNodeSelector.key,
    TRAEFIK_LAN_NODE_SELECTOR_VALUE: lanNodeSelector.value,

    METALLB_NAMESPACE: "metallb-system",
    METALLB_HELM_REPOSITORY_NAME: "metallb",
    METALLB_HELM_REPOSITORY_INTERVAL: "1h",
    METALLB_HELM_REPOSITORY_URL: "https://metallb.github.io/metallb",
    METALLB_RELEASE_NAME: "metallb",
    METALLB_RELEASE_INTERVAL: "30m",
    METALLB_CHART_NAME: "metallb",
    METALLB_CHART_VERSION: "*",
    METALLB_ADDRESS_POOL_NAME: "lan-ingress",
    METALLB_ADDRESS_RANGE: lanIngress,
    METALLB_L2_ADVERTISEMENT_NAME: "lan-ingress",

    VSO_NAMESPACE: "vault-secrets-operator",
    VSO_HELM_REPOSITORY_NAME: "hashicorp",
    VSO_HELM_REPOSITORY_INTERVAL: "1h",
    VSO_HELM_REPOSITORY_URL: "https://helm.releases.hashicorp.com",
    VSO_RELEASE_NAME: "vault-secrets-operator",
    VSO_RELEASE_INTERVAL: "30m",
    VSO_CHART_NAME: "vault-secrets-operator",
    VSO_CHART_VERSION: "*",
    VSO_DEFAULT_VAULT_ADDRESS: "http://vault.data-system.svc.cluster.local:8200",
    VSO_KUBERNETES_AUTH_MOUNT: "kubernetes",
    VSO_KUBERNETES_AUTH_ROLE: "vso",
    VSO_SERVICE_ACCOUNT_NAME: "vso",
    VSO_TOKEN_AUDIENCE: "vault",

    EDGE_NAMESPACE: "edge-system",
    EDGE_MIDDLEWARE_NAMESPACE: "edge-system",
    EDGE_CLOUDFLARE_CLUSTER_ISSUER_NAME: "cloudflare",
    EDGE_ACME_EMAIL: `admin@${domain}`,
    EDGE_ACME_SERVER: "https://acme-v02.api.letsencrypt.org/directory",
    EDGE_ACME_PRIVATE_KEY_SECRET_NAME: "cloudflare-acme-account-key",
    EDGE_CLOUDFLARE_TOKEN_SECRET_NAME: "cloudflare-api-token",
    EDGE_CLOUDFLARE_TOKEN_SECRET_KEY: "api-token",
    EDGE_DEFAULT_TLS_STORE_NAME: "default",
    EDGE_DEFAULT_TLS_SECRET_NAME: "wildcard-tls",
    EDGE_FORWARD_AUTH_MIDDLEWARE_NAME: "forward-auth",
    EDGE_FORWARD_AUTH_ADDRESS: "http://forward-auth.edge-system.svc.cluster.local:4181",
    EDGE_FORWARD_AUTH_TRUST_FORWARD_HEADER: true,
    EDGE_FORWARD_AUTH_RESPONSE_HEADER_1: "X-Forwarded-User",
    EDGE_FORWARD_AUTH_RESPONSE_HEADER_2: "X-Forwarded-Email",
    EDGE_FORWARD_AUTH_RESPONSE_HEADER_USER: "X-Forwarded-User",
    EDGE_FORWARD_AUTH_RESPONSE_HEADER_EMAIL: "X-Forwarded-Email",
    EDGE_FORWARD_AUTH_RESPONSE_HEADER_GROUPS: "X-Forwarded-Groups",
    EDGE_SECURITY_HEADERS_MIDDLEWARE_NAME: "security-headers",
    EDGE_CSP_STRICT_MIDDLEWARE_NAME: "csp-strict",
    EDGE_CSP_ADMIN_MIDDLEWARE_NAME: "csp-admin",
    EDGE_CSP_WORKFLOW_MIDDLEWARE_NAME: "csp-workflow",
    EDGE_CSP_STRICT_POLICY: "default-src 'self'",
    EDGE_CSP_ADMIN_POLICY: "default-src 'self'; style-src 'self' 'unsafe-inline'",
    EDGE_CSP_WORKFLOW_POLICY: "default-src 'self'; connect-src 'self' https:",
    EDGE_DASHBOARD_CHAIN_MIDDLEWARE_NAME: "traefik-dashboard-chain",
    EDGE_DASHBOARD_INGRESSROUTE_NAME: "traefik-dashboard",
    EDGE_DASHBOARD_ENTRYPOINT: "websecure",
    EDGE_DASHBOARD_HOSTNAME: `traefik.${domain}`,
    EDGE_DASHBOARD_TLS_SECRET_NAME: "wildcard-tls",
    EDGE_LOCAL_CERT_CONFIGMAP_NAME: "traefik-local-cert-provider",
    EDGE_LOCAL_CERT_FILE_PATH: "/certs/tls.crt",
    EDGE_LOCAL_KEY_FILE_PATH: "/certs/tls.key",
    EDGE_LOCAL_DEFAULT_CERT_FILE_PATH: "/certs/tls.crt",
    EDGE_LOCAL_DEFAULT_KEY_FILE_PATH: "/certs/tls.key",
    EDGE_SECURITY_BROWSER_XSS_FILTER: true,
    EDGE_SECURITY_CONTENT_TYPE_NOSNIFF: true,
    EDGE_SECURITY_FRAME_DENY: true,
    EDGE_SECURITY_REFERRER_POLICY: "strict-origin-when-cross-origin",
    EDGE_SECURITY_PERMISSIONS_POLICY: "camera=(), microphone=(), geolocation=()",
    EDGE_SECURITY_STS_SECONDS: 31536000,
    EDGE_SECURITY_STS_INCLUDE_SUBDOMAINS: true,
    EDGE_SECURITY_STS_PRELOAD: true,
    EDGE_SECURITY_X_FRAME_OPTIONS: "DENY",
    EDGE_SECURITY_X_CONTENT_TYPE_OPTIONS: "nosniff",

    GATUS_NAMESPACE: gatusNamespace(platform),
    GATUS_CONFIG_CONFIGMAP_NAME: "gatus-config",
    GATUS_ENDPOINTS_CONFIGMAP_NAME: "gatus-endpoints",
    GATUS_DEPLOYMENT_NAME: "gatus",
    GATUS_APP_LABEL: "gatus",
    GATUS_PVC_NAME: "gatus-data",
    GATUS_STORAGE_CLASS: "local-path",
    GATUS_STORAGE_SIZE: "1Gi",
    GATUS_SERVICE_NAME: "gatus",
    GATUS_SERVICE_PORT: 8080,
    GATUS_UI_TITLE: `${cluster} status`,
    GATUS_UI_DESCRIPTION: `${cluster} service health`,
    GATUS_UI_HEADER: `${cluster} status`,
    GATUS_IMAGE: "twinproduction/gatus:v5.20.0",
    GATUS_REQUEST_CPU: "50m",
    GATUS_REQUEST_MEMORY: "64Mi",
    GATUS_LIMIT_MEMORY: "256Mi",
    GATUS_NODE_SELECTOR_KEY: publicNodeSelector.key,
    GATUS_NODE_SELECTOR_VALUE: publicNodeSelector.value,

    RABBITMQ_NAMESPACE: "data-system",
    RABBITMQ_HELM_REPOSITORY_NAME: "bitnami",
    RABBITMQ_HELM_REPOSITORY_INTERVAL: "1h",
    RABBITMQ_HELM_REPOSITORY_URL: "https://charts.bitnami.com/bitnami",
    RABBITMQ_RELEASE_NAME: "rabbitmq",
    RABBITMQ_RELEASE_INTERVAL: "30m",
    RABBITMQ_CHART_NAME: "rabbitmq",
    RABBITMQ_CHART_VERSION: "*",
    RABBITMQ_REPLICA_COUNT: 1,
    RABBITMQ_INTERNAL_USERNAME: "rabbitmq",
    RABBITMQ_INTERNAL_CREDENTIALS_STATIC_SECRET_NAME: "rabbitmq-internal-credentials",
    RABBITMQ_INTERNAL_CREDENTIALS_SECRET_NAME: "rabbitmq-internal-credentials",
    RABBITMQ_INTERNAL_CREDENTIALS_VAULT_MOUNT: "secret",
    RABBITMQ_INTERNAL_CREDENTIALS_VAULT_PATH: `${cluster}/rabbitmq/internal`,
    RABBITMQ_INTERNAL_CREDENTIALS_REFRESH_AFTER: "1h",
    RABBITMQ_INTERNAL_PASSWORD_KEY: "password",
    RABBITMQ_ERLANG_COOKIE_PLACEHOLDER: "change-me-in-vault",
    RABBITMQ_EXTRA_PLUGINS: "rabbitmq_management rabbitmq_prometheus",
    RABBITMQ_OAUTH2_RESOURCE_SERVER_ID: "rabbitmq",
    RABBITMQ_OAUTH2_ISSUER_URL: `https://auth.${domain}`,
    RABBITMQ_OAUTH2_SCOPE_PREFIX: "rabbitmq.",
    RABBITMQ_OAUTH2_ADDITIONAL_SCOPES_KEY: "roles",
    RABBITMQ_OAUTH2_USERNAME_CLAIM_1: "preferred_username",
    RABBITMQ_OAUTH2_USERNAME_CLAIM_2: "sub",
    RABBITMQ_OAUTH2_ADMIN_ALIAS_NAME: "admin",
    RABBITMQ_OAUTH2_ADMIN_ALIAS_SCOPES: "rabbitmq.admin",
    RABBITMQ_OAUTH2_SERVICE_ALIAS_NAME: "service",
    RABBITMQ_OAUTH2_SERVICE_ALIAS_SCOPES: "rabbitmq.service",
    RABBITMQ_MANAGEMENT_OAUTH_DISABLE_BASIC_AUTH: false,
    RABBITMQ_MANAGEMENT_OAUTH_CLIENT_ID: "rabbitmq",
    RABBITMQ_MANAGEMENT_OAUTH_SCOPES: "openid profile",
    RABBITMQ_STORAGE_CLASS: "local-path",
    RABBITMQ_STORAGE_SIZE: "8Gi",
    RABBITMQ_REQUEST_CPU: "100m",
    RABBITMQ_REQUEST_MEMORY: "256Mi",
    RABBITMQ_LIMIT_MEMORY: "1Gi",
    RABBITMQ_PART_OF_LABEL: "data",
    RABBITMQ_NODE_SELECTOR_KEY: publicNodeSelector.key,
    RABBITMQ_NODE_SELECTOR_VALUE: publicNodeSelector.value,
    RABBITMQ_TOLERATION_KEY: "node-role.kubernetes.io/control-plane",
    RABBITMQ_TOLERATION_OPERATOR: "Exists",
    RABBITMQ_TOLERATION_VALUE: "",
    RABBITMQ_TOLERATION_EFFECT: "NoSchedule",
    RABBITMQ_ANTI_AFFINITY_WEIGHT: 50,
    RABBITMQ_ANTI_AFFINITY_TOPOLOGY_KEY: "kubernetes.io/hostname",
    RABBITMQ_SERVICEMONITOR_NAME: "rabbitmq",
    RABBITMQ_SERVICEMONITOR_RELEASE_LABEL: "metrics-stack",
    RABBITMQ_APP_LABEL: "rabbitmq",
    RABBITMQ_METRICS_INTERVAL: "30s",
    RABBITMQ_METRICS_SCRAPE_TIMEOUT: "10s",
    RABBITMQ_VAULT_AUTH_REF: "default",

    OBSERVABILITY_NAMESPACE: "observability",
    OBSERVABILITY_HELM_REPOSITORY_INTERVAL: "1h",
    OBSERVABILITY_RELEASE_INTERVAL: "30m",
    OBSERVABILITY_PROMETHEUS_HELM_REPOSITORY_NAME: "prometheus-community",
    OBSERVABILITY_PROMETHEUS_HELM_REPOSITORY_URL: "https://prometheus-community.github.io/helm-charts",
    OBSERVABILITY_GRAFANA_HELM_REPOSITORY_NAME: "grafana",
    OBSERVABILITY_GRAFANA_HELM_REPOSITORY_URL: "https://grafana.github.io/helm-charts",
    OBSERVABILITY_OPEN_TELEMETRY_HELM_REPOSITORY_NAME: "open-telemetry",
    OBSERVABILITY_OPEN_TELEMETRY_HELM_REPOSITORY_URL: "https://open-telemetry.github.io/opentelemetry-helm-charts",
    OBSERVABILITY_ALLOY_RELEASE_NAME: "alloy",
    OBSERVABILITY_ALLOY_CHART_NAME: "alloy",
    OBSERVABILITY_ALLOY_CHART_VERSION: "*",
    OBSERVABILITY_ALLOY_OTLP_GRPC_PORT: 4317,
    OBSERVABILITY_ALLOY_OTLP_HTTP_PORT: 4318,
    OBSERVABILITY_ALLOY_ALLOWED_ORIGINS: `"https://*.${domain}"`,
    OBSERVABILITY_TEMPO_OTLP_HTTP_URL: "http://tempo:4318",
    OBSERVABILITY_PROMETHEUS_REMOTE_WRITE_URL: "http://metrics-stack-kube-prom-prometheus:9090/api/v1/write",
    OBSERVABILITY_LOKI_PUSH_URL: "http://loki:3100/loki/api/v1/push",
    OBSERVABILITY_ALLOY_NODE_SELECTOR_KEY: publicNodeSelector.key,
    OBSERVABILITY_ALLOY_NODE_SELECTOR_VALUE: publicNodeSelector.value,
    OBSERVABILITY_GRAFANA_RELEASE_NAME: "grafana",
    OBSERVABILITY_GRAFANA_CHART_NAME: "grafana",
    OBSERVABILITY_GRAFANA_CHART_VERSION: "*",
    OBSERVABILITY_GRAFANA_STORAGE_CLASS: "local-path",
    OBSERVABILITY_GRAFANA_STORAGE_SIZE: "5Gi",
    OBSERVABILITY_GRAFANA_ROOT_URL: `https://grafana.${domain}`,
    OBSERVABILITY_GRAFANA_OIDC_ENABLED: "false",
    OBSERVABILITY_GRAFANA_OIDC_NAME: "OIDC",
    OBSERVABILITY_GRAFANA_OIDC_AUTH_URL: `https://auth.${domain}/oauth2/authorize`,
    OBSERVABILITY_GRAFANA_OIDC_TOKEN_URL: `https://auth.${domain}/oauth2/token`,
    OBSERVABILITY_GRAFANA_OIDC_API_URL: `https://auth.${domain}/oauth2/userinfo`,
    OBSERVABILITY_GRAFANA_OIDC_CLIENT_ID: "grafana",
    OBSERVABILITY_GRAFANA_OIDC_SCOPES: "openid profile email",
    OBSERVABILITY_GRAFANA_OIDC_ROLE_ATTRIBUTE_PATH: "contains(groups[*], 'admin') && 'Admin' || 'Viewer'",
    OBSERVABILITY_GRAFANA_OIDC_SECRET_NAME: "grafana-oidc",
    OBSERVABILITY_GRAFANA_OIDC_SECRET_KEY: "client-secret",
    OBSERVABILITY_GRAFANA_NODE_SELECTOR_KEY: publicNodeSelector.key,
    OBSERVABILITY_GRAFANA_NODE_SELECTOR_VALUE: publicNodeSelector.value,
    OBSERVABILITY_GRAFANA_OPERATOR_RELEASE_NAME: "grafana-operator",
    OBSERVABILITY_GRAFANA_OPERATOR_CHART_NAME: "grafana-operator",
    OBSERVABILITY_GRAFANA_OPERATOR_CHART_VERSION: "*",
    OBSERVABILITY_LOKI_RELEASE_NAME: "loki",
    OBSERVABILITY_LOKI_CHART_NAME: "loki",
    OBSERVABILITY_LOKI_CHART_VERSION: "*",
    OBSERVABILITY_LOKI_SCHEMA_FROM: "2024-01-01",
    OBSERVABILITY_LOKI_STORAGE_CLASS: "local-path",
    OBSERVABILITY_LOKI_STORAGE_SIZE: "10Gi",
    OBSERVABILITY_LOGS_NODE_SELECTOR_KEY: publicNodeSelector.key,
    OBSERVABILITY_LOGS_NODE_SELECTOR_VALUE: publicNodeSelector.value,
    OBSERVABILITY_METRICS_RELEASE_NAME: "metrics-stack",
    OBSERVABILITY_METRICS_CHART_NAME: "kube-prometheus-stack",
    OBSERVABILITY_METRICS_CHART_VERSION: "*",
    OBSERVABILITY_PROMETHEUS_REMOTE_WRITE_RECEIVER: true,
    OBSERVABILITY_PROMETHEUS_RETENTION: "7d",
    OBSERVABILITY_PROMETHEUS_STORAGE_CLASS: "local-path",
    OBSERVABILITY_PROMETHEUS_STORAGE_SIZE: "10Gi",
    OBSERVABILITY_METRICS_NODE_SELECTOR_KEY: publicNodeSelector.key,
    OBSERVABILITY_METRICS_NODE_SELECTOR_VALUE: publicNodeSelector.value,
    OBSERVABILITY_ALERTMANAGER_ENABLED: false,
    OBSERVABILITY_TEMPO_RELEASE_NAME: "tempo",
    OBSERVABILITY_TEMPO_CHART_NAME: "tempo",
    OBSERVABILITY_TEMPO_CHART_VERSION: "*",
    OBSERVABILITY_TEMPO_RETENTION: "24h",
    OBSERVABILITY_TEMPO_METRICS_GENERATOR_ENABLED: true,
    OBSERVABILITY_TEMPO_STORAGE_CLASS: "local-path",
    OBSERVABILITY_TEMPO_STORAGE_SIZE: "5Gi",
    OBSERVABILITY_TRACES_NODE_SELECTOR_KEY: publicNodeSelector.key,
    OBSERVABILITY_TRACES_NODE_SELECTOR_VALUE: publicNodeSelector.value,
    OBSERVABILITY_PYROSCOPE_RELEASE_NAME: "pyroscope",
    OBSERVABILITY_PYROSCOPE_CHART_NAME: "pyroscope",
    OBSERVABILITY_PYROSCOPE_CHART_VERSION: "*",
    OBSERVABILITY_PYROSCOPE_STORAGE_CLASS: "local-path",
    OBSERVABILITY_PYROSCOPE_STORAGE_SIZE: "5Gi",
    OBSERVABILITY_DCGM_RELEASE_NAME: "nvidia-dcgm-exporter",
    OBSERVABILITY_DCGM_CHART_NAME: "dcgm-exporter",
    OBSERVABILITY_DCGM_CHART_VERSION: "*",
    OBSERVABILITY_DCGM_HELM_REPOSITORY_NAME: "nvidia",
    OBSERVABILITY_DCGM_NODE_SELECTOR_KEY: "kubernetes.io/arch",
    OBSERVABILITY_DCGM_NODE_SELECTOR_VALUE: "amd64",
    OBSERVABILITY_FLUX_ALERT_FOR: "10m",
    OBSERVABILITY_GRAFANA_DATASOURCES_CONFIGMAP_NAME: "grafana-datasources",
    OBSERVABILITY_LOKI_URL: "http://loki:3100",
    OBSERVABILITY_PLATFORM_ALERTS_NAME: "platform-alerts",
    OBSERVABILITY_POD_RESTART_ALERT_FOR: "10m",
    OBSERVABILITY_POD_RESTART_RATE_THRESHOLD: 3,
    OBSERVABILITY_PROMETHEUS_URL: "http://metrics-stack-kube-prom-prometheus:9090",
    OBSERVABILITY_PYROSCOPE_URL: "http://pyroscope:4040",
    OBSERVABILITY_TEMPO_URL: "http://tempo:3200",
    ...defaultOverrides.substitutions,
    ...extra,
  };

  return Object.fromEntries(Object.entries(map).sort(([left], [right]) => left.localeCompare(right)));
}

export function componentName(platform, packName) {
  const overrides = platform.packs?.components ?? {};
  if (overrides[packName]) return overrides[packName];
  if (packName === "traefik-public") return hasPack(platform, "traefik-lan") ? "ingress-controller" : "traefik";
  if (packName === "traefik-lan") return "lan-ingress-controller";
  if (packName === "external-dns") return "external-dns";
  return packName;
}

export function groupKustomization(resources) {
  return yamlDocument({
    apiVersion: "kustomize.config.k8s.io/v1beta1",
    kind: "Kustomization",
    resources: [...new Set(resources)].sort(),
  });
}

export function normalizeDuration(value) {
  if (typeof value !== "string") return "10m0s";
  if (/^[0-9]+m$/.test(value)) return `${value}0s`;
  return value;
}

function walk(root, prefix = "") {
  return readdirSync(posix.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = posix.join(prefix, entry.name);
    if (entry.isDirectory()) return walk(root, relativePath);
    if (!entry.isFile() || entry.name === "README.md" || entry.name.endsWith(".md")) return [];
    return [relativePath];
  }).sort();
}

function placeholderFallback(name) {
  if (name.endsWith("_ENABLED") || name.endsWith("_DISABLE_BASIC_AUTH") || name.startsWith("EDGE_SECURITY_") || name.endsWith("_TRUST_FORWARD_HEADER")) return "false";
  if (name.endsWith("_PORT") || name.endsWith("_SECONDS") || name.endsWith("_COUNT") || name.endsWith("_WEIGHT")) return "0";
  if (name.endsWith("_SAMPLE_RATE")) return "1";
  return name.toLowerCase().replaceAll("_", "-");
}

function firstLanIngress(platform) {
  const ingress = Object.values(platform.sites ?? {}).map((site) => site.lanIngress).find(Boolean);
  if (!ingress) return undefined;
  return ingress.includes("-") ? ingress : `${ingress}-${ingress}`;
}

function firstHostSelector(platform, capability) {
  const entry = Object.entries(platform.hosts ?? {}).find(([, host]) => (host.capabilities ?? []).includes(capability));
  if (entry) return { key: `${platform.name}/site`, value: entry[1].site ?? "default" };
  const first = Object.values(platform.hosts ?? {})[0];
  return { key: `${platform.name ?? "cluster"}/site`, value: first?.site ?? "default" };
}

function gatusNamespace(platform) {
  if (packValue(platform, "observability", "gatus") !== undefined) return "observability";
  return "utility-system";
}
