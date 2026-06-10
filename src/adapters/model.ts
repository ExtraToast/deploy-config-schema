import YAML from "yaml";

export type ExposureClass = "public" | "public_and_lan" | "internal_only" | "lan_only";
export type AccessClass = "sso_protected" | "cluster_internal" | "direct";
export type AdapterFile = {
  path: string;
  content: string;
  adapter: string;
  executable?: boolean;
};
export type RenderResult = string | AdapterFile[];
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export type RouteRule = {
  name: string;
  service: string;
  host_label?: string;
  access?: AccessClass;
  path_prefixes?: string[];
  exact_paths?: string[];
  excluded_path_prefixes?: string[];
  excluded_exact_paths?: string[];
};

export type ResolvedRouteRule = RouteRule & {
  access: AccessClass;
  host: string;
};

export type KubernetesBackend = {
  service: string;
  namespace: string;
  port: number;
  health?: HealthProbe;
  extra_probes?: ExtraProbe[];
};

export type HealthProbe = {
  type?: "http" | "tcp";
  path?: string;
  port?: number;
  expected_status?: number;
  response_time_ms?: number;
  probe_strategy?: "internal" | "external" | "both";
};

export type ExtraProbe = HealthProbe & {
  name: string;
  group?: string;
};

export type DeployConfig = {
  cluster: {
    name: string;
    public_domain: string;
    kubernetes?: {
      api_server_endpoint?: string;
      worker_join_token_file?: string;
    };
  };
  sites: Record<string, { purpose: string; networking?: { wan_public_ip?: string } }>;
  service_intent: { kubernetes: Record<string, string[]> };
  exposure_intent: Record<ExposureClass, string[]>;
  access_intent: {
    sso_protected: string[];
    host_labels: Record<string, string>;
    root_redirect: Record<string, string>;
  };
  ingress_intent: {
    defaults: {
      namespace: string;
      public_ingress_class: string;
      lan_ingress_class: string;
      entrypoint: string;
      tls?: boolean;
      public_dns_target?: string;
      sso_middleware?: string;
    };
    route_rules: RouteRule[];
    kubernetes_backends: Record<string, KubernetesBackend>;
    wan_origin_overrides: Record<string, "home_direct" | "edge_direct" | string>;
  };
  monitoring_intent: { kubernetes_backends: Record<string, KubernetesBackend> };
  image_metadata: {
    workloads: Record<string, {
      repository: string;
      tag: string;
      pull_policy?: string;
      source?: string;
      update: {
        eligible: boolean;
        strategy: string;
        keel?: Record<string, JsonValue>;
      };
    }>;
  };
  adapter_output_intent: {
    adapters?: string[];
    namespaces?: Record<string, string>;
    configmap_names?: Record<string, string>;
  };
  gitops?: { root?: string; environment?: string };
};

export type PlatformConfig = {
  name?: string;
  domain?: string;
  gitops?: { root?: string; environment?: string; interval?: string; layers?: unknown };
  packs?: Record<string, unknown> | string[];
  sites?: Record<string, { networking?: { lan_ingress_ip?: string; wan_public_ip?: string } }>;
  nodes?: Record<string, { labels?: Record<string, string> }>;
};

export type AdapterArtifacts = {
  "deploy-config"?: DeployConfig;
  platform?: PlatformConfig;
  "service-intent"?: ServiceIntentArtifact;
  "fleet-inventory"?: FleetInventoryArtifact;
  "vault-dynamic-secrets"?: VaultDynamicSecretsArtifact;
};

export type AdapterContext = DeployConfig | {
  artifacts?: AdapterArtifacts;
  pathAllocator?: { appsRoot?: string; clusterRoot?: string };
  blueprintRegistry?: BlueprintRegistry;
  overrides?: Record<string, unknown>;
  diagnostics?: Array<{ code: string; path: string; message: string }>;
};

export type BlueprintFile = { relativePath: string; content: string };
export type BlueprintRegistry = {
  files?: (blueprintPath: string) => unknown;
  readFiles?: (blueprintPath: string) => unknown;
  roleModuleNameForRole?: (role: string | symbol) => string | undefined;
  moduleNameForRole?: (role: string | symbol) => string | undefined;
  roleModuleNames?: Record<string, string>;
  nixosHostRoles?: { roleModuleNames?: Record<string, string> } | Record<string, string>;
  nixos?: { roleModuleNames?: Record<string, string> };
  packs?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ServiceIntentArtifact = {
  renderer?: { cluster_name?: string };
  services?: Record<string, ServiceProfile>;
};

export type ServiceProfile = {
  workload?: {
    kind?: string;
    replicas?: number;
    schedule?: string;
    restart_policy?: string;
    strategy?: string;
    render_status?: string;
  };
  image: {
    repository: string;
    tag: string;
    pull_policy?: string;
    pull_secrets?: string[];
  };
  ports?: Array<{ name: string; container_port: number; service_port?: number; protocol?: string }>;
  runtime?: {
    args?: string[];
    env?: Record<string, string>;
    files?: Record<string, string>;
    env_from?: Array<{ name: string; optional?: boolean }>;
    sidecars?: ContainerLike[];
    init_containers?: ContainerLike[];
  };
  secrets?: Array<{ name: string; source?: string; ref?: string; env_keys?: string[]; [key: string]: unknown }>;
  storage?: {
    volumes?: StorageVolume[];
    mounts?: Array<{ volume: string; path: string; read_only?: boolean }>;
  };
  networking?: {
    service_annotations?: Record<string, string>;
    routes?: Array<{ name: string; port?: string }>;
  };
  gatus?: { endpoints?: Array<{ name: string; type?: string; port?: string; path?: string }> };
  observability?: { metrics?: Array<{ kind: "ServiceMonitor" | "PodMonitor"; port: string; path?: string; interval?: string }> };
  scheduling?: {
    node_affinity?: string;
    site_affinity?: string;
    required_capabilities?: string[];
    topology_spread?: string[];
  };
  rollout?: {
    update_strategy?: string;
    availability?: { pdb_min_available?: number | string; max_unavailable?: number | string };
    autoscaling?: {
      enabled?: boolean;
      target_cpu_utilization?: number;
      target_memory_utilization?: number;
      min_replicas?: number;
      max_replicas?: number;
    };
  };
  kubernetes?: {
    render_status?: string;
    namespace_ref?: string;
    service_ref?: string;
    service_account_ref?: string;
    pod_spec?: JsonObject;
    raw_manifests?: JsonObject[];
  };
};

export type ContainerLike = {
  name: string;
  image: { repository: string; tag: string; pull_policy?: string };
  args?: string[];
  env?: Record<string, string>;
};

export type StorageVolume = {
  name: string;
  kind?: string;
  size?: string;
  access_modes?: string[];
  claim_template?: boolean;
  path?: string;
  storage_class?: string;
  portable?: boolean;
};

export type FleetInventoryArtifact = {
  fleet?: {
    cluster: { name: string; domain: string };
    nodes?: Record<string, {
      site: string;
      arch?: string;
      roles?: string[];
      capabilities?: string[];
      addresses?: { ssh?: string; management?: string };
    }>;
  };
};

export type VaultDynamicSecretsArtifact = {
  vault?: {
    auth: { kubernetes: { mount: string } };
    kv: { mount: string; paths: Record<string, { path: string }> };
    vso: {
      auth_role: string;
      static_syncs?: Record<string, VaultStaticSync>;
      dynamic_syncs?: Record<string, VaultDynamicSync>;
    };
    service_consumers?: Record<string, unknown>;
  };
};

export type VaultSyncTarget = { name: string; namespace: string };
export type RolloutRestartTarget = { kind: string; name: string; namespace?: string };
export type VaultStaticSync = {
  kv_path_ref: string;
  target: VaultSyncTarget;
  rollout_restart_targets?: RolloutRestartTarget[];
};
export type VaultDynamicSync = {
  engine: string;
  role: string;
  target: VaultSyncTarget;
  rollout_restart_targets?: RolloutRestartTarget[];
};

export function exposureByService(config: DeployConfig): Map<string, ExposureClass> {
  const exposures = new Map<string, ExposureClass>();
  for (const exposureClass of ["public", "public_and_lan", "internal_only", "lan_only"] as const) {
    for (const serviceName of config.exposure_intent[exposureClass]) {
      exposures.set(serviceName, exposureClass);
    }
  }
  return exposures;
}

export function groupByService(config: DeployConfig): Map<string, string> {
  const groups = new Map<string, string>();
  for (const [groupName, serviceNames] of Object.entries(config.service_intent.kubernetes)) {
    for (const serviceName of serviceNames) {
      groups.set(serviceName, groupName.replaceAll("_", "-"));
    }
  }
  return groups;
}

export function serviceNamesWithIntent(config: DeployConfig): string[] {
  return [...exposureByService(config).keys()].sort();
}

export function accessForService(config: DeployConfig, serviceName: string): AccessClass {
  const exposure = exposureByService(config).get(serviceName);
  if (config.access_intent.sso_protected.includes(serviceName)) {
    return "sso_protected";
  }
  if (exposure === "internal_only") {
    return "cluster_internal";
  }
  return "direct";
}

export function resolveRouteAccess(config: DeployConfig, route: RouteRule): AccessClass {
  return route.access ?? accessForService(config, route.service);
}

export function routeRules(config: DeployConfig): ResolvedRouteRule[] {
  const rules = config.ingress_intent.route_rules.length > 0
    ? config.ingress_intent.route_rules
    : Object.keys(config.access_intent.host_labels)
      .sort()
      .map((service): RouteRule => ({ name: service, service }));

  return rules.map((route) => ({
    ...route,
    access: resolveRouteAccess(config, route),
    host: fqdn(route.host_label ?? config.access_intent.host_labels[route.service], config.cluster.public_domain),
  }));
}

export function fqdn(hostLabel: string, publicDomain: string): string {
  return hostLabel === "root" ? publicDomain : `${hostLabel}.${publicDomain}`;
}

export function renderConfigMap({ name, namespace, dataKey, document }: {
  name: string;
  namespace: string;
  dataKey: string;
  document: unknown;
}): string {
  const body = YAML.stringify(document, {
    indent: 2,
    lineWidth: 0,
    sortMapEntries: false,
    // Match the upstream renderer's embedded-document style for byte parity:
    // a leading `---` document marker, double-quoted string scalars, plain
    // keys, and block sequences whose `-` is not extra-indented.
    directives: true,
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
    indentSeq: false,
  }).trimEnd();

  return [
    "apiVersion: v1",
    "kind: ConfigMap",
    "metadata:",
    `  name: ${name}`,
    `  namespace: ${namespace}`,
    "data:",
    `  ${dataKey}: |`,
    ...body.split("\n").map((line) => `    ${line}`),
  ].join("\n");
}

export function adapterNamespace(config: DeployConfig, adapter: string, fallback: string): string {
  return config.adapter_output_intent.namespaces?.[adapter] ?? fallback;
}

export function adapterConfigMapName(config: DeployConfig, adapter: string, fallback: string): string {
  return config.adapter_output_intent.configmap_names?.[adapter] ?? fallback;
}
