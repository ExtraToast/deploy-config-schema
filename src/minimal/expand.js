import { validateArtifact } from "../artifact-validator.js";
import { normalizeServiceIntentForRender } from "../service-intent-normalizer.js";

export const canonicalArtifactNames = [
  "service-intent",
  "fleet-inventory",
  "vault-dynamic-secrets",
  "deploy-config",
];

export function expandPlatform(platform) {
  const normalized = normalizePlatform(platform);
  const serviceIntent = expandServiceIntent(normalized);
  const fleetInventory = expandFleetInventory(normalized, serviceIntent);
  const vaultDynamicSecrets = expandVaultDynamicSecrets(normalized, serviceIntent);
  const deployConfig = expandDeployConfig(normalized, serviceIntent);
  const artifacts = {
    "service-intent": serviceIntent,
    "fleet-inventory": fleetInventory,
    "vault-dynamic-secrets": vaultDynamicSecrets,
    "deploy-config": deployConfig,
  };
  const validations = Object.fromEntries(
    canonicalArtifactNames.map((kind) => [kind, validateArtifact(kind, artifacts[kind])]),
  );

  return {
    platform: normalized,
    artifacts,
    validations,
    valid: Object.values(validations).every((validation) => validation.valid),
  };
}

function normalizePlatform(platform) {
  const hosts = Object.keys(platform.hosts ?? {}).length > 0
    ? platform.hosts
    : {
        [`${platform.name}-node-1`]: {
          site: "default",
          system: "x86_64-linux",
          roles: ["base", "k3s-control-plane", "k3s-worker"],
          capabilities: [],
        },
      };
  const sites = Object.keys(platform.sites ?? {}).length > 0
    ? platform.sites
    : inferSites(platform, hosts);
  const bootstrap = platform.cluster?.bootstrap ?? firstHostWithRole(hosts, "k3s-control-plane") ?? Object.keys(hosts).sort()[0];

  return {
    ...platform,
    cluster: {
      kind: "k3s",
      api: "https://127.0.0.1:6443",
      ...platform.cluster,
      bootstrap,
    },
    gitops: {
      root: "platform/cluster/flux",
      environment: "production",
      interval: "2m",
      ...platform.gitops,
    },
    sites,
    hosts,
    services: platform.services ?? {},
    packs: platform.packs ?? {},
  };
}

function expandServiceIntent(platform) {
  const services = Object.fromEntries(
    sortedEntries(platform.services).map(([serviceName, service]) => [serviceName, serviceProfile(platform, serviceName, service)]),
  );

  if (Object.keys(services).length === 0) {
    services.placeholder = serviceProfile(platform, "placeholder", {
      image: "registry.invalid/placeholder:0",
      port: 8080,
    });
  }

  return {
    version: platform.version,
    renderer: {
      cluster_name: platform.name,
      public_domain: platform.domain,
      adapters: selectedExistingAdapters(platform),
      output_paths: existingAdapterPaths(platform),
      namespaces: {
        gatus: "observability",
        "edge-catalog": "edge-system",
        "edge-route-catalog": "edge-system",
      },
      ingress_defaults: {
        namespace: "edge-system",
        public_ingress_class: "traefik-public",
        lan_ingress_class: "traefik-lan",
        entrypoint: "websecure",
        tls: true,
        public_dns_target: `ingress.${platform.domain}`,
        sso_middleware: "forward-auth",
      },
    },
    services,
  };
}

function serviceProfile(platform, serviceName, service) {
  const image = splitImage(service.image);
  const portName = "http";
  const route = routeFor(platform, serviceName, service, portName);
  const health = healthFor(service, portName);
  const kubernetes = {
    namespace_ref: service.namespace ?? namespaceFor(service),
    service_ref: serviceName,
    render_status: "candidate",
    resource_hints: route ? ["Deployment", "Service", "IngressRoute"] : ["Deployment", "Service"],
  };
  const profile = {
    workload: {
      kind: "deployment",
      replicas: 1,
      restart_policy: "Always",
    },
    image: {
      repository: image.repository,
      tag: image.tag,
      pull_policy: image.tag === "latest" ? "Always" : "IfNotPresent",
      source: image.repository.includes("ghcr.io/") ? "first_party" : "third_party",
    },
    ports: [
      {
        name: portName,
        container_port: service.port,
        service_port: service.port,
        exposure: serviceExposure(service),
      },
    ],
    kubernetes,
  };

  if (Object.keys(service.env ?? {}).length > 0) {
    profile.runtime = { env: canonicalEnv(service.env) };
  }
  if ((service.secrets ?? []).length > 0) {
    profile.secrets = service.secrets.map((secret) => ({
      name: secret.ref,
      source: secret.source ?? "vso_static",
      ref: secret.ref,
      env_keys: Object.keys(canonicalEnv(secret.env ?? {})).sort(),
    }));
  }
  if ((service.storage ?? []).length > 0) {
    profile.storage = {
      volumes: service.storage.map((volume) => ({
        name: volume.name,
        kind: volume.hostPath ? "host_path" : "pvc",
        ...(volume.size ? { size: volume.size } : {}),
        ...(volume.hostPath ? { path: volume.hostPath } : {}),
        access_modes: ["ReadWriteOnce"],
      })),
      mounts: service.storage.map((volume) => ({
        volume: volume.name,
        path: volume.mount,
      })),
    };
  }
  if (route) {
    profile.networking = { routes: [route] };
  }
  if (health) {
    profile.gatus = { endpoints: [health] };
  }
  const scheduling = schedulingFor(service);
  if (Object.keys(scheduling).length > 0) {
    profile.scheduling = scheduling;
  }
  if (service.rollout || image.tag === "latest") {
    profile.rollout = {
      update_strategy: service.rollout === "latest" || image.tag === "latest" ? "latest_tag" : service.rollout,
      restart_triggers: ["image"],
    };
  }

  return profile;
}

function expandFleetInventory(platform, serviceIntent) {
  const capabilities = new Set();
  for (const host of Object.values(platform.hosts)) {
    for (const capability of host.capabilities ?? []) {
      capabilities.add(capability);
    }
  }

  return {
    version: platform.version,
    fleet: {
      cluster: {
        name: platform.name,
        domain: platform.domain,
        platform: "kubernetes",
      },
      sites: Object.fromEntries(sortedEntries(platform.sites).map(([name, site]) => [name, fleetSite(site)])),
      nodes: Object.fromEntries(sortedEntries(platform.hosts).map(([name, host]) => [name, fleetNode(host)])),
      capabilities: Object.fromEntries([...capabilities].sort().map((name) => [name, { description: `${name} capability`, scope: "node" }])),
      placement: {
        rules: placementRules(platform),
      },
      origins: {
        public: {
          kind: "proxied_dns",
          provider: "cloudflare",
          proxied: true,
          ttl: "2m",
        },
        "edge-direct": {
          kind: "direct_wan",
          site: primarySite(platform),
        },
        "home-direct": {
          kind: "direct_wan",
          site: homeSite(platform) ?? primarySite(platform),
        },
        "cluster-internal": {
          kind: "internal_service",
        },
      },
      exposure: {
        classes: {
          public: { reachability: "public", default_origin: "public" },
          public_and_lan: { reachability: "public_and_lan", default_origin: "public" },
          lan_only: { reachability: "lan_only", default_origin: "home-direct" },
          internal_only: { reachability: "internal_only", default_origin: "cluster-internal" },
        },
        services: serviceExposureMap(platform),
      },
      sso: {
        policies: {
          forward_auth: {
            mode: "forward_auth",
          },
        },
      },
      renderer_targets: rendererTargets(platform, serviceIntent),
    },
  };
}

function expandVaultDynamicSecrets(platform) {
  const secretRefs = secretBindings(platform);
  const roles = {};
  const kvPaths = {};
  const staticSyncs = {};
  const serviceConsumers = {};

  for (const binding of secretRefs) {
    roles[binding.service] ??= {
      bound_service_accounts: [{ name: binding.service, namespace: binding.namespace }],
      policies: [`${binding.service}-secrets`],
      ttl: "1h",
    };
    kvPaths[binding.ref] ??= {
      path: `secret/data/${platform.name}/${binding.ref}`,
      fields: binding.fields.length > 0 ? binding.fields : ["value"],
      owner: binding.service,
      purpose: `${binding.service} runtime secret`,
    };
    staticSyncs[binding.ref] ??= {
      kv_path_ref: binding.ref,
      target: {
        namespace: binding.namespace,
        name: binding.ref,
        type: "Opaque",
      },
      rollout_restart_targets: [
        {
          kind: "Deployment",
          namespace: binding.namespace,
          name: binding.service,
        },
      ],
    };
    serviceConsumers[binding.service] ??= {
      kubernetes_role_ref: binding.service,
      kv_path_refs: [],
      credential_delivery: "vso_secret",
    };
    serviceConsumers[binding.service].kv_path_refs.push(binding.ref);
    serviceConsumers[binding.service].kv_path_refs.sort();
  }

  if (Object.keys(roles).length === 0) {
    roles.renderer = {
      bound_service_accounts: [{ name: "vso", namespace: "vault-secrets-operator" }],
      policies: ["renderer"],
      ttl: "1h",
    };
  }

  return {
    version: platform.version,
    vault: {
      auth: {
        kubernetes: {
          mount: "kubernetes",
          roles,
        },
      },
      kv: {
        mount: "secret",
        paths: kvPaths,
      },
      transit: {
        keys: {},
      },
      database: {
        engines: {},
      },
      rabbitmq: {
        engines: {},
      },
      vso: {
        auth_role: Object.keys(roles).sort()[0],
        static_syncs: staticSyncs,
        dynamic_syncs: {},
      },
      service_consumers: serviceConsumers,
      validation_fixtures: {
        required_checks: ["no_secret_values"],
      },
    },
  };
}

function expandDeployConfig(platform, serviceIntent) {
  const config = normalizeServiceIntentForRender(serviceIntent);
  addKeelMetadata(config);
  return {
    version: platform.version,
    cluster: {
      name: platform.name,
      public_domain: platform.domain,
      kubernetes: {
        bootstrap_control_plane: platform.cluster.bootstrap,
        api_server_endpoint: platform.cluster.api,
        control_plane_token_file: "/var/lib/rancher/k3s/server/node-token",
        worker_join_token_file: "/var/lib/deploy-config-schema/secrets/k3s/agent-token",
      },
    },
    sites: Object.fromEntries(sortedEntries(platform.sites).map(([name, site]) => [name, deploySite(site)])),
    nodes: Object.fromEntries(sortedEntries(platform.hosts).map(([name, host]) => [name, deployNode(host)])),
    service_intent: groupServices(platform),
    placement_intent: placementIntent(platform),
    exposure_intent: config.exposure_intent,
    access_intent: config.access_intent,
    ingress_intent: {
      ...config.ingress_intent,
      wan_origin_overrides: wanOriginOverrides(platform),
    },
    monitoring_intent: config.monitoring_intent,
    image_metadata: config.image_metadata,
    adapter_output_intent: {
      adapters: selectedExistingAdapters(platform),
      output_paths: existingAdapterPaths(platform),
      namespaces: config.adapter_output_intent.namespaces,
      configmap_names: {},
    },
    extensions: {
      nomad: {},
    },
  };
}

function addKeelMetadata(config) {
  for (const workload of Object.values(config.image_metadata.workloads)) {
    if (workload.update.strategy !== "latest_tag") continue;
    workload.update.keel = {
      policy: "force",
      match_tag: true,
      trigger: "poll",
      poll_schedule: "@every 2m",
    };
  }
}

export function selectedExistingAdapters(platform) {
  const adapters = new Set(["traefik-public", "gatus", "edge-catalog", "edge-route-catalog", "image-metadata", "kubernetes", "nix-hosts", "vso", "flux-root", "flux-source", "flux-packs"]);
  if (hasPack(platform, "traefik-lan") || serviceList(platform).some(([, service]) => serviceExposure(service) === "lan" || routeObject(service.route)?.exposure === "public_and_lan")) {
    adapters.add("traefik-lan");
  }
  return [...adapters].sort();
}

export function existingAdapterPaths(platform) {
  const root = platform.gitops?.root ?? "platform/cluster/flux";
  const apps = `${root}/apps`;
  const gatusGroup = platform.packs?.observability?.gatus !== undefined ? "observability" : "utility-system";
  return {
    "edge-catalog": `${apps}/edge/edge-catalog-configmap.yaml`,
    "edge-route-catalog": `${apps}/edge/edge-route-catalog-configmap.yaml`,
    "flux-packs": `${apps}`,
    "flux-root": `${root}/clusters/${platform.gitops?.environment ?? "production"}/kustomizations.yaml`,
    "flux-source": `${apps}`,
    gatus: `${apps}/${gatusGroup}/gatus/gatus-endpoints-configmap.yaml`,
    "image-metadata": `${apps}/edge/image-metadata.yaml`,
    kubernetes: `${apps}`,
    "nix-hosts": "platform",
    "traefik-lan": `${apps}/edge/traefik-lan-ingressroutes.yaml`,
    "traefik-public": `${apps}/edge/traefik-ingressroutes.yaml`,
    vso: `${apps}/vso-secrets`,
  };
}

function routeFor(platform, serviceName, service, portName) {
  if (!service.route) return undefined;
  const route = routeObject(service.route);
  const host = routeHost(platform, serviceName, service, route);
  const paths = route.path ? [route.path] : ["/"];
  return {
    name: serviceName,
    host,
    port: route.port ?? portName,
    paths,
    ...(route.sso ? { access: "sso" } : {}),
    ...(route.origin ? { origin: route.origin.replaceAll("_", "-") } : {}),
  };
}

function healthFor(service, portName) {
  if (!service.health) return undefined;
  const health = typeof service.health === "string" ? { path: service.health } : service.health;
  return {
    name: "health",
    type: "http",
    port: portName,
    path: health.path ?? "/",
    expected_status: health.expectedStatus ?? 200,
    strategy: "both",
    group: service.group ?? "apps",
  };
}

function schedulingFor(service) {
  const scheduling = {};
  if (service.schedule?.site) scheduling.site_affinity = service.schedule.site;
  if (service.schedule?.node) scheduling.node_affinity = service.schedule.node;
  const storageNodes = new Set((service.storage ?? []).map((volume) => volume.node).filter(Boolean));
  if (!scheduling.node_affinity && storageNodes.size === 1) scheduling.node_affinity = [...storageNodes][0];
  if ((service.schedule?.requiredCapabilities ?? []).length > 0) {
    scheduling.required_capabilities = [...service.schedule.requiredCapabilities].sort();
  }
  if (service.gpu) {
    scheduling.gpu = {
      class: service.gpu.class ?? service.gpu.vendor,
      count: service.gpu.count ?? 1,
    };
  }
  if (service.schedule?.spread) {
    scheduling.topology_spread = [service.schedule.spread];
  }
  return scheduling;
}

function serviceExposure(service) {
  const route = routeObject(service.route);
  if (route.exposure === "public_and_lan") return "public";
  if (route.exposure === "lan_only") return "lan";
  if (route.exposure === "internal_only") return "internal";
  return service.route ? "public" : "internal";
}

function routeObject(route) {
  if (route === "root") return { host: "root", path: "/" };
  if (typeof route === "string") return { path: route };
  return route ?? {};
}

function hostForService(platform, serviceName, service) {
  const route = routeObject(service.route);
  if (route.host === "root") return platform.domain;
  if (route.host) return `${route.host}.${platform.domain}`;
  return serviceName === "frontend" ? platform.domain : `${serviceName}.${platform.domain}`;
}

function routeHost(platform, serviceName, service, route) {
  if (route.host === "root") return platform.domain;
  if (route.host && route.host.endsWith(`.${platform.domain}`)) return route.host;
  if (route.host) return `${route.host}.${platform.domain}`;
  return hostForService(platform, serviceName, service);
}

function splitImage(image) {
  const slash = image.lastIndexOf("/");
  const colon = image.lastIndexOf(":");
  if (colon > slash) {
    return {
      repository: image.slice(0, colon),
      tag: image.slice(colon + 1),
    };
  }
  return {
    repository: image,
    tag: "latest",
  };
}

function groupServices(platform) {
  const kubernetes = {};
  for (const [serviceName, service] of serviceList(platform)) {
    const group = (service.group ?? "stateless").replaceAll("-", "_");
    kubernetes[group] ??= [];
    kubernetes[group].push(serviceName);
  }
  if (Object.keys(kubernetes).length === 0) {
    kubernetes.stateless = ["placeholder"];
  }
  for (const names of Object.values(kubernetes)) {
    names.sort();
  }
  return {
    kubernetes,
    host_native: {},
  };
}

function placementIntent(platform) {
  const site_affinity = {};
  const node_affinity = {};
  const gpu_preferences = {};
  for (const [serviceName, service] of serviceList(platform)) {
    if (service.schedule?.site) site_affinity[serviceName] = service.schedule.site;
    if (service.schedule?.node) node_affinity[serviceName] = service.schedule.node;
  }
  return {
    site_affinity,
    node_affinity,
    gpu_preferences,
  };
}

function serviceExposureMap(platform) {
  return Object.fromEntries(serviceList(platform).map(([serviceName, service]) => {
    const route = routeObject(service.route);
    const exposureClass = route.exposure ?? (service.route ? "public" : "internal_only");
    return [serviceName, {
      class: exposureClass,
      host_label: hostLabel(platform, serviceName, service),
      origin: route.origin ? route.origin.replaceAll("_", "-") : exposureOrigin(exposureClass),
      ...(route.sso ? { sso_policy: "forward_auth" } : {}),
    }];
  }));
}

function placementRules(platform) {
  return serviceList(platform).flatMap(([serviceName, service]) => {
    const selector = {};
    if (service.schedule?.site) selector.sites = [service.schedule.site];
    if (service.schedule?.node) selector.nodes = [service.schedule.node];
    if ((service.schedule?.requiredCapabilities ?? []).length > 0) {
      selector.required_capabilities = [...service.schedule.requiredCapabilities].sort();
    }
    if (Object.keys(selector).length === 0) return [];
    return [{
      name: `${serviceName}-placement`,
      selector,
      applies_to: [serviceName],
      fallback: "fail",
    }];
  });
}

function rendererTargets(platform) {
  return [
    { name: "traefik-public", kind: "traefik_routes", status: "implemented", consumes: ["service_intent", "origins", "sso"], output_ref: "traefik-public" },
    ...(selectedExistingAdapters(platform).includes("traefik-lan") ? [{ name: "traefik-lan", kind: "traefik_routes", status: "implemented", consumes: ["service_intent", "origins"], output_ref: "traefik-lan" }] : []),
    { name: "gatus", kind: "gatus_endpoints", status: "implemented", consumes: ["service_intent"], output_ref: "gatus" },
    { name: "edge-catalog", kind: "edge_catalog", status: "implemented", consumes: ["fleet", "service_intent"], output_ref: "edge-catalog" },
    { name: "image-metadata", kind: "image_metadata", status: "implemented", consumes: ["images"], output_ref: "image-metadata" },
    { name: "kubernetes-workloads", kind: "kubernetes_workloads", status: "design_only", consumes: ["service_intent", "vault_inputs"], output_ref: "kubernetes-workloads" },
    { name: "flux-root", kind: "custom", status: "implemented", consumes: ["fleet"], output_ref: "flux-root" },
    { name: "flux-packs", kind: "custom", status: "implemented", consumes: ["fleet", "packs"], output_ref: "flux-packs" },
    { name: "flux-source", kind: "custom", status: "implemented", consumes: ["packs"], output_ref: "flux-source" },
    { name: "nix-hosts", kind: "custom", status: "design_only", consumes: ["fleet"], output_ref: "nix-hosts" },
  ];
}

function secretBindings(platform) {
  return serviceList(platform).flatMap(([serviceName, service]) => (service.secrets ?? []).map((secret) => ({
    service: serviceName,
    namespace: service.namespace ?? namespaceFor(service),
    ref: secret.ref,
    fields: Object.values(secret.env ?? {}).sort(),
  })));
}

function wanOriginOverrides(platform) {
  return Object.fromEntries(serviceList(platform).flatMap(([serviceName, service]) => {
    const origin = routeObject(service.route).origin;
    return origin ? [[serviceName, origin]] : [];
  }));
}

function fleetSite(site) {
  return {
    kind: site.kind ?? "vps",
    purpose: site.purpose ?? "primary_cluster_site",
    ...(site.region ? { region: site.region } : {}),
    ...(site.labels ? { labels: sortObject(site.labels) } : {}),
  };
}

function deploySite(site) {
  const networking = {};
  if (site.lanIngress) networking.lan_ingress_ip = site.lanIngress;
  if (site.wan) networking.wan_public_ip = site.wan;
  return {
    kind: deploySiteKind(site.kind ?? "vps"),
    purpose: site.purpose ?? "primary_cluster_site",
    ...(Object.keys(networking).length > 0 ? { networking } : {}),
  };
}

function inferSites(platform, hosts) {
  const siteNames = new Set(Object.values(hosts).map((host) => host.site).filter(Boolean));
  const names = siteNames.size > 0 ? [...siteNames].sort() : ["default"];
  return Object.fromEntries(names.map((name, index) => [name, {
    kind: "vps",
    purpose: index === 0 ? "primary_cluster_site" : "worker_site",
    ...(index === 0 ? { wan: hostFromUrl(platform.cluster?.api) } : {}),
  }]));
}

function fleetNode(host) {
  return {
    status: host.ssh ? "active" : "planned",
    site: host.site ?? "default",
    arch: systemArch(host.system),
    roles: host.roles ?? ["base", "k3s-worker"],
    capacity: {
      cpu_millicores: host.capacity?.cpuMillicores ?? 1000,
      memory_mib: host.capacity?.memoryMiB ?? 1024,
    },
    capabilities: [...(host.capabilities ?? [])].sort(),
    ...(host.ssh ? { addresses: { ssh: host.ssh } } : {}),
  };
}

function deployNode(host) {
  return {
    status: host.ssh ? "active" : "planned",
    site: host.site ?? "default",
    arch: systemArch(host.system),
    ...(host.ssh ? { ssh: parseSsh(host.ssh) } : {}),
    target_roles: (host.roles ?? ["base", "k3s-worker"]).filter((role) => role !== "base"),
    capacity: {
      cpu_millicores: host.capacity?.cpuMillicores ?? 1000,
      memory_mib: host.capacity?.memoryMiB ?? 1024,
    },
    capabilities: [...(host.capabilities ?? [])].sort(),
  };
}

function parseSsh(value) {
  const match = /^(?<user>[a-z0-9._-]+)@(?<host>[^:]+)(:(?<port>[0-9]+))?$/.exec(value);
  if (!match) {
    return { user: "deploy", host: value, port: 22 };
  }
  return {
    user: match.groups.user,
    host: match.groups.host,
    port: Number(match.groups.port ?? 22),
  };
}

function namespaceFor(service) {
  const group = service.group ?? "stateless";
  return group === "stateless" ? "default" : `${group.replaceAll("_", "-")}-system`;
}

function hostLabel(platform, serviceName, service) {
  const route = routeObject(service.route);
  if (route.host === "root") return "root";
  if (route.host) return route.host;
  return serviceName === "frontend" ? "root" : serviceName;
}

function exposureOrigin(exposureClass) {
  if (exposureClass === "internal_only") return "cluster-internal";
  if (exposureClass === "lan_only") return "home-direct";
  return "public";
}

function hasPack(platform, packName) {
  return flattenValues(platform.packs).includes(packName);
}

function flattenValues(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...flattenValues(child)]);
}

function serviceList(platform) {
  return sortedEntries(platform.services ?? {});
}

function firstHostWithRole(hosts, role) {
  return sortedEntries(hosts).find(([, host]) => (host.roles ?? []).includes(role))?.[0];
}

function primarySite(platform) {
  return sortedEntries(platform.sites).find(([, site]) => site.purpose === "primary_cluster_site")?.[0] ?? Object.keys(platform.sites).sort()[0];
}

function homeSite(platform) {
  return sortedEntries(platform.sites).find(([, site]) => site.kind === "home")?.[0];
}

function systemArch(system = "x86_64-linux") {
  return system === "aarch64-linux" ? "arm64" : "amd64";
}

function deploySiteKind(kind) {
  return kind === "colo" || kind === "custom" ? "lab" : kind;
}

function sortedEntries(object) {
  return Object.entries(object ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

function sortObject(object) {
  return Object.fromEntries(sortedEntries(object));
}

function canonicalEnv(env) {
  return Object.fromEntries(sortedEntries(env).map(([key, value]) => [toIdentifier(key), value]));
}

function toIdentifier(value) {
  const normalized = String(value).toLowerCase().replaceAll(/[^a-z0-9._-]/g, "_").replaceAll(/^[^a-z0-9]+/g, "");
  return normalized || "value";
}

function hostFromUrl(value) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}
