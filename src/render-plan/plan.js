import { getAdapter, listAdapters } from "../adapters/registry.js";
import { createPathAllocator, safeRelativePath } from "./paths.js";

export function createRenderPlan(expansion, options = {}) {
  const platform = expansion.platform;
  const allocator = createPathAllocator({
    gitopsRoot: platform.gitops.root,
    environment: platform.gitops.environment
  });
  const selectedAdapters = expansion.artifacts["deploy-config"].adapter_output_intent.adapters;
  const target = options.target ?? "all";
  const targets = selectedAdapters
    .map((adapterName) => getAdapter(adapterName))
    .filter(Boolean)
    .filter((adapter) => target === "all" || adapter.target === target || adapter.name === target)
    .map((adapter) => targetEntry(adapter, allocator))
    .sort((left, right) => left.path.localeCompare(right.path) || left.adapter.localeCompare(right.adapter));

  return {
    version: 1,
    platform: platform.name,
    root: options.output ?? ".",
    targets,
    availableAdapters: listAdapters().map((adapter) => ({
      name: adapter.name,
      target: adapter.target,
      status: adapter.status
    }))
  };
}

export function renderPlanFiles(expansion, plan) {
  const deployConfig = expansion.artifacts["deploy-config"];
  return plan.targets.map((target) => {
    const adapter = getAdapter(target.adapter);
    return {
      path: target.path,
      adapter: target.adapter,
      content: adapter.render(deployConfig)
    };
  });
}

function targetEntry(adapter, allocator) {
  const path = allocator.existingAdapterPath(adapter.name) ?? adapter.defaultPath;
  return {
    name: adapter.name,
    adapter: adapter.name,
    target: adapter.target,
    input: adapter.input,
    path: safeRelativePath(path),
    managed: true
  };
}
