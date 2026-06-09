import {
  appPath,
  blueprintFiles,
  componentName,
  contextArtifacts,
  fluxFile,
  hasPack,
  packValue,
  platformFromContext,
  substitutePlaceholders,
  substitutionMap,
  yamlDocument,
} from "./flux-utils.js";

const sourceReleaseBlueprints = {
  "cert-manager": "packs/flux-core/cert-manager",
  "external-dns": "packs/flux-core/external-dns-cloudflare",
  "traefik-public": "packs/flux-core/traefik-public",
  "traefik-lan": "packs/flux-core/traefik-lan",
  metallb: "packs/flux-core/metallb",
  vso: "packs/flux-core/vso",
  rabbitmq: "packs/rabbitmq-data-service",
};

export function renderFluxSource(input) {
  const artifacts = contextArtifacts(input);
  const platform = platformFromContext(input);
  const substitutions = substitutionMap(input, input?.overrides?.["flux-source"]?.substitutions ?? {});
  const files = new Map();
  const addFile = (path, content) => files.set(path, fluxFile(path, content, "flux-source"));

  for (const packName of Object.keys(sourceReleaseBlueprints).filter((name) => hasPack(platform, name))) {
    const group = packName === "rabbitmq" ? "data" : "core";
    const component = packName === "rabbitmq" ? "rabbitmq" : componentName(platform, packName);
    copySourceRelease(input, sourceReleaseBlueprints[packName], appPath(input, group, component), substitutions, addFile);
  }

  if (hasPack(platform, "mariadb") || packValue(platform, "data", "mariadb") !== undefined) {
    addMariaDbSources(input, addFile);
    addFile(appPath(input, "data", "mariadb", "release.yaml"), renderMariaDbRelease(input));
  }

  for (const chart of declaredCharts(platform)) {
    addFile(appPath(input, chart.group, chart.name, "source.yaml"), renderSource(chart));
    addFile(appPath(input, chart.group, chart.name, "release.yaml"), renderHelmRelease(chart));
  }

  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function copySourceRelease(input, blueprintPath, outputRoot, substitutions, addFile) {
  for (const file of blueprintFiles(input, blueprintPath)) {
    if (!isSourceReleaseFile(file.relativePath)) continue;
    addFile(`${outputRoot}/${file.relativePath}`, substitutePlaceholders(file.content, substitutions));
  }
}

function isSourceReleaseFile(relativePath) {
  return relativePath === "source.yaml" || relativePath === "release.yaml";
}

function addMariaDbSources(input, addFile) {
  addFile(appPath(input, "data", "bitnami-source.yaml"), yamlDocument({
    apiVersion: "source.toolkit.fluxcd.io/v1",
    kind: "HelmRepository",
    metadata: {
      name: "bitnami",
      namespace: "data-system",
    },
    spec: {
      interval: "1h",
      url: "https://charts.bitnami.com/bitnami",
    },
  }));
  addFile(appPath(input, "data", "bitnami-oci-source.yaml"), yamlDocument({
    apiVersion: "source.toolkit.fluxcd.io/v1",
    kind: "HelmRepository",
    metadata: {
      name: "bitnami-oci",
      namespace: "data-system",
    },
    spec: {
      type: "oci",
      interval: "1h",
      url: "oci://registry-1.docker.io/bitnamicharts",
    },
  }));
}

function renderMariaDbRelease(input) {
  const declaration = packValue(platformFromContext(input), "data", "mariadb");
  const values = declaration && typeof declaration === "object" ? declaration.values ?? {} : {};
  return yamlDocument({
    apiVersion: "helm.toolkit.fluxcd.io/v2",
    kind: "HelmRelease",
    metadata: {
      name: "mariadb",
      namespace: "data-system",
    },
    spec: {
      interval: declaration?.interval ?? "30m",
      install: { remediation: { retries: -1 } },
      upgrade: { remediation: { retries: -1 } },
      chart: {
        spec: {
          chart: declaration?.chart?.name ?? "mariadb",
          version: declaration?.chart?.version ?? "18.x",
          sourceRef: {
            kind: "HelmRepository",
            name: declaration?.chart?.sourceRef ?? "bitnami",
            namespace: "data-system",
          },
        },
      },
      values: {
        auth: {
          database: values.database ?? "app",
          username: values.username ?? "app",
          existingSecret: values.existingSecret ?? "mariadb-credentials",
        },
        primary: {
          persistence: {
            enabled: true,
            size: values.storageSize ?? "10Gi",
          },
        },
        secondary: {
          replicaCount: values.secondaryReplicaCount ?? 0,
        },
      },
    },
  });
}

function declaredCharts(platform) {
  const packs = platform.packs ?? {};
  return Object.entries(packs).flatMap(([group, value]) => collectCharts(group, value));
}

function collectCharts(group, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([name, declaration]) => {
    if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) return [];
    if (name === "mariadb" || name === "rabbitmq") return [];
    if (declaration.chart || declaration.source) {
      return [normalizeChart(group, name, declaration)];
    }
    return collectCharts(name, declaration);
  });
}

function normalizeChart(group, name, declaration) {
  const source = declaration.source ?? {};
  return {
    group: group.replaceAll("_", "-"),
    name,
    namespace: declaration.namespace ?? `${group.replaceAll("_", "-")}-system`,
    interval: declaration.interval ?? "30m",
    chart: {
      name: declaration.chart?.name ?? name,
      version: declaration.chart?.version ?? "*",
    },
    source: {
      kind: source.kind ?? "HelmRepository",
      apiVersion: sourceApiVersion(source.kind ?? "HelmRepository"),
      name: source.name ?? `${name}-source`,
      namespace: source.namespace,
      interval: source.interval ?? "1h",
      url: source.url ?? declaration.chart?.repository,
      type: source.type,
      ref: source.ref,
    },
    values: declaration.values ?? {},
  };
}

function renderSource(chart) {
  const spec = {
    interval: chart.source.interval,
  };
  if (chart.source.url) spec.url = chart.source.url;
  if (chart.source.type) spec.type = chart.source.type;
  if (chart.source.ref) spec.ref = chart.source.ref;
  return yamlDocument({
    apiVersion: chart.source.apiVersion,
    kind: chart.source.kind,
    metadata: {
      name: chart.source.name,
      namespace: chart.source.namespace ?? chart.namespace,
    },
    spec,
  });
}

function renderHelmRelease(chart) {
  return yamlDocument({
    apiVersion: "helm.toolkit.fluxcd.io/v2",
    kind: "HelmRelease",
    metadata: {
      name: chart.name,
      namespace: chart.namespace,
    },
    spec: {
      interval: chart.interval,
      chart: {
        spec: {
          chart: chart.chart.name,
          version: chart.chart.version,
          sourceRef: {
            kind: chart.source.kind,
            name: chart.source.name,
            namespace: chart.source.namespace ?? chart.namespace,
          },
        },
      },
      values: chart.values,
    },
  });
}

function sourceApiVersion(kind) {
  if (kind === "GitRepository" || kind === "OCIRepository") return "source.toolkit.fluxcd.io/v1";
  return "source.toolkit.fluxcd.io/v1";
}
