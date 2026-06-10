import {
  accessForService,
  adapterConfigMapName,
  adapterNamespace,
  exposureByService,
  fqdn,
  renderConfigMap,
  routeRules,
  serviceNamesWithIntent,
} from "./model.js";

export function renderEdgeCatalog(config) {
  const exposures = exposureByService(config);
  const services = serviceNamesWithIntent(config).map((serviceName) => {
    const entry = {
      name: serviceName,
      exposure: exposures.get(serviceName),
      access: accessForService(config, serviceName),
    };
    const hostLabel = config.access_intent.host_labels[serviceName];
    if (hostLabel) {
      entry.host = fqdn(hostLabel, config.cluster.public_domain);
    }
    return entry;
  });

  return renderConfigMap({
    name: adapterConfigMapName(config, "edge-catalog", "platform-edge-catalog"),
    namespace: adapterNamespace(config, "edge-catalog", config.ingress_intent.defaults.namespace),
    dataKey: "edge-catalog.yaml",
    document: {
      cluster: config.cluster.name,
      services,
    },
  });
}

export function renderEdgeRouteCatalog(config) {
  const routes = routeRules(config)
    .filter((route) => config.access_intent.host_labels[route.service] || route.host_label)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((route) => {
      const entry = {
        name: route.name,
        service: route.service,
        host: route.host,
        access: route.access,
      };
      copyList(entry, "path_prefixes", route.path_prefixes);
      copyList(entry, "exact_paths", route.exact_paths);
      copyList(entry, "excluded_path_prefixes", route.excluded_path_prefixes);
      copyList(entry, "excluded_paths", route.excluded_exact_paths);
      return entry;
    });

  return renderConfigMap({
    name: adapterConfigMapName(config, "edge-route-catalog", "platform-edge-route-catalog"),
    namespace: adapterNamespace(config, "edge-route-catalog", config.ingress_intent.defaults.namespace),
    dataKey: "edge-route-catalog.yaml",
    document: {
      cluster: config.cluster.name,
      routes,
    },
  });
}

function copyList(target, key, value) {
  if (value?.length > 0) {
    target[key] = [...value];
  }
}
