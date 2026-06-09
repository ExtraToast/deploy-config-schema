import { posix } from "node:path";
import YAML from "yaml";
import {
  appPath,
  blueprintFiles,
  componentName,
  contextArtifacts,
  fluxFile,
  groupKustomization,
  hasPack,
  packValue,
  platformFromContext,
  servicesInGroup,
  substitutePlaceholders,
  substitutionMap,
  yamlDocument,
} from "./flux-utils.js";

const corePackBlueprints = {
  "cert-manager": "packs/flux-core/cert-manager",
  "external-dns": "packs/flux-core/external-dns-cloudflare",
  "traefik-public": "packs/flux-core/traefik-public",
  "traefik-lan": "packs/flux-core/traefik-lan",
  metallb: "packs/flux-core/metallb",
  vso: "packs/flux-core/vso",
};

export function renderFluxPacks(input) {
  const artifacts = contextArtifacts(input);
  const platform = platformFromContext(input);
  const substitutions = substitutionMap(input, input?.overrides?.["flux-packs"]?.substitutions ?? {});
  const files = new Map();
  const groupResources = new Map();

  const addFile = (path, content) => {
    files.set(path, fluxFile(path, content, "flux-packs"));
  };
  const addResource = (group, resource) => {
    if (!groupResources.has(group)) groupResources.set(group, new Set());
    groupResources.get(group).add(resource);
  };

  for (const packName of selectedCorePacks(platform)) {
    const component = componentName(platform, packName);
    copyBlueprint(input, corePackBlueprints[packName], appPath(input, "core", component), substitutions, {
      skipSourceRelease: true,
      skipFiles: packName === "metallb" ? ["address-pool.yaml"] : [],
      addFile,
    });
    addResource("core", component);
  }
  if (hasPack(platform, "metallb")) {
    copyBlueprint(input, "packs/flux-core/metallb", appPath(input, "metallb-config"), substitutions, {
      onlyFiles: ["address-pool.yaml"],
      outputNames: { "address-pool.yaml": "config.yaml" },
      addFile,
    });
    addFile(appPath(input, "metallb-config", "kustomization.yaml"), groupKustomization(["config.yaml"]));
  }

  if (shouldRenderEdgePack(platform, artifacts)) {
    copyBlueprint(input, "packs/edge", appPath(input, "edge"), substitutions, { addFile });
  }
  if (packValue(platform, "edgeMiddleware") !== undefined || packValue(platform, "edge", "middleware") !== undefined) {
    copyBlueprint(input, "packs/edge-middleware", appPath(input, "edge"), substitutions, {
      addFile,
      mergeKustomizationResources: ["cluster-issuer-cloudflare.yaml", "traefik-default-tls.yaml", "traefik-forward-auth-middleware.yaml"],
    });
  }

  if (packValue(platform, "observability") !== undefined) {
    copyBlueprint(input, "packs/observability", appPath(input, "observability"), substitutions, {
      skipSourceRelease: true,
      addFile,
      transform: transformGatusKustomization,
    });
  }
  if (packValue(platform, "utility", "gatus") !== undefined || packValue(platform, "utility")?.gatus !== undefined) {
    copyBlueprint(input, "packs/observability/gatus", appPath(input, "utility-system", "gatus"), substitutions, {
      addFile,
      transform: transformGatusKustomization,
    });
    addResource("utility-system", "gatus");
  }

  if (hasPack(platform, "rabbitmq")) {
    copyBlueprint(input, "packs/rabbitmq-data-service", appPath(input, "data", "rabbitmq"), substitutions, {
      skipSourceRelease: true,
      addFile,
    });
    addResource("data", "rabbitmq");
  }

  if (hasPack(platform, "mariadb") || packValue(platform, "data", "mariadb") !== undefined) {
    addDataNamespace(input, addFile);
    addFile(appPath(input, "data", "mariadb", "kustomization.yaml"), groupKustomization(["release.yaml", ...(hasMariadbSecret(artifacts) ? ["credentials-vss.yaml"] : [])]));
    if (hasMariadbSecret(artifacts)) {
      addFile(appPath(input, "data", "mariadb", "credentials-vss.yaml"), renderMariaDbCredentials(input));
    }
    addResource("data", "mariadb");
    addResource("data", "namespace.yaml");
    addResource("data", "bitnami-source.yaml");
    addResource("data", "bitnami-oci-source.yaml");
  }

  for (const group of serviceGroupsNeedingKustomization(artifacts)) {
    for (const serviceName of servicesInGroup(artifacts, group)) {
      addResource(group, serviceName);
    }
  }

  for (const [group, resources] of groupResources) {
    const path = appPath(input, group, "kustomization.yaml");
    if (!files.has(path)) addFile(path, groupKustomization([...resources]));
  }

  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function selectedCorePacks(platform) {
  return Object.keys(corePackBlueprints).filter((packName) => hasPack(platform, packName));
}

function shouldRenderEdgePack(platform, artifacts) {
  return packValue(platform, "edge") !== undefined
    || Object.keys(artifacts["deploy-config"]?.ingress_intent?.kubernetes_backends ?? {}).length > 0;
}

function copyBlueprint(input, blueprintPath, outputRoot, substitutions, options) {
  const sourceFiles = blueprintFiles(input, blueprintPath);
  for (const file of sourceFiles) {
    if (options.onlyFiles && !options.onlyFiles.includes(file.relativePath)) continue;
    if ((options.skipFiles ?? []).includes(file.relativePath)) continue;
    if (isEndpointPlaceholder(file.relativePath)) continue;
    if (options.skipSourceRelease && isSourceOrRelease(file.relativePath)) continue;
    const relativePath = options.outputNames?.[file.relativePath] ?? outputRelativePath(file.relativePath);
    const outputPath = posix.join(outputRoot, relativePath);
    const merged = mergeGroupKustomization(file.content, options.mergeKustomizationResources);
    const transformed = options.transform ? options.transform(relativePath, merged) : merged;
    options.addFile(outputPath, substitutePlaceholders(transformed, substitutions));
  }
}

function outputRelativePath(relativePath) {
  if (relativePath === "endpoints-placeholder.yaml") return "gatus-endpoints-configmap.yaml";
  if (relativePath.endsWith("/endpoints-placeholder.yaml")) return relativePath.replace(/endpoints-placeholder\.yaml$/, "gatus-endpoints-configmap.yaml");
  return relativePath;
}

function isSourceOrRelease(relativePath) {
  return relativePath === "source.yaml"
    || relativePath === "release.yaml"
    || relativePath === "helm-repositories.yaml"
    || relativePath.endsWith("/source.yaml")
    || relativePath.endsWith("/release.yaml");
}

function isEndpointPlaceholder(relativePath) {
  return relativePath === "endpoints-placeholder.yaml" || relativePath.endsWith("/endpoints-placeholder.yaml");
}

function mergeGroupKustomization(content, additionalResources = []) {
  if (additionalResources.length === 0) return content;
  const doc = YAMLParse(content);
  if (doc?.kind !== "Kustomization") return content;
  doc.resources = [...new Set([...(doc.resources ?? []), ...additionalResources])].sort();
  return yamlDocument(doc);
}

function transformGatusKustomization(relativePath, content) {
  if (relativePath !== "kustomization.yaml" && relativePath !== "gatus/kustomization.yaml") return content;
  const doc = YAMLParse(content);
  if (doc?.kind !== "Kustomization") return content;
  doc.resources = (doc.resources ?? []).map((resource) => resource === "endpoints-placeholder.yaml" ? "gatus-endpoints-configmap.yaml" : resource);
  return yamlDocument(doc);
}

function YAMLParse(content) {
  try {
    return YAML.parse(content);
  } catch {
    return undefined;
  }
}

function addDataNamespace(input, addFile) {
  addFile(appPath(input, "data", "namespace.yaml"), yamlDocument({
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name: "data-system" },
  }));
}

function hasMariadbSecret(artifacts) {
  return Object.keys(artifacts["vault-dynamic-secrets"]?.vault?.vso?.static_syncs ?? {}).some((name) => name.includes("mariadb"));
}

function renderMariaDbCredentials(input) {
  return yamlDocument({
    apiVersion: "secrets.hashicorp.com/v1beta1",
    kind: "VaultStaticSecret",
    metadata: {
      name: "mariadb-credentials",
      namespace: "data-system",
    },
    spec: {
      type: "kv-v2",
      mount: "secret",
      path: `${platformFromContext(input).name ?? "platform"}/mariadb`,
      destination: {
        name: "mariadb-credentials",
        create: true,
      },
      refreshAfter: "1h",
      vaultAuthRef: "default",
    },
  });
}

function serviceGroupsNeedingKustomization(artifacts) {
  return Object.keys(artifacts["deploy-config"]?.service_intent?.kubernetes ?? {})
    .map((group) => group.replaceAll("_", "-"))
    .filter((group) => !["data", "core"].includes(group));
}
