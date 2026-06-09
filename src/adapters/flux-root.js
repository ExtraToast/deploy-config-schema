import { posix } from "node:path";
import {
  clusterPath,
  contextArtifacts,
  deployConfigFromContext,
  environment,
  fluxFile,
  fluxInterval,
  gitopsRoot,
  hasPack,
  hasServiceGroup,
  packValue,
  serviceHasDataDependency,
  serviceHasRoute,
  serviceUsesSecrets,
  servicesInGroup,
  yamlDocument,
  yamlDocuments,
} from "./flux-utils.js";

export function renderFluxRoot(input) {
  const artifacts = contextArtifacts(input);
  const layers = inferFluxLayers(input);
  return [
    fluxFile(clusterPath(input, "kustomization.yaml"), renderClusterKustomization(), "flux-root"),
    fluxFile(clusterPath(input, "kustomizations.yaml"), renderLayerKustomizations(input, layers), "flux-root"),
  ];
}

export function inferFluxLayers(input) {
  const artifacts = contextArtifacts(input);
  const platform = artifacts.platform ?? {};
  const explicitLayers = input?.overrides?.["flux-root"]?.layers ?? platform.gitops?.layers;
  if (explicitLayers) return normalizeExplicitLayers(input, explicitLayers);

  const layers = [];
  const add = (name, options = {}) => {
    if (!layers.some((layer) => layer.name === name)) {
      layers.push(layer(name, options));
    }
  };

  add("apps-core", { wait: true, timeout: "15m" });
  if (hasPack(platform, "vso") || Object.keys(artifacts["vault-dynamic-secrets"]?.vault?.vso?.static_syncs ?? {}).length > 0) {
    add("apps-vso-secrets", { dependsOn: ["apps-core"] });
  }
  if (hasPack(platform, "metallb")) add("apps-metallb-config", { dependsOn: ["apps-core"] });
  if (shouldRenderEdge(artifacts)) add("apps-edge", { dependsOn: ["apps-core"] });
  if (shouldRenderData(artifacts, platform)) {
    add("apps-data", { dependsOn: ["apps-core"], wait: hasPack(platform, "mariadb", "rabbitmq") || hasDataChart(platform), timeout: "15m" });
  }
  if (hasServiceGroup(artifacts, "mail")) {
    add("apps-mail", { dependsOn: ["apps-core", ...(hasLayer(layers, "apps-vso-secrets") ? ["apps-vso-secrets"] : [])] });
  }
  if (shouldRenderObservability(platform)) {
    add("apps-observability", {
      dependsOn: ["apps-core"],
      timeout: "15m",
      healthChecks: observabilityHealthChecks(platform),
    });
  }
  if (shouldRenderGrafanaDashboards(platform)) {
    add("apps-grafana-dashboards", { dependsOn: ["apps-observability"] });
  }
  for (const group of serviceLayerGroups(artifacts)) {
    add(`apps-${group}`, { dependsOn: serviceGroupDependencies(artifacts, layers, group) });
  }
  if (shouldRenderUtility(platform, artifacts)) {
    add("apps-utility-system", { dependsOn: utilityDependencies(platform, artifacts, layers) });
  }

  return layers;
}

function renderClusterKustomization() {
  return [
    "apiVersion: kustomize.config.k8s.io/v1beta1",
    "kind: Kustomization",
    "resources:",
    "  - flux-system",
    "  - kustomizations.yaml",
  ].join("\n");
}

function renderLayerKustomizations(input, layers) {
  const interval = fluxInterval(input);
  const root = gitopsRoot(input);
  return yamlDocuments(layers.map((entry) => {
    const spec = {
      interval,
      path: `./${posix.join(root, "apps", entry.appPath)}`,
      prune: true,
    };
    if (entry.wait) spec.wait = true;
    if (entry.timeout) spec.timeout = entry.timeout;
    if (entry.healthChecks.length > 0) spec.healthChecks = entry.healthChecks;
    if (entry.dependsOn.length > 0) spec.dependsOn = entry.dependsOn.map((name) => ({ name }));
    spec.sourceRef = { kind: "GitRepository", name: "flux-system" };
    return {
      apiVersion: "kustomize.toolkit.fluxcd.io/v1",
      kind: "Kustomization",
      metadata: {
        name: entry.name,
        namespace: "flux-system",
      },
      spec,
    };
  }));
}

function normalizeExplicitLayers(input, explicitLayers) {
  const list = Array.isArray(explicitLayers)
    ? explicitLayers.map((entry) => typeof entry === "string" ? { name: entry } : entry)
    : Object.entries(explicitLayers).map(([name, value]) => ({ name, ...value }));
  return list.map((entry) => layer(entry.name, {
    appPath: entry.appPath,
    dependsOn: entry.dependsOn,
    wait: entry.wait,
    timeout: entry.timeout,
    healthChecks: entry.healthChecks,
  }));
}

function layer(name, options = {}) {
  return {
    name,
    appPath: options.appPath ?? name.replace(/^apps-/, ""),
    dependsOn: [...new Set(options.dependsOn ?? [])].sort(),
    wait: options.wait === true,
    timeout: options.timeout,
    healthChecks: [...(options.healthChecks ?? [])],
  };
}

function shouldRenderEdge(artifacts) {
  const config = deployConfigFromContext({ artifacts });
  return Object.keys(config?.ingress_intent?.kubernetes_backends ?? {}).length > 0
    || (config?.adapter_output_intent?.adapters ?? []).some((adapter) => adapter.startsWith("traefik") || adapter.startsWith("edge-"));
}

function shouldRenderData(artifacts, platform) {
  const serviceNames = Object.values(artifacts["deploy-config"]?.service_intent?.kubernetes ?? {}).flat();
  return hasServiceGroup(artifacts, "data")
    || hasPack(platform, "data", "mariadb", "rabbitmq")
    || hasDataChart(platform)
    || serviceNames.some((name) => serviceHasDataDependency(artifacts, name));
}

function hasDataChart(platform) {
  const data = platform.packs?.data;
  return Boolean(data && typeof data === "object" && Object.values(data).some((value) => value && typeof value === "object"));
}

function shouldRenderObservability(platform) {
  return packValue(platform, "observability") !== undefined;
}

function shouldRenderGrafanaDashboards(platform) {
  const observability = packValue(platform, "observability");
  return Boolean(observability && typeof observability === "object" && (observability.grafana || observability.dashboards || observability.stack));
}

function shouldRenderUtility(platform, artifacts) {
  return packValue(platform, "utility") !== undefined || hasServiceGroup(artifacts, "utility-system");
}

function serviceLayerGroups(artifacts) {
  return Object.keys(artifacts["deploy-config"]?.service_intent?.kubernetes ?? {})
    .map((group) => group.replaceAll("_", "-"))
    .filter((group) => !["core", "data", "mail", "utility-system"].includes(group))
    .sort();
}

function serviceGroupDependencies(artifacts, layers, group) {
  if (group !== "stateless") return ["apps-core"];
  const serviceNames = servicesInGroup(artifacts, group);
  return [
    "apps-core",
    ...(hasLayer(layers, "apps-data") && serviceNames.some((name) => serviceHasDataDependency(artifacts, name)) ? ["apps-data"] : []),
    ...(hasLayer(layers, "apps-vso-secrets") && serviceNames.some((name) => serviceUsesSecrets(artifacts, name)) ? ["apps-vso-secrets"] : []),
    ...(hasLayer(layers, "apps-edge") && serviceNames.some((name) => serviceHasRoute(artifacts, name)) ? ["apps-edge"] : []),
  ];
}

function utilityDependencies(platform, artifacts, layers) {
  return [
    "apps-core",
    ...(hasLayer(layers, "apps-data") && (hasServiceGroup(artifacts, "utility-system") || hasPack(platform, "headlamp")) ? ["apps-data"] : []),
  ];
}

function observabilityHealthChecks(platform) {
  const observability = packValue(platform, "observability");
  if (!observability || observability === true || observability.gatus === true) return [];
  return ["alloy", "grafana", "grafana-operator", "loki", "metrics-stack", "tempo"].map((name) => ({
    apiVersion: "helm.toolkit.fluxcd.io/v2",
    kind: "HelmRelease",
    name,
    namespace: "observability",
  }));
}

function hasLayer(layers, name) {
  return layers.some((entry) => entry.name === name);
}

export function renderFluxRootLayerGraph(input) {
  return yamlDocument({
    layers: inferFluxLayers(input).map(({ name, appPath, dependsOn }) => ({ name, path: appPath, dependsOn })),
    environment: environment(input),
  });
}
