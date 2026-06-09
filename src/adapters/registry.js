import { renderEdgeCatalog, renderEdgeRouteCatalog } from "./catalog.js";
import { renderFluxPacks } from "./flux-packs.js";
import { renderFluxRoot } from "./flux-root.js";
import { renderFluxSource } from "./flux-source.js";
import { renderGatus } from "./gatus.js";
import { renderImageMetadata } from "./image-metadata.js";
import { renderTraefik } from "./traefik.js";

const adapterDefinitions = new Map();

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

export const plannedAdapterContracts = Object.freeze([
  { name: "kubernetes", target: "kubernetes", input: "canonical-artifacts", status: "planned" },
  { name: "nix-hosts", target: "nix", input: "canonical-artifacts", status: "planned" },
  { name: "vso", target: "vault", input: "canonical-artifacts", status: "planned" }
]);

export function registerAdapter(definition) {
  validateDefinition(definition);
  adapterDefinitions.set(definition.name, Object.freeze({ ...definition }));
}

export function getAdapter(name) {
  return adapterDefinitions.get(name);
}

export function listAdapters(options = {}) {
  const adapters = [...adapterDefinitions.values()].sort((left, right) => left.name.localeCompare(right.name));
  if (!options.target) return adapters;
  return adapters.filter((adapter) => adapter.target === options.target || adapter.name === options.target);
}

export function adapterNames() {
  return listAdapters().map((adapter) => adapter.name);
}

export function adapterContract() {
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

function validateDefinition(definition) {
  for (const field of ["name", "target", "input", "status", "defaultPath", "render"]) {
    if (!definition[field]) {
      throw new Error(`adapter definition missing ${field}`);
    }
  }
  if (typeof definition.render !== "function") {
    throw new Error(`adapter ${definition.name} render must be a function`);
  }
}
