import {
  adapterConfigMapName,
  adapterNamespace,
  exposureByService,
  fqdn,
  groupByService,
  renderConfigMap,
} from "./model.js";

export function renderGatus(config) {
  const groups = groupByService(config);
  const exposures = exposureByService(config);
  const endpoints = [
    ...backendEntries(config.ingress_intent.kubernetes_backends, (serviceName, backend) => {
      const group = groups.get(serviceName) ?? "unspecified";
      const health = backend.health ?? {};
      const strategy = resolveProbeStrategy(config, serviceName, health, exposures.get(serviceName));
      const hostLabel = config.access_intent.host_labels[serviceName];
      const host = hostLabel ? fqdn(hostLabel, config.cluster.public_domain) : undefined;
      const serviceEndpoints = [];

      if (["internal", "both"].includes(strategy)) {
        serviceEndpoints.push(endpoint(serviceName, group, internalUrl(backend, health), health, strategy === "both" ? " (internal)" : ""));
      }
      if (["external", "both"].includes(strategy) && host) {
        serviceEndpoints.push(endpoint(serviceName, group, externalUrl(host, health), health, strategy === "both" ? " (external)" : ""));
      }
      serviceEndpoints.push(...extraProbeEndpoints(serviceName, group, backend));
      return serviceEndpoints;
    }),
    ...backendEntries(config.monitoring_intent.kubernetes_backends, (serviceName, backend) => {
      const group = groups.get(serviceName) ?? "unspecified";
      const health = backend.health ?? {};
      return [
        endpoint(serviceName, group, internalUrl(backend, health), health, ""),
        ...extraProbeEndpoints(serviceName, group, backend),
      ];
    }),
  ].sort((left, right) => {
    const groupCompare = left.group.localeCompare(right.group);
    if (groupCompare !== 0) return groupCompare;
    return left.name.localeCompare(right.name);
  });

  return renderConfigMap({
    name: adapterConfigMapName(config, "gatus", "gatus-endpoints"),
    namespace: adapterNamespace(config, "gatus", "observability"),
    dataKey: "endpoints.yaml",
    document: { endpoints },
  });
}

function backendEntries(backends, mapper) {
  return Object.entries(backends).flatMap(([serviceName, backend]) => mapper(serviceName, backend));
}

function resolveProbeStrategy(config, serviceName, health, exposure) {
  if (health.probe_strategy) return health.probe_strategy;
  if ((health.type ?? "http") === "tcp") return "internal";
  if (config.access_intent.sso_protected.includes(serviceName)) return "internal";
  return ["public", "public_and_lan"].includes(exposure) ? "external" : "internal";
}

function internalUrl(backend, health) {
  const type = health.type ?? "http";
  const port = health.port ?? backend.port;
  const host = `${backend.service}.${backend.namespace}.svc.cluster.local`;
  if (type === "tcp") {
    return `tcp://${host}:${port}`;
  }
  return `http://${host}:${port}${health.path ?? "/"}`;
}

function externalUrl(host, health) {
  return `https://${host}${health.path ?? "/"}`;
}

function extraProbeEndpoints(serviceName, parentGroup, backend) {
  return (backend.extra_probes ?? []).map((probe) => endpoint(
    `${serviceName}-${probe.name}`,
    probe.group ?? parentGroup,
    internalUrl(backend, {
      type: probe.type ?? "tcp",
      path: probe.path ?? "/",
      port: probe.port,
      expected_status: probe.expected_status,
      response_time_ms: probe.response_time_ms,
    }),
    probe,
    "",
  ));
}

function endpoint(baseName, group, url, health, suffix) {
  const type = health.type ?? "http";
  return {
    name: `${baseName}${suffix}`,
    group,
    url,
    interval: "60s",
    conditions: type === "tcp"
      ? ["[CONNECTED] == true"]
      : [`[STATUS] == ${health.expected_status ?? 200}`, `[RESPONSE_TIME] < ${health.response_time_ms ?? 1500}`],
  };
}
