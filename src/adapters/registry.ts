import { renderEdgeCatalog, renderEdgeRouteCatalog } from "./catalog.js";
import { renderFluxPacks } from "./flux-packs.js";
import { renderFluxRoot } from "./flux-root.js";
import { renderFluxSource } from "./flux-source.js";
import { renderGatus } from "./gatus.js";
import { renderImageMetadata } from "./image-metadata.js";
import { renderKubernetes } from "./kubernetes.js";
import { renderNixHosts } from "./nix-hosts.js";
import { renderTraefik } from "./traefik.js";
import { renderVso } from "./vso.js";
import type { AdapterContext, DeployConfig, RenderResult } from "./model.js";

type AdapterTarget = "edge" | "kubernetes" | "nix" | "vault" | "flux";
type AdapterInput = "deploy-config" | "canonical-artifacts";
type AdapterStatus = "implemented";
export type AdapterDefinition = {
  name: string;
  target: AdapterTarget;
  input: AdapterInput;
  status: AdapterStatus;
  defaultPath: string;
  // Registry entries are intentionally heterogeneous: single-artifact adapters
  // receive DeployConfig, while tree adapters receive an adapter context.
  render: (input: never) => RenderResult;
};
type ListOptions = { target?: string };

const adapterDefinitions = new Map<string, Readonly<AdapterDefinition>>();

registerAdapter({
  name: "traefik-public",
  target: "edge",
  input: "deploy-config",
  status: "implemented",
  defaultPath: "platform/cluster/flux/apps/edge/traefik-ingressroutes.yaml",
  render(config) {
    return renderTraefik(config, "traefik-public");
  },
});

registerAdapter({
  name: "traefik-lan",
  target: "edge",
  input: "deploy-config",
  status: "implemented",
  defaultPath: "platform/cluster/flux/apps/edge/traefik-lan-ingressroutes.yaml",
  render(config) {
    return renderTraefik(config, "traefik-lan");
  },
});

registerAdapter({
  name: "gatus",
  target: "edge",
  input: "deploy-config",
  status: "implemented",
  defaultPath: "platform/cluster/flux/apps/utility-system/gatus/gatus-endpoints-configmap.yaml",
  render: renderGatus,
});

registerAdapter({
  name: "edge-catalog",
  target: "edge",
  input: "deploy-config",
  status: "implemented",
  defaultPath: "platform/cluster/flux/apps/edge/edge-catalog-configmap.yaml",
  render: renderEdgeCatalog,
});

registerAdapter({
  name: "edge-route-catalog",
  target: "edge",
  input: "deploy-config",
  status: "implemented",
  defaultPath: "platform/cluster/flux/apps/edge/edge-route-catalog-configmap.yaml",
  render: renderEdgeRouteCatalog,
});

registerAdapter({
  name: "image-metadata",
  target: "edge",
  input: "deploy-config",
  status: "implemented",
  defaultPath: "platform/cluster/flux/apps/edge/image-metadata.yaml",
  render: renderImageMetadata,
});

registerAdapter({
  name: "kubernetes",
  target: "kubernetes",
  input: "canonical-artifacts",
  status: "implemented",
  defaultPath: "platform/cluster/flux/apps",
  render: renderKubernetes,
});

registerAdapter({
  name: "nix-hosts",
  target: "nix",
  input: "canonical-artifacts",
  status: "implemented",
  defaultPath: "platform",
  render: renderNixHosts,
});

registerAdapter({
  name: "vso",
  target: "vault",
  input: "canonical-artifacts",
  status: "implemented",
  defaultPath: "platform/cluster/flux/apps/vso-secrets",
  render: renderVso,
});

registerAdapter({
  name: "flux-root",
  target: "flux",
  input: "canonical-artifacts",
  status: "implemented",
  defaultPath: "platform/cluster/flux/clusters/production/kustomizations.yaml",
  render: renderFluxRoot,
});

registerAdapter({
  name: "flux-packs",
  target: "flux",
  input: "canonical-artifacts",
  status: "implemented",
  defaultPath: "platform/cluster/flux/apps",
  render: renderFluxPacks,
});

registerAdapter({
  name: "flux-source",
  target: "flux",
  input: "canonical-artifacts",
  status: "implemented",
  defaultPath: "platform/cluster/flux/apps",
  render: renderFluxSource,
});

export const plannedAdapterContracts = Object.freeze([] as const);

export function registerAdapter(definition: AdapterDefinition): void {
  validateDefinition(definition);
  adapterDefinitions.set(definition.name, Object.freeze({ ...definition }));
}

export function getAdapter(name: string): Readonly<AdapterDefinition> | undefined {
  return adapterDefinitions.get(name);
}

export function listAdapters(options: ListOptions = {}): Readonly<AdapterDefinition>[] {
  const adapters = [...adapterDefinitions.values()].sort((left, right) => left.name.localeCompare(right.name));
  if (!options.target) return adapters;
  return adapters.filter((adapter) => adapter.target === options.target || adapter.name === options.target);
}

export function adapterNames(): string[] {
  return listAdapters().map((adapter) => adapter.name);
}

export function adapterContract(): {
  implemented: Array<Pick<AdapterDefinition, "name" | "target" | "input" | "status" | "defaultPath">>;
  planned: readonly [];
  context: { artifacts: string[]; receives: string[]; returns: string };
} {
  return {
    implemented: listAdapters().map(({ name, target, input, status, defaultPath }) => ({ name, target, input, status, defaultPath })),
    planned: plannedAdapterContracts,
    context: {
      artifacts: ["service-intent", "fleet-inventory", "vault-dynamic-secrets", "deploy-config"],
      receives: ["artifacts", "renderPlan", "pathAllocator", "blueprintRegistry", "overrides"],
      returns: "array of { path, content, adapter, executable? } or a string for single-artifact render"
    }
  };
}

function validateDefinition(definition: AdapterDefinition): void {
  for (const field of ["name", "target", "input", "status", "defaultPath", "render"] as const) {
    if (!definition[field]) {
      throw new Error(`adapter definition missing ${field}`);
    }
  }
  if (typeof definition.render !== "function") {
    throw new Error(`adapter ${definition.name} render must be a function`);
  }
}
