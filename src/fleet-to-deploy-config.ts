type StringMap<T = unknown> = Record<string, T>;

type FleetRouteRule = {
  name?: string;
  service: string;
  access?: string;
  path_prefixes?: string[];
  exact_paths?: string[];
  excluded_path_prefixes?: string[];
  excluded_exact_paths?: string[];
  excluded_paths?: string[];
};

type EdgeService = {
  name: string;
  service: string;
  exposure: string;
  access: string;
  host?: string;
};

type DeployRouteRule = {
  name: string;
  service: string;
  access: string;
  path_prefixes?: string[];
  exact_paths?: string[];
  excluded_path_prefixes?: string[];
  excluded_exact_paths?: string[];
};

export type FleetInventoryInput = {
  version?: unknown;
  cluster?: StringMap;
  sites?: StringMap;
  nodes?: StringMap;
  service_intent?: {
    kubernetes?: StringMap<string[]>;
    host_native?: StringMap<string[]>;
  };
  placement_intent?: {
    frankfurt_only?: string[];
    enschede_only?: string[];
    gpu_specific?: StringMap;
  };
  exposure_intent?: StringMap<string[]>;
  access_intent?: {
    sso_protected?: string[];
    host_labels?: StringMap<string>;
    root_redirect?: StringMap;
  };
  ingress_intent?: {
    kubernetes_backends?: StringMap;
    route_rules?: FleetRouteRule[];
    wan_origin_overrides?: StringMap;
  };
  monitoring_intent?: {
    kubernetes_backends?: StringMap;
  };
};

export function fleetToDeployConfig(fleet: FleetInventoryInput): StringMap {
  return {
    version: fleet.version,
    cluster: fleet.cluster,
    sites: fleet.sites,
    nodes: fleet.nodes,
    service_intent: fleet.service_intent,
    placement_intent: placementIntent(fleet),
    exposure_intent: fleet.exposure_intent,
    access_intent: withAccessDefaults(fleet.access_intent),
    ingress_intent: {
      defaults: {
        namespace: "edge-system",
        public_ingress_class: "traefik-public",
        lan_ingress_class: "traefik-lan",
        entrypoint: "websecure",
        tls: true,
        public_dns_target: `ingress.${String(fleet.cluster?.public_domain)}`,
        sso_middleware: "forward-auth",
      },
      kubernetes_backends: fleet.ingress_intent?.kubernetes_backends ?? {},
      route_rules: routeRules(fleet),
      wan_origin_overrides: fleet.ingress_intent?.wan_origin_overrides ?? {},
    },
    monitoring_intent: {
      kubernetes_backends: fleet.monitoring_intent?.kubernetes_backends ?? {},
    },
    image_metadata: {
      workloads: {},
    },
    adapter_output_intent: {
      adapters: ["traefik-public", "traefik-lan", "gatus", "edge-catalog", "edge-route-catalog"],
      output_paths: {},
      namespaces: {
        gatus: "observability",
        "edge-catalog": "edge-system",
        "edge-route-catalog": "edge-system",
      },
      configmap_names: {
        gatus: "gatus-endpoints",
        "edge-catalog": "platform-edge-catalog",
        "edge-route-catalog": "platform-edge-route-catalog",
      },
    },
  };
}

function placementIntent(fleet: FleetInventoryInput): StringMap {
  const intent = fleet.placement_intent ?? {};
  const services = declaredServices(fleet);
  const siteAffinity: StringMap<string> = {};
  for (const service of intent.frankfurt_only ?? []) {
    if (services.has(service)) {
      siteAffinity[service] = "frankfurt";
    }
  }
  for (const service of intent.enschede_only ?? []) {
    if (services.has(service)) {
      siteAffinity[service] = "enschede";
    }
  }

  return {
    site_affinity: sortObject(siteAffinity),
    node_affinity: {},
    gpu_preferences: sortObject(
      Object.fromEntries(Object.entries(intent.gpu_specific ?? {}).filter(([service]) => services.has(service))),
    ),
  };
}

function declaredServices(fleet: FleetInventoryInput): Set<string> {
  const services = new Set<string>();
  for (const group of Object.values(fleet.service_intent?.kubernetes ?? {})) {
    for (const service of group) {
      services.add(service);
    }
  }
  for (const group of Object.values(fleet.service_intent?.host_native ?? {})) {
    for (const service of group) {
      services.add(service);
    }
  }
  return services;
}

function withAccessDefaults(accessIntent: FleetInventoryInput["access_intent"] = {}): StringMap {
  return {
    sso_protected: accessIntent.sso_protected ?? [],
    host_labels: accessIntent.host_labels ?? {},
    root_redirect: accessIntent.root_redirect ?? {},
  };
}

function routeRules(fleet: FleetInventoryInput): DeployRouteRule[] {
  const edgeServices = new Map(
    sortedEntries(edgeCatalogServices(fleet))
      .filter(([, service]) => service.host)
      .map(([serviceName, service]) => [serviceName, service]),
  );
  const explicitRules = fleet.ingress_intent?.route_rules ?? [];
  const explicitRuleServices = new Set(explicitRules.map((rule) => rule.service));
  const routes = explicitRules
    .filter((rule) => edgeServices.has(rule.service))
    .map((rule) => route(edgeServices.get(rule.service)!, rule));

  for (const [serviceName, service] of edgeServices) {
    if (!explicitRuleServices.has(serviceName)) {
      routes.push(route(service));
    }
  }

  return routes.sort((left, right) => left.name.localeCompare(right.name));
}

function edgeCatalogServices(fleet: FleetInventoryInput): StringMap<EdgeService> {
  const exposureByService: StringMap<string> = {};
  for (const [exposure, services] of Object.entries(fleet.exposure_intent ?? {})) {
    for (const service of services) {
      exposureByService[service] = exposure;
    }
  }

  return Object.fromEntries(
    Object.entries(exposureByService).map(([serviceName, exposure]) => {
      const hostLabel = fleet.access_intent?.host_labels?.[serviceName];
      return [
        serviceName,
        {
          name: serviceName,
          service: serviceName,
          exposure,
          access: accessForService(fleet, serviceName, exposure),
          host: hostLabel ? fqdn(hostLabel, String(fleet.cluster?.public_domain)) : undefined,
        },
      ];
    }),
  );
}

function accessForService(fleet: FleetInventoryInput, serviceName: string, exposure: string): string {
  if ((fleet.access_intent?.sso_protected ?? []).includes(serviceName)) {
    return "sso_protected";
  }
  if (exposure === "internal_only") {
    return "cluster_internal";
  }
  return "direct";
}

function route(service: EdgeService, overrides: Partial<FleetRouteRule> = {}): DeployRouteRule {
  return omitUndefined({
    name: overrides.name ?? service.name,
    service: service.service,
    access: overrides.access ?? service.access,
    path_prefixes: overrides.path_prefixes,
    exact_paths: overrides.exact_paths,
    excluded_path_prefixes: overrides.excluded_path_prefixes,
    excluded_exact_paths: overrides.excluded_exact_paths ?? overrides.excluded_paths,
  });
}

function fqdn(hostLabel: string, domain: string): string {
  return hostLabel === "root" ? domain : `${hostLabel}.${domain}`;
}

function sortedEntries<T>(object: StringMap<T> = {}): [string, T][] {
  return Object.entries(object).sort(([left], [right]) => left.localeCompare(right));
}

function sortObject<T>(object: StringMap<T> = {}): StringMap<T> {
  return Object.fromEntries(sortedEntries(object));
}

function omitUndefined<T extends StringMap>(object: T): T {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T;
}
