import YAML from "yaml";

export function exposureByService(config) {
  const exposures = new Map();
  for (const exposureClass of ["public", "public_and_lan", "internal_only", "lan_only"]) {
    for (const serviceName of config.exposure_intent[exposureClass]) {
      exposures.set(serviceName, exposureClass);
    }
  }
  return exposures;
}

export function groupByService(config) {
  const groups = new Map();
  for (const [groupName, serviceNames] of Object.entries(config.service_intent.kubernetes)) {
    for (const serviceName of serviceNames) {
      groups.set(serviceName, groupName.replaceAll("_", "-"));
    }
  }
  return groups;
}

export function serviceNamesWithIntent(config) {
  return [...exposureByService(config).keys()].sort();
}

export function accessForService(config, serviceName) {
  const exposure = exposureByService(config).get(serviceName);
  if (config.access_intent.sso_protected.includes(serviceName)) {
    return "sso_protected";
  }
  if (exposure === "internal_only") {
    return "cluster_internal";
  }
  return "direct";
}

export function resolveRouteAccess(config, route) {
  return route.access ?? accessForService(config, route.service);
}

export function routeRules(config) {
  const rules = config.ingress_intent.route_rules.length > 0
    ? config.ingress_intent.route_rules
    : Object.keys(config.access_intent.host_labels)
      .sort()
      .map((service) => ({ name: service, service }));

  return rules.map((route) => ({
    ...route,
    access: resolveRouteAccess(config, route),
    host: fqdn(route.host_label ?? config.access_intent.host_labels[route.service], config.cluster.public_domain),
  }));
}

export function fqdn(hostLabel, publicDomain) {
  return hostLabel === "root" ? publicDomain : `${hostLabel}.${publicDomain}`;
}

export function renderConfigMap({ name, namespace, dataKey, document }) {
  const body = YAML.stringify(document, {
    indent: 2,
    lineWidth: 0,
    sortMapEntries: false,
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

export function adapterNamespace(config, adapter, fallback) {
  return config.adapter_output_intent.namespaces?.[adapter] ?? fallback;
}

export function adapterConfigMapName(config, adapter, fallback) {
  return config.adapter_output_intent.configmap_names?.[adapter] ?? fallback;
}
