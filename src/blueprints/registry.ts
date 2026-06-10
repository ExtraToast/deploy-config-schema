import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { safeRelativePath } from "../render-plan/paths.js";

export const BLUEPRINTS_ROOT_ENV = "DEPLOY_CONFIG_BLUEPRINTS_ROOT";

export type Diagnostic = {
  code: string;
  path: string;
  message: string;
};

export type BlueprintRegistry = {
  root: string;
  packs: Record<string, Record<string, string>>;
  files(blueprintPath: string): Record<string, string> | undefined;
};

export type BlueprintRegistryResult =
  | { ok: true; root: string; registry: BlueprintRegistry }
  | { ok: false; diagnostics: Diagnostic[] };

export type ResolvedBlueprintRegistry =
  | { ok: true; registry?: BlueprintRegistry; provenance?: { source: string; version?: string } }
  | { ok: false; diagnostics: Diagnostic[] };

export function resolveBlueprintRegistry(
  options: { root?: string; version?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): ResolvedBlueprintRegistry {
  const root = options.root ?? env[BLUEPRINTS_ROOT_ENV];
  const version = options.version;

  if (!root) {
    return {
      ok: false,
      diagnostics: [{
        code: "E_BLUEPRINTS_ROOT_MISSING",
        path: "/blueprintsRoot",
        message: `blueprint-backed adapters require --blueprints-root <dir> or ${BLUEPRINTS_ROOT_ENV}`,
      }],
    };
  }

  const loaded = loadBlueprintRegistry(root);
  if (!loaded.ok) return loaded;

  return {
    ok: true,
    registry: loaded.registry,
    provenance: {
      source: "platform-blueprints-checkout",
      ...(version ? { version } : {}),
    },
  };
}

export function loadBlueprintRegistry(root: string | URL): BlueprintRegistryResult {
  const absoluteRoot = toAbsolutePath(root);
  const packsRoot = posix.join(absoluteRoot, "packs");

  if (!existsSync(packsRoot) || !statSync(packsRoot).isDirectory()) {
    return unavailable(root, "expected a platform-blueprints checkout containing packs/");
  }

  const files = walk(packsRoot);
  if (files.length === 0) {
    return unavailable(root, "packs/ exists but contains no readable pack files");
  }

  const packs: Record<string, Record<string, string>> = {};
  for (const relativeFile of files) {
    const segments = relativeFile.split("/");
    const content = readFileSync(posix.join(packsRoot, relativeFile), "utf8").trimEnd();
    for (let depth = 1; depth < segments.length; depth += 1) {
      const packPath = posix.join("packs", ...segments.slice(0, depth));
      const filePath = segments.slice(depth).join("/");
      if (!packs[packPath]) packs[packPath] = {};
      packs[packPath][filePath] = content;
    }
  }

  return {
    ok: true,
    root: absoluteRoot,
    registry: {
      root: absoluteRoot,
      packs,
      files(blueprintPath: string) {
        return packs[safeRelativePath(blueprintPath)];
      },
    },
  };
}

function unavailable(root: string | URL, reason: string): BlueprintRegistryResult {
  return {
    ok: false,
    diagnostics: [{
      code: "E_BLUEPRINTS_PACKS_UNAVAILABLE",
      path: "/blueprintsRoot",
      message: `blueprint packs unavailable at ${root}: ${reason}`,
    }],
  };
}

function toAbsolutePath(path: string | URL): string {
  if (path instanceof URL) return fileURLToPath(path);
  return resolve(String(path)).replaceAll("\\", "/");
}

function walk(root: string, prefix = ""): string[] {
  return readdirSync(posix.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = posix.join(prefix, entry.name);
    if (entry.isDirectory()) return walk(root, relativePath);
    if (!entry.isFile() || entry.name === "README.md" || entry.name.endsWith(".md")) return [];
    return [relativePath];
  }).sort();
}
