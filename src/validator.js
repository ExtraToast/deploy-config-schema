import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";

const schema = JSON.parse(
  readFileSync(new URL("../schemas/deploy-config.schema.json", import.meta.url), "utf8"),
);

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});

const validateSchema = ajv.compile(schema);

export function validateConfig(config) {
  const schemaValid = validateSchema(config);
  if (!schemaValid) {
    return result(schemaDiagnostics(validateSchema.errors ?? []));
  }

  const diagnostics = [];
  validateCluster(config, diagnostics);
  const serviceIndex = buildServiceIndex(config, diagnostics);
  validatePlacement(config, serviceIndex, diagnostics);
  const exposureIndex = buildExposureIndex(config, serviceIndex, diagnostics);
  validateAccess(config, serviceIndex, exposureIndex, diagnostics);
  validateIngress(config, serviceIndex, exposureIndex, diagnostics);
  validateMonitoring(config, serviceIndex, exposureIndex, diagnostics);
  validateImageMetadata(config, serviceIndex, diagnostics);

  return result(diagnostics);
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

function validateCluster(config, diagnostics) {
  const bootstrapNode = config.cluster.kubernetes.bootstrap_control_plane;
  const node = config.nodes[bootstrapNode];
  if (!node) {
    diagnostic(
      diagnostics,
      "E_CLUSTER_BOOTSTRAP_NODE_UNKNOWN",
      "/cluster/kubernetes/bootstrap_control_plane",
      `bootstrap control plane ${bootstrapNode} is not defined as a node`,
    );
  } else if (!node.target_roles.includes("k3s-control-plane")) {
    diagnostic(
      diagnostics,
      "E_CLUSTER_BOOTSTRAP_ROLE_MISSING",
      "/cluster/kubernetes/bootstrap_control_plane",
      `bootstrap control plane ${bootstrapNode} must target the k3s-control-plane role`,
    );
  }

  for (const [nodeName, nodeInfo] of Object.entries(config.nodes)) {
    if (!config.sites[nodeInfo.site]) {
      diagnostic(
        diagnostics,
        "E_NODE_SITE_UNKNOWN",
        pointer("nodes", nodeName, "site"),
        `node ${nodeName} references unknown site ${nodeInfo.site}`,
      );
    }
    if (nodeInfo.status === "active" && !nodeInfo.ssh) {
      diagnostic(
        diagnostics,
        "E_NODE_ACTIVE_SSH_MISSING",
        pointer("nodes", nodeName, "ssh"),
        `active node ${nodeName} must define ssh connection details`,
      );
    }
  }
}

function buildServiceIndex(config, diagnostics) {
  const kubernetes = new Map();
  const all = new Set();

  for (const [groupName, serviceNames] of Object.entries(config.service_intent.kubernetes)) {
    for (const serviceName of serviceNames) {
      if (!kubernetes.has(serviceName)) {
        kubernetes.set(serviceName, []);
      }
      kubernetes.get(serviceName).push(groupName);
      all.add(serviceName);
    }
  }

  for (const [serviceName, groups] of kubernetes.entries()) {
    if (groups.length > 1) {
      diagnostic(
        diagnostics,
        "E_SERVICE_DUPLICATE_CLASSIFICATION",
        "/service_intent/kubernetes",
        `service ${serviceName} is listed in more than one kubernetes service group: ${groups.join(", ")}`,
      );
    }
  }

  for (const [nodeName, serviceNames] of Object.entries(config.service_intent.host_native)) {
    if (!config.nodes[nodeName]) {
      diagnostic(
        diagnostics,
        "E_HOST_NATIVE_NODE_UNKNOWN",
        pointer("service_intent", "host_native", nodeName),
        `host-native services reference unknown node ${nodeName}`,
      );
    }
    for (const serviceName of serviceNames) {
      all.add(serviceName);
    }
  }

  return {
    all,
    kubernetes: new Set(kubernetes.keys()),
    kubernetesGroups: kubernetes,
  };
}

function validatePlacement(config, serviceIndex, diagnostics) {
  for (const [serviceName, siteName] of Object.entries(config.placement_intent.site_affinity)) {
    if (!serviceIndex.all.has(serviceName)) {
      diagnostic(
        diagnostics,
        "E_PLACEMENT_SERVICE_UNKNOWN",
        pointer("placement_intent", "site_affinity", serviceName),
        `site placement for ${serviceName} references unknown service`,
      );
    }
    if (!config.sites[siteName]) {
      diagnostic(
        diagnostics,
        "E_PLACEMENT_SITE_UNKNOWN",
        pointer("placement_intent", "site_affinity", serviceName),
        `site placement for ${serviceName} references unknown site ${siteName}`,
      );
    }
  }

  for (const [serviceName, nodeName] of Object.entries(config.placement_intent.node_affinity)) {
    if (!serviceIndex.all.has(serviceName)) {
      diagnostic(
        diagnostics,
        "E_PLACEMENT_SERVICE_UNKNOWN",
        pointer("placement_intent", "node_affinity", serviceName),
        `node placement for ${serviceName} references unknown service`,
      );
    }
    if (!config.nodes[nodeName]) {
      diagnostic(
        diagnostics,
        "E_PLACEMENT_NODE_UNKNOWN",
        pointer("placement_intent", "node_affinity", serviceName),
        `node placement for ${serviceName} references unknown node ${nodeName}`,
      );
    }
  }

  const gpuModels = new Set(
    Object.values(config.nodes).flatMap((node) => (node.gpus ?? []).map((gpu) => gpu.model)),
  );
  for (const [serviceName, preference] of Object.entries(config.placement_intent.gpu_preferences)) {
    if (!serviceIndex.all.has(serviceName)) {
      diagnostic(
        diagnostics,
        "E_PLACEMENT_SERVICE_UNKNOWN",
        pointer("placement_intent", "gpu_preferences", serviceName),
        `gpu placement for ${serviceName} references unknown service`,
      );
    }
    for (const key of ["preferred_gpu_model", "temporary_gpu_model"]) {
      if (preference[key] && !gpuModels.has(preference[key])) {
        diagnostic(
          diagnostics,
          "E_PLACEMENT_GPU_UNKNOWN",
          pointer("placement_intent", "gpu_preferences", serviceName, key),
          `gpu placement for ${serviceName} references unknown GPU model ${preference[key]}`,
        );
      }
    }
  }
}

function buildExposureIndex(config, serviceIndex, diagnostics) {
  const byService = new Map();

  for (const exposureClass of exposureClasses()) {
    for (const serviceName of config.exposure_intent[exposureClass]) {
      if (!serviceIndex.all.has(serviceName)) {
        diagnostic(
          diagnostics,
          "E_EXPOSURE_SERVICE_UNKNOWN",
          pointer("exposure_intent", exposureClass),
          `exposure ${exposureClass} references unknown service ${serviceName}`,
        );
      }
      if (!byService.has(serviceName)) {
        byService.set(serviceName, []);
      }
      byService.get(serviceName).push(exposureClass);
    }
  }

  for (const [serviceName, classes] of byService.entries()) {
    if (classes.length > 1) {
      diagnostic(
        diagnostics,
        "E_EXPOSURE_DUPLICATE",
        "/exposure_intent",
        `service ${serviceName} is listed in multiple exposure classes: ${classes.join(", ")}`,
      );
    }
  }

  return {
    byService,
    external: new Set([
      ...config.exposure_intent.public,
      ...config.exposure_intent.public_and_lan,
      ...config.exposure_intent.lan_only,
    ]),
    public: new Set([...config.exposure_intent.public, ...config.exposure_intent.public_and_lan]),
    lan: new Set([...config.exposure_intent.public_and_lan, ...config.exposure_intent.lan_only]),
  };
}

function exposureClasses() {
  return ["public", "public_and_lan", "internal_only", "lan_only"];
}

function validateAccess(config, serviceIndex, exposureIndex, diagnostics) {
  for (const serviceName of config.access_intent.sso_protected) {
    if (!serviceIndex.all.has(serviceName)) {
      diagnostic(
        diagnostics,
        "E_ACCESS_SERVICE_UNKNOWN",
        "/access_intent/sso_protected",
        `SSO access references unknown service ${serviceName}`,
      );
    }
    if (!exposureIndex.external.has(serviceName)) {
      diagnostic(
        diagnostics,
        "E_ACCESS_NOT_EXTERNAL",
        "/access_intent/sso_protected",
        `SSO access for ${serviceName} requires external exposure`,
      );
    }
  }

  for (const serviceName of Object.keys(config.access_intent.host_labels)) {
    if (!serviceIndex.all.has(serviceName)) {
      diagnostic(
        diagnostics,
        "E_HOST_LABEL_SERVICE_UNKNOWN",
        pointer("access_intent", "host_labels", serviceName),
        `host label references unknown service ${serviceName}`,
      );
    }
  }

  for (const serviceName of exposureIndex.external) {
    if (!config.access_intent.host_labels[serviceName]) {
      diagnostic(
        diagnostics,
        "E_EXTERNAL_HOST_LABEL_MISSING",
        pointer("access_intent", "host_labels", serviceName),
        `externally exposed service ${serviceName} must declare a host label`,
      );
    }
  }

  for (const serviceName of Object.keys(config.access_intent.root_redirect)) {
    if (!serviceIndex.all.has(serviceName)) {
      diagnostic(
        diagnostics,
        "E_ROOT_REDIRECT_SERVICE_UNKNOWN",
        pointer("access_intent", "root_redirect", serviceName),
        `root redirect references unknown service ${serviceName}`,
      );
    }
    if (!config.access_intent.host_labels[serviceName]) {
      diagnostic(
        diagnostics,
        "E_ROOT_REDIRECT_HOST_LABEL_MISSING",
        pointer("access_intent", "root_redirect", serviceName),
        `root redirect for ${serviceName} requires a host label`,
      );
    }
  }
}

function validateIngress(config, serviceIndex, exposureIndex, diagnostics) {
  const externalKubernetesServices = intersect(exposureIndex.external, serviceIndex.kubernetes);

  for (const [serviceName, backend] of Object.entries(config.ingress_intent.kubernetes_backends)) {
    if (!serviceIndex.kubernetes.has(serviceName)) {
      diagnostic(
        diagnostics,
        "E_INGRESS_BACKEND_SERVICE_UNKNOWN",
        pointer("ingress_intent", "kubernetes_backends", serviceName),
        `ingress backend for ${serviceName} references unknown kubernetes service`,
      );
    }
    if (!externalKubernetesServices.has(serviceName)) {
      diagnostic(
        diagnostics,
        "E_INGRESS_BACKEND_NOT_EXTERNAL",
        pointer("ingress_intent", "kubernetes_backends", serviceName),
        `ingress backend for ${serviceName} must target an externally exposed kubernetes service`,
      );
    }
    validateBackendHealth(backend, pointer("ingress_intent", "kubernetes_backends", serviceName), diagnostics);
  }

  for (const serviceName of externalKubernetesServices) {
    if (!config.ingress_intent.kubernetes_backends[serviceName]) {
      diagnostic(
        diagnostics,
        "E_EXTERNAL_BACKEND_MISSING",
        pointer("ingress_intent", "kubernetes_backends", serviceName),
        `externally exposed kubernetes service ${serviceName} must declare an ingress backend`,
      );
    }
  }

  validateRouteRules(config, serviceIndex, diagnostics);
  validateWanOverrides(config, externalKubernetesServices, diagnostics);
  validateLanExposure(config, exposureIndex, diagnostics);
}

function validateRouteRules(config, serviceIndex, diagnostics) {
  const routeNames = new Map();
  for (const [index, route] of config.ingress_intent.route_rules.entries()) {
    const routePath = pointer("ingress_intent", "route_rules", index);
    if (!serviceIndex.all.has(route.service)) {
      diagnostic(
        diagnostics,
        "E_ROUTE_SERVICE_UNKNOWN",
        joinPointer(routePath, "service"),
        `route ${route.name} references unknown service ${route.service}`,
      );
    }
    if (!route.host_label && !config.access_intent.host_labels[route.service]) {
      diagnostic(
        diagnostics,
        "E_ROUTE_HOST_LABEL_MISSING",
        joinPointer(routePath, "host_label"),
        `route ${route.name} requires a route host_label or service host label`,
      );
    }
    if (!routeNames.has(route.name)) {
      routeNames.set(route.name, []);
    }
    routeNames.get(route.name).push(index);
  }

  for (const [routeName, indexes] of routeNames.entries()) {
    if (indexes.length > 1) {
      diagnostic(
        diagnostics,
        "E_ROUTE_DUPLICATE_NAME",
        "/ingress_intent/route_rules",
        `route name ${routeName} appears more than once`,
      );
    }
  }
}

function validateWanOverrides(config, externalKubernetesServices, diagnostics) {
  for (const [serviceName, origin] of Object.entries(config.ingress_intent.wan_origin_overrides)) {
    if (!externalKubernetesServices.has(serviceName)) {
      diagnostic(
        diagnostics,
        "E_WAN_OVERRIDE_SERVICE_INVALID",
        pointer("ingress_intent", "wan_origin_overrides", serviceName),
        `WAN origin override for ${serviceName} must target an externally exposed kubernetes service`,
      );
    }
    if (origin === "home_direct" && !siteWithPurposeAndWanIp(config, "home_lan_and_media_site")) {
      diagnostic(
        diagnostics,
        "E_WAN_HOME_SITE_MISSING",
        pointer("ingress_intent", "wan_origin_overrides", serviceName),
        "home_direct WAN origin requires a home_lan_and_media_site with wan_public_ip",
      );
    }
    if (origin === "edge_direct" && !siteWithPurposeAndWanIp(config, "primary_cluster_site")) {
      diagnostic(
        diagnostics,
        "E_WAN_EDGE_SITE_MISSING",
        pointer("ingress_intent", "wan_origin_overrides", serviceName),
        "edge_direct WAN origin requires a primary_cluster_site with wan_public_ip",
      );
    }
  }
}

function validateLanExposure(config, exposureIndex, diagnostics) {
  if (exposureIndex.lan.size === 0) return;

  const hasLanIngressSite = Object.values(config.sites).some((site) => site.networking?.lan_ingress_ip);
  if (!hasLanIngressSite) {
    diagnostic(
      diagnostics,
      "E_LAN_INGRESS_SITE_MISSING",
      "/sites",
      "LAN exposure requires at least one site with networking.lan_ingress_ip",
    );
  }

  const hasLanIngressNode = Object.values(config.nodes).some(
    (node) => node.status === "active" && node.capabilities.includes("lan-ingress"),
  );
  if (!hasLanIngressNode) {
    diagnostic(
      diagnostics,
      "E_LAN_INGRESS_NODE_MISSING",
      "/nodes",
      "LAN exposure requires at least one active node with lan-ingress capability",
    );
  }
}

function validateMonitoring(config, serviceIndex, exposureIndex, diagnostics) {
  const externalKubernetesServices = intersect(exposureIndex.external, serviceIndex.kubernetes);

  for (const [serviceName, backend] of Object.entries(config.monitoring_intent.kubernetes_backends)) {
    if (!serviceIndex.kubernetes.has(serviceName)) {
      diagnostic(
        diagnostics,
        "E_MONITORING_BACKEND_SERVICE_UNKNOWN",
        pointer("monitoring_intent", "kubernetes_backends", serviceName),
        `monitoring backend for ${serviceName} references unknown kubernetes service`,
      );
    }
    if (externalKubernetesServices.has(serviceName)) {
      diagnostic(
        diagnostics,
        "E_MONITORING_BACKEND_DUPLICATES_INGRESS",
        pointer("monitoring_intent", "kubernetes_backends", serviceName),
        `monitoring backend for ${serviceName} duplicates an ingress backend`,
      );
    }
    if (backend.health?.probe_strategy && backend.health.probe_strategy !== "internal") {
      diagnostic(
        diagnostics,
        "E_MONITORING_PROBE_STRATEGY_INVALID",
        pointer("monitoring_intent", "kubernetes_backends", serviceName, "health", "probe_strategy"),
        `monitoring backend for ${serviceName} must use internal probe strategy`,
      );
    }
    validateBackendHealth(backend, pointer("monitoring_intent", "kubernetes_backends", serviceName), diagnostics);
  }
}

function validateBackendHealth(backend, basePath, diagnostics) {
  if (backend.health) {
    validateProbe(backend.health, joinPointer(basePath, "health"), diagnostics);
  }
  for (const [index, probe] of (backend.extra_probes ?? []).entries()) {
    validateProbe(probe, joinPointer(joinPointer(basePath, "extra_probes"), index), diagnostics);
  }
}

function validateProbe(probe, basePath, diagnostics) {
  const type = probe.type ?? "http";
  const path = probe.path ?? "/";
  if (type === "tcp") {
    if (path !== "/") {
      diagnostic(
        diagnostics,
        "E_TCP_PROBE_PATH_INVALID",
        joinPointer(basePath, "path"),
        "TCP probes must not set an HTTP path",
      );
    }
    if (probe.expected_status !== undefined) {
      diagnostic(
        diagnostics,
        "E_TCP_PROBE_STATUS_INVALID",
        joinPointer(basePath, "expected_status"),
        "TCP probes must not set expected_status",
      );
    }
  }
}

function validateImageMetadata(config, serviceIndex, diagnostics) {
  for (const [serviceName, workload] of Object.entries(config.image_metadata.workloads)) {
    const path = pointer("image_metadata", "workloads", serviceName);
    if (!serviceIndex.all.has(serviceName)) {
      diagnostic(
        diagnostics,
        "E_IMAGE_SERVICE_UNKNOWN",
        path,
        `image metadata references unknown service ${serviceName}`,
      );
    }
    if (workload.source === "third_party" && workload.update.eligible) {
      diagnostic(
        diagnostics,
        "E_IMAGE_THIRD_PARTY_AUTO_UPDATE",
        joinPointer(path, "update"),
        `third-party image ${serviceName} must not be marked auto-update eligible`,
      );
    }
    if (workload.tag !== "latest" && workload.update.strategy === "latest_tag") {
      diagnostic(
        diagnostics,
        "E_IMAGE_PINNED_LATEST_STRATEGY",
        joinPointer(path, "update", "strategy"),
        `pinned image ${serviceName}:${workload.tag} must not use latest_tag strategy`,
      );
    }
    if (workload.update.strategy === "latest_tag" && !workload.update.keel) {
      diagnostic(
        diagnostics,
        "E_IMAGE_KEEL_REQUIRED",
        joinPointer(path, "update", "keel"),
        `latest-tag image ${serviceName} must declare Keel metadata`,
      );
    }
    if (workload.update.strategy === "pinned" && workload.update.keel) {
      diagnostic(
        diagnostics,
        "E_IMAGE_PINNED_KEEL_METADATA",
        joinPointer(path, "update", "keel"),
        `pinned image ${serviceName} must not declare Keel rollout metadata`,
      );
    }
  }
}

function intersect(left, right) {
  return new Set([...left].filter((value) => right.has(value)));
}

function siteWithPurposeAndWanIp(config, purpose) {
  return Object.values(config.sites).some((site) => site.purpose === purpose && site.networking?.wan_public_ip);
}
