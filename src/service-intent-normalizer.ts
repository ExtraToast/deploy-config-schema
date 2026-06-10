// @ts-nocheck -- Normalization constructs the legacy deploy-config document
// through incremental mutation. The broad artifact shapes are schema-validated
// at the boundary; this pass keeps emitted documents byte-compatible.
export function normalizeServiceIntentForRender(document) {
  const renderer = document.renderer ?? {};
  const publicDomain = renderer.public_domain ?? "example.invalid";
  const defaults = renderer.ingress_defaults ?? {};
  const adapters = renderer.adapters ?? [
    "traefik-public",
    "traefik-lan",
    "gatus",
    "edge-catalog",
    "edge-route-catalog",
    "image-metadata",
  ];

  const config = {
    version: document.version,
    cluster: {
      name: renderer.cluster_name ?? "service-intent",
      public_domain: publicDomain,
    },
    service_intent: {
      kubernetes: {
        service_intent: [],
      },
      host_native: {},
    },
    exposure_intent: {
      public: [],
      public_and_lan: [],
      internal_only: [],
      lan_only: [],
    },
    access_intent: {
      sso_protected: [],
      host_labels: {},
      root_redirect: {},
    },
    ingress_intent: {
      defaults: {
        namespace: defaults.namespace ?? "edge-system",
        public_ingress_class: defaults.public_ingress_class ?? "traefik-public",
        lan_ingress_class: defaults.lan_ingress_class ?? "traefik-lan",
        entrypoint: defaults.entrypoint ?? "websecure",
        tls: defaults.tls ?? true,
        public_dns_target: defaults.public_dns_target,
        sso_middleware: defaults.sso_middleware,
      },
      kubernetes_backends: {},
      route_rules: [],
      wan_origin_overrides: {},
    },
    monitoring_intent: {
      kubernetes_backends: {},
    },
    image_metadata: {
      workloads: {},
    },
    adapter_output_intent: {
      adapters,
      output_paths: renderer.output_paths ?? {},
      namespaces: renderer.namespaces ?? {},
      configmap_names: renderer.configmap_names ?? {},
    },
  };

  for (const [serviceName, service] of Object.entries(document.services)) {
    if (service.workload.kind === "host_native") {
      config.service_intent.host_native[renderer.host_native_node ?? "host-native"] ??= [];
      config.service_intent.host_native[renderer.host_native_node ?? "host-native"].push(serviceName);
    } else if (service.workload.kind !== "nomad_job") {
      config.service_intent.kubernetes.service_intent.push(serviceName);
    }

    addServiceImage(config, serviceName, service);
    addServiceExposure(config, publicDomain, serviceName, service);
    addServiceBackends(config, serviceName, service);
  }

  sortConfig(config);
  return config;
}

function addServiceImage(config, serviceName, service) {
  const strategy = service.rollout?.update_strategy ?? (service.image.tag === "latest" ? "latest_tag" : "pinned");
  config.image_metadata.workloads[serviceName] = {
    repository: service.image.repository,
    tag: service.image.tag,
    pull_policy: service.image.pull_policy ?? "IfNotPresent",
    source: service.image.source ?? "first_party",
    update: {
      eligible: strategy !== "pinned" && strategy !== "manual",
      strategy,
    },
  };
}

function addServiceExposure(config, publicDomain, serviceName, service) {
  const routes = service.networking?.routes ?? [];
  const exposure = exposureFor(service, routes);
  config.exposure_intent[exposure].push(serviceName);

  const firstRoute = routes.find((route) => route.host);
  if (firstRoute) {
    config.access_intent.host_labels[serviceName] = hostLabel(firstRoute.host, publicDomain);
  }
  if (routes.some((route) => route.access === "sso")) {
    config.access_intent.sso_protected.push(serviceName);
  }

  for (const route of routes) {
    const routeRule = {
      name: route.name,
      service: serviceName,
      access: routeAccess(route.access),
    };
    if (route.host) {
      routeRule.host_label = hostLabel(route.host, publicDomain);
    }
    if (route.paths?.length > 0) {
      routeRule.path_prefixes = [...route.paths];
    }
    if (route.bypass_paths?.length > 0) {
      routeRule.excluded_exact_paths = [...route.bypass_paths];
    }
    config.ingress_intent.route_rules.push(routeRule);
  }
}

function addServiceBackends(config, serviceName, service) {
  const ports = new Map((service.ports ?? []).map((port) => [port.name, port]));
  const routes = service.networking?.routes ?? [];
  const routePort = routes.length > 0 ? ports.get(routes[0].port) : undefined;
  const namespace = service.kubernetes?.namespace_ref ?? "default";
  const servicePort = routePort?.service_port ?? routePort?.container_port;

  if (routes.length > 0 && servicePort) {
    config.ingress_intent.kubernetes_backends[serviceName] = {
      namespace,
      service: service.kubernetes?.service_ref ?? serviceName,
      port: servicePort,
    };
    const primaryProbe = primaryProbeFor(service);
    if (primaryProbe) {
      config.ingress_intent.kubernetes_backends[serviceName].health = toHealth(primaryProbe, ports, servicePort);
    }
    const extraProbes = extraProbesFor(service, primaryProbe, ports);
    if (extraProbes.length > 0) {
      config.ingress_intent.kubernetes_backends[serviceName].extra_probes = extraProbes;
    }
  } else if ((service.gatus?.endpoints ?? []).length > 0) {
    const probe = service.gatus.endpoints[0];
    const probePort = ports.get(probe.port);
    config.monitoring_intent.kubernetes_backends[serviceName] = {
      namespace,
      service: service.kubernetes?.service_ref ?? serviceName,
      port: probePort?.service_port ?? probePort?.container_port,
      health: toHealth(probe, ports, probePort?.service_port ?? probePort?.container_port),
    };
  }
}

function exposureFor(service, routes) {
  const hasPublic = routes.some((route) => !String(route.origin ?? "").includes("lan"));
  const hasLan = routes.some((route) => String(route.origin ?? "").includes("lan"));
  if (hasPublic && hasLan) return "public_and_lan";
  if (hasPublic) return "public";
  if (hasLan) return "lan_only";

  const portExposures = new Set((service.ports ?? []).map((port) => port.exposure));
  if (portExposures.has("public")) return "public";
  if (portExposures.has("lan")) return "lan_only";
  return "internal_only";
}

function routeAccess(access) {
  if (access === "sso") return "sso_protected";
  if (access === "internal") return "cluster_internal";
  return "direct";
}

function primaryProbeFor(service) {
  return (service.gatus?.endpoints ?? []).find((probe) => probe.type === "http")
    ?? (service.gatus?.endpoints ?? [])[0];
}

function extraProbesFor(service, primaryProbe, ports) {
  return (service.gatus?.endpoints ?? [])
    .filter((probe) => probe !== primaryProbe)
    .map((probe) => {
      const port = ports.get(probe.port);
      return {
        name: probe.name,
        type: probe.type,
        port: port?.service_port ?? port?.container_port,
        path: probe.path,
        expected_status: probe.expected_status,
        group: probe.group,
      };
    });
}

function toHealth(probe, ports, fallbackPort) {
  const port = ports.get(probe.port);
  return {
    type: probe.type,
    path: probe.path,
    port: port?.service_port ?? port?.container_port ?? fallbackPort,
    expected_status: probe.expected_status,
    probe_strategy: probe.strategy,
  };
}

function hostLabel(host, publicDomain) {
  if (host === "root" || host === publicDomain) return "root";
  return host.slice(0, -`.${publicDomain}`.length);
}

function sortConfig(config) {
  for (const list of [
    config.service_intent.kubernetes.service_intent,
    config.exposure_intent.public,
    config.exposure_intent.public_and_lan,
    config.exposure_intent.internal_only,
    config.exposure_intent.lan_only,
    config.access_intent.sso_protected,
  ]) {
    list.sort();
  }
  config.ingress_intent.route_rules.sort((left, right) => left.name.localeCompare(right.name));
}
