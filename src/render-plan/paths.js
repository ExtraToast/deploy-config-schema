import { posix } from "node:path";

export function createPathAllocator(options = {}) {
  const gitopsRoot = trimSlashes(options.gitopsRoot ?? "platform/cluster/flux");
  const environment = options.environment ?? "production";
  const appsRoot = posix.join(gitopsRoot, "apps");
  const gatusGroup = options.gatusGroup ?? "utility-system";

  return Object.freeze({
    gitopsRoot,
    environment,
    appsRoot,
    clusterRoot: posix.join(gitopsRoot, "clusters", environment),
    existingAdapterPath(adapterName) {
      const known = {
        "edge-catalog": posix.join(appsRoot, "edge", "edge-catalog-configmap.yaml"),
        "edge-route-catalog": posix.join(appsRoot, "edge", "edge-route-catalog-configmap.yaml"),
        gatus: posix.join(appsRoot, gatusGroup, "gatus", "gatus-endpoints-configmap.yaml"),
        "image-metadata": posix.join(appsRoot, "edge", "image-metadata.yaml"),
        "traefik-lan": posix.join(appsRoot, "edge", "traefik-lan-ingressroutes.yaml"),
        "traefik-public": posix.join(appsRoot, "edge", "traefik-ingressroutes.yaml")
      };
      return known[adapterName];
    }
  });
}

export function safeRelativePath(path) {
  const normalized = posix.normalize(path.replaceAll("\\", "/"));
  if (normalized.startsWith("../") || normalized === ".." || posix.isAbsolute(normalized)) {
    throw new Error(`unsafe output path: ${path}`);
  }
  return normalized;
}

function trimSlashes(path) {
  return safeRelativePath(path).replace(/\/+$/, "");
}
