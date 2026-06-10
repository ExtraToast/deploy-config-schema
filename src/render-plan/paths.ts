import { posix } from "node:path";

export type PathAllocatorOptions = {
  gitopsRoot?: string;
  environment?: string;
  gatusGroup?: string;
};

export type PathAllocator = Readonly<{
  gitopsRoot: string;
  environment: string;
  appsRoot: string;
  clusterRoot: string;
  existingAdapterPath(adapterName: string): string | undefined;
}>;

export function createPathAllocator(options: PathAllocatorOptions = {}): PathAllocator {
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
      const known: Record<string, string> = {
        "edge-catalog": posix.join(appsRoot, "edge", "edge-catalog-configmap.yaml"),
        "edge-route-catalog": posix.join(appsRoot, "edge", "edge-route-catalog-configmap.yaml"),
        gatus: posix.join(appsRoot, gatusGroup, "gatus", "gatus-endpoints-configmap.yaml"),
        "image-metadata": posix.join(appsRoot, "edge", "image-metadata.yaml"),
        kubernetes: appsRoot,
        "nix-hosts": "platform",
        "traefik-lan": posix.join(appsRoot, "edge", "traefik-lan-ingressroutes.yaml"),
        "traefik-public": posix.join(appsRoot, "edge", "traefik-ingressroutes.yaml"),
        vso: posix.join(appsRoot, "vso-secrets")
      };
      return known[adapterName];
    }
  });
}

export function safeRelativePath(path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/"));
  if (normalized.startsWith("../") || normalized === ".." || posix.isAbsolute(normalized)) {
    throw new Error(`unsafe output path: ${path}`);
  }
  return normalized;
}

function trimSlashes(path: string): string {
  return safeRelativePath(path).replace(/\/+$/, "");
}
