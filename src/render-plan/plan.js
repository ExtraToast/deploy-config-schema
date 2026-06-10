import { getAdapter, listAdapters } from "../adapters/registry.js";
import { createPathAllocator, safeRelativePath } from "./paths.js";

export function createRenderPlan(expansion, options = {}) {
  const platform = expansion.platform;
  const allocator = createPathAllocator({
    gitopsRoot: platform.gitops.root,
    environment: platform.gitops.environment,
    gatusGroup: gatusGroup(platform)
  });
  const selectedAdapters = expansion.artifacts["deploy-config"].adapter_output_intent.adapters;
  const target = options.target ?? "all";
  const renderContext = createAdapterContext(expansion, undefined, allocator, options);
  const targets = selectedAdapters
    .map((adapterName) => getAdapter(adapterName))
    .filter(Boolean)
    .filter((adapter) => target === "all" || adapter.target === target || adapter.name === target)
    .flatMap((adapter) => targetEntries(adapter, allocator, renderContext))
    .sort((left, right) => compareStrings(left.path, right.path) || compareStrings(left.adapter, right.adapter) || compareStrings(left.name, right.name));

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
  const allocator = createPathAllocator({
    gitopsRoot: expansion.platform.gitops.root,
    environment: expansion.platform.gitops.environment,
    gatusGroup: gatusGroup(expansion.platform)
  });
  const context = createAdapterContext(expansion, plan, allocator, {});
  const files = plan.targets.flatMap((target) => {
    const adapter = getAdapter(target.adapter);
    return renderAdapterFiles(adapter, context).filter((file) => file.path === target.path);
  });
  return files.sort((left, right) => compareStrings(left.path, right.path) || compareStrings(left.adapter, right.adapter));
}

function targetEntries(adapter, allocator, context) {
  return renderAdapterFiles(adapter, context).map((file) => ({
    name: `${adapter.name}:${file.path}`,
    adapter: adapter.name,
    target: adapter.target,
    input: adapter.input,
    path: safeRelativePath(file.path),
    managed: true
  }));
}

function renderAdapterFiles(adapter, context) {
  if (adapter.input === "canonical-artifacts") {
    const rendered = adapter.render(context);
    return normalizeRenderedFiles(rendered, adapter);
  }
  const path = allocatorPath(context.pathAllocator, adapter);
  const rendered = adapter.render(context.artifacts["deploy-config"]);
  return normalizeRenderedFiles(rendered, adapter, path);
}

function allocatorPath(allocator, adapter) {
  const path = allocator.existingAdapterPath(adapter.name) ?? adapter.defaultPath;
  return safeRelativePath(path);
}

function normalizeRenderedFiles(rendered, adapter, defaultPath) {
  if (typeof rendered === "string") {
    return [{
      path: defaultPath ?? adapter.defaultPath,
      adapter: adapter.name,
      content: rendered,
    }];
  }
  return rendered.map((file) => ({
    path: safeRelativePath(file.path),
    adapter: file.adapter ?? adapter.name,
    content: file.content,
    ...(file.executable !== undefined ? { executable: file.executable } : {}),
  }));
}

function createAdapterContext(expansion, renderPlan, pathAllocator, options) {
  return {
    artifacts: {
      ...expansion.artifacts,
      platform: expansion.platform,
    },
    renderPlan,
    pathAllocator,
    blueprintRegistry: options.blueprintRegistry,
    overrides: options.overrides ?? {},
  };
}

function gatusGroup(platform) {
  return platform.packs?.observability?.gatus !== undefined ? "observability" : "utility-system";
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
