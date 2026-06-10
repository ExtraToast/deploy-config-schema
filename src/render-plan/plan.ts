import { getAdapter, listAdapters } from "../adapters/registry.js";
import type { AdapterDefinition } from "../adapters/registry.js";
import type { AdapterContext, AdapterFile, BlueprintRegistry, RenderResult } from "../adapters/model.js";
import { createPathAllocator, safeRelativePath } from "./paths.js";
import type { PathAllocator } from "./paths.js";

type ArtifactBundle = Record<string, any>;

export type PlatformExpansion = {
  platform: {
    name: string;
    gitops: { root: string; environment: string };
    packs?: Record<string, unknown>;
  };
  artifacts: ArtifactBundle & {
    "deploy-config": {
      adapter_output_intent: {
        adapters: string[];
      };
    };
  };
};

export type RenderPlanOptions = {
  target?: string;
  output?: string;
  blueprints?: { source: string; version?: string };
  blueprintRegistry?: BlueprintRegistry;
  overrides?: Record<string, unknown>;
};

export type RenderPlanTarget = {
  name: string;
  adapter: string;
  target: string;
  input: string;
  path: string;
  managed: boolean;
};

export type RenderPlan = {
  version: number;
  platform: string;
  root: string;
  provenance?: { blueprints: { source: string; version?: string } };
  targets: RenderPlanTarget[];
  availableAdapters: Array<Pick<AdapterDefinition, "name" | "target" | "status">>;
};

type RenderContext = {
  artifacts: ArtifactBundle;
  renderPlan?: RenderPlan;
  pathAllocator: PathAllocator;
  blueprintRegistry?: BlueprintRegistry;
  overrides: Record<string, unknown>;
};

export function createRenderPlan(expansion: PlatformExpansion, options: RenderPlanOptions = {}): RenderPlan {
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
    .map((adapterName: string) => getAdapter(adapterName))
    .filter((adapter): adapter is Readonly<AdapterDefinition> => Boolean(adapter))
    .filter((adapter) => target === "all" || adapter.target === target || adapter.name === target)
    .flatMap((adapter) => targetEntries(adapter, allocator, renderContext))
    .sort((left, right) => compareStrings(left.path, right.path) || compareStrings(left.adapter, right.adapter) || compareStrings(left.name, right.name));

  return {
    version: 1,
    platform: platform.name,
    root: options.output ?? ".",
    ...(options.blueprints ? { provenance: { blueprints: options.blueprints } } : {}),
    targets,
    availableAdapters: listAdapters().map((adapter) => ({
      name: adapter.name,
      target: adapter.target,
      status: adapter.status
    }))
  };
}

export function renderPlanFiles(
  expansion: PlatformExpansion,
  plan: RenderPlan,
  options: { blueprintRegistry?: BlueprintRegistry } = {},
): AdapterFile[] {
  const allocator = createPathAllocator({
    gitopsRoot: expansion.platform.gitops.root,
    environment: expansion.platform.gitops.environment,
    gatusGroup: gatusGroup(expansion.platform)
  });
  const context = createAdapterContext(expansion, plan, allocator, {
    blueprintRegistry: options.blueprintRegistry,
  });
  const files = plan.targets.flatMap((target) => {
    const adapter = getAdapter(target.adapter);
    if (!adapter) return [];
    return renderAdapterFiles(adapter, context).filter((file) => file.path === target.path);
  });
  return files.sort((left, right) => compareStrings(left.path, right.path) || compareStrings(left.adapter, right.adapter));
}

function targetEntries(adapter: Readonly<AdapterDefinition>, allocator: PathAllocator, context: RenderContext): RenderPlanTarget[] {
  return renderAdapterFiles(adapter, context).map((file) => ({
    name: `${adapter.name}:${file.path}`,
    adapter: adapter.name,
    target: adapter.target,
    input: adapter.input,
    path: safeRelativePath(file.path),
    managed: true
  }));
}

function renderAdapterFiles(adapter: Readonly<AdapterDefinition>, context: RenderContext): AdapterFile[] {
  if (adapter.input === "canonical-artifacts") {
    const rendered = adapter.render(context as AdapterContext as never);
    return normalizeRenderedFiles(rendered, adapter);
  }
  const path = allocatorPath(context.pathAllocator, adapter);
  const rendered = adapter.render(context.artifacts["deploy-config"] as never);
  return normalizeRenderedFiles(rendered, adapter, path);
}

function allocatorPath(allocator: PathAllocator | undefined, adapter: Readonly<AdapterDefinition>): string {
  if (!allocator) return safeRelativePath(adapter.defaultPath);
  const path = allocator.existingAdapterPath(adapter.name) ?? adapter.defaultPath;
  return safeRelativePath(path);
}

function normalizeRenderedFiles(
  rendered: RenderResult,
  adapter: Readonly<AdapterDefinition>,
  defaultPath?: string,
): AdapterFile[] {
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

function createAdapterContext(
  expansion: PlatformExpansion,
  renderPlan: RenderPlan | undefined,
  pathAllocator: PathAllocator,
  options: RenderPlanOptions | { blueprintRegistry?: BlueprintRegistry },
): RenderContext {
  return {
    artifacts: {
      ...expansion.artifacts,
      platform: expansion.platform,
    },
    renderPlan,
    pathAllocator,
    blueprintRegistry: options.blueprintRegistry,
    overrides: "overrides" in options ? (options.overrides ?? {}) : {},
  };
}

function gatusGroup(platform: PlatformExpansion["platform"]): string {
  const observability = platform.packs?.observability;
  return typeof observability === "object" && observability !== null && "gatus" in observability ? "observability" : "utility-system";
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
