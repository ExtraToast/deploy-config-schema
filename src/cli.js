import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import YAML from "yaml";
import { loadConfig, ConfigLoadError } from "./config-loader.js";
import { validateConfig } from "./validator.js";
import { artifactKinds, isArtifactKind, validateArtifact } from "./artifact-validator.js";
import { adapterContract, adapterNames, getAdapter } from "./adapters/registry.js";
import { resolveBlueprintRegistry } from "./blueprints/registry.js";
import { expandPlatform } from "./minimal/expand.js";
import { validatePlatform } from "./minimal/schema.js";
import { createRenderPlan, renderPlanFiles } from "./render-plan/plan.js";
import { writeGeneratedFiles } from "./render-plan/writer.js";
import { normalizeServiceIntentForRender } from "./service-intent-normalizer.js";

const allAdapters = new Set(adapterNames());
const platformTemplatePaths = {
  "single-node": "../fixtures/platform/single-node.platform.yaml",
  "multi-site": "../fixtures/platform/multi-site.platform.yaml",
};

export async function runCli(args, streams = { stdout: process.stdout, stderr: process.stderr }) {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    streams.stderr.write(`${usage()}\n`);
    return args.length === 0 ? 1 : 0;
  }

  const [command, ...rest] = args;
  if (command === "validate") {
    return runValidate(rest, streams);
  }
  if (command === "init") {
    return runInit(rest, streams);
  }
  if (command === "expand") {
    return runExpand(rest, streams);
  }
  if (command === "render-plan") {
    return runRenderPlan(rest, streams);
  }
  if (command === "render-tree") {
    return runRenderTree(rest, streams);
  }
  if (command === "adapter-contract") {
    streams.stdout.write(`${JSON.stringify(adapterContract(), null, 2)}\n`);
    return 0;
  }
  if (command === "render") {
    return runRender(rest, streams);
  }

  writeDiagnostics(streams.stderr, [
    {
      code: "E_USAGE",
      message: `unknown command: ${command}`,
      path: "/",
    },
  ]);
  return 1;
}

function runValidate(args, streams) {
  const { positionals, options, diagnostics } = parseOptions(args);
  const explicitKind = isValidationKind(positionals[0]) || positionals[0] === "auto" ? positionals[0] : undefined;
  const artifactKind = explicitKind ?? options.input ?? "deploy-config";
  const configPaths = explicitKind ? positionals.slice(1) : positionals;

  if (diagnostics.length > 0 || configPaths.length < 1) {
    writeDiagnostics(streams.stderr, diagnostics.length > 0 ? diagnostics : usageDiagnostic("validate <kind|auto> <file...>"));
    return 1;
  }

  const result = validateFiles(configPaths, artifactKind);
  if (!result.valid) {
    writeValidationResult(streams.stdout, result);
    return 1;
  }

  if (options.format === "text") {
    streams.stdout.write(result.results.map((fileResult) => `${fileResult.kind} ${fileResult.file}: valid`).join("\n"));
    streams.stdout.write("\n");
  } else {
    writeValidationResult(streams.stdout, result);
  }
  return 0;
}

function runInit(args, streams) {
  const { positionals, options, diagnostics } = parseOptions(args);
  if (diagnostics.length > 0 || positionals.length !== 1 || positionals[0] !== "platform") {
    writeDiagnostics(streams.stderr, diagnostics.length > 0 ? diagnostics : usageDiagnostic("init platform --template single-node|multi-site --output <path>"));
    return 1;
  }
  const template = options.template ?? "single-node";
  const templatePath = platformTemplatePaths[template];
  if (!templatePath) {
    writeDiagnostics(streams.stderr, [{
      code: "E_TEMPLATE_UNKNOWN",
      message: `unknown platform template: ${template}`,
      path: "/template",
    }]);
    return 1;
  }
  if (!options.output) {
    writeDiagnostics(streams.stderr, usageDiagnostic("init platform --template single-node|multi-site --output <path>"));
    return 1;
  }
  mkdirSync(dirname(options.output), { recursive: true });
  copyFileSync(new URL(templatePath, import.meta.url), options.output);
  streams.stdout.write(`${JSON.stringify({ path: options.output, template }, null, 2)}\n`);
  return 0;
}

function runExpand(args, streams) {
  const { positionals, options, diagnostics } = parseOptions(args);
  if (diagnostics.length > 0 || positionals.length !== 1) {
    writeDiagnostics(streams.stderr, diagnostics.length > 0 ? diagnostics : usageDiagnostic("expand <platform.yaml> [--output <dir>]"));
    return 1;
  }
  const expanded = loadValidateAndExpand(positionals[0]);
  if (!expanded.valid) {
    writeValidationResult(streams.stderr, expanded.validation);
    return 1;
  }
  if (options.output) {
    writeExpandedArtifacts(expanded.expansion.artifacts, options.output);
    streams.stdout.write(`${JSON.stringify({ output: options.output, artifacts: Object.keys(expanded.expansion.artifacts) }, null, 2)}\n`);
  } else {
    streams.stdout.write(`${stringifyYaml(expanded.expansion.artifacts)}\n`);
  }
  return 0;
}

function runRenderPlan(args, streams) {
  const { positionals, options, diagnostics } = parseOptions(args);
  if (diagnostics.length > 0 || positionals.length !== 1) {
    writeDiagnostics(streams.stderr, diagnostics.length > 0 ? diagnostics : usageDiagnostic("render-plan <platform.yaml> [--target edge|adapter] [--output <root>]"));
    return 1;
  }
  const expanded = loadValidateAndExpand(positionals[0]);
  if (!expanded.valid) {
    writeValidationResult(streams.stderr, expanded.validation);
    return 1;
  }
  const blueprints = resolveBlueprintsForRender(expanded.expansion, options);
  if (!blueprints.ok) {
    writeDiagnostics(streams.stderr, blueprints.diagnostics);
    return 1;
  }
  const plan = createRenderPlan(expanded.expansion, {
    target: options.target ?? "all",
    output: options.output ?? ".",
    blueprintRegistry: blueprints.registry,
    blueprints: blueprints.provenance,
  });
  streams.stdout.write(`${stringifyYaml(plan)}\n`);
  return 0;
}

function runRenderTree(args, streams) {
  const { positionals, options, diagnostics } = parseOptions(args);
  if (diagnostics.length > 0 || positionals.length !== 1) {
    writeDiagnostics(streams.stderr, diagnostics.length > 0 ? diagnostics : usageDiagnostic("render-tree <platform.yaml> --output <root> [--target edge|adapter] [--dry-run|--diff|--force]"));
    return 1;
  }
  const expanded = loadValidateAndExpand(positionals[0]);
  if (!expanded.valid) {
    writeValidationResult(streams.stderr, expanded.validation);
    return 1;
  }
  const blueprints = resolveBlueprintsForRender(expanded.expansion, options);
  if (!blueprints.ok) {
    writeDiagnostics(streams.stderr, blueprints.diagnostics);
    return 1;
  }
  const plan = createRenderPlan(expanded.expansion, {
    target: options.target ?? "all",
    output: options.output ?? ".",
    blueprintRegistry: blueprints.registry,
    blueprints: blueprints.provenance,
  });
  const files = renderPlanFiles(expanded.expansion, plan, {
    blueprintRegistry: blueprints.registry,
  });
  const result = writeGeneratedFiles(files, {
    root: options.output ?? ".",
    dryRun: options.dryRun,
    diff: options.diff || options.check,
    force: options.force,
  });
  const response = {
    ok: result.ok,
    plan,
    results: result.results.map(({ path, adapter, action, currentHash, nextHash }) => ({ path, adapter, action, currentHash, nextHash })),
    diagnostics: result.diagnostics,
  };
  streams.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

function runRender(args, streams) {
  const { positionals, options, diagnostics } = parseOptions(args);
  if (diagnostics.length > 0 || positionals.length !== 2) {
    writeDiagnostics(streams.stderr, diagnostics.length > 0 ? diagnostics : usageDiagnostic("render <adapter> <config> [--output <path>]"));
    return 1;
  }

  const [adapter, configPath] = positionals;
  const inputKind = options.input ?? "deploy-config";
  if (!["deploy-config", "service-intent"].includes(inputKind)) {
    writeDiagnostics(streams.stderr, [
      {
        code: "E_INPUT_UNSUPPORTED",
        message: `render input must be deploy-config or service-intent`,
        path: "/",
      },
    ]);
    return 1;
  }
  if (!allAdapters.has(adapter)) {
    writeDiagnostics(streams.stderr, [
      {
        code: "E_ADAPTER_UNKNOWN",
        message: `unknown adapter: ${adapter}`,
        path: "/adapter_output_intent/adapters",
      },
    ]);
    return 1;
  }

  const loaded = loadAndValidate(configPath, inputKind);
  if (!loaded.valid) {
    writeValidationResult(streams.stderr, loaded);
    return 1;
  }
  if (inputKind === "service-intent" && !loaded.config.renderer?.public_domain) {
    writeDiagnostics(streams.stderr, [
      {
        code: "E_RENDERER_DOMAIN_REQUIRED",
        message: "service-intent rendering requires renderer.public_domain",
        path: "/renderer/public_domain",
      },
    ]);
    return 1;
  }

  const config = inputKind === "service-intent"
    ? normalizeServiceIntentForRender(loaded.config)
    : loaded.config;

  if (!config.adapter_output_intent.adapters.includes(adapter)) {
    writeDiagnostics(streams.stderr, [
      {
        code: "E_ADAPTER_NOT_SELECTED",
        message: `adapter ${adapter} is not selected by adapter_output_intent.adapters`,
        path: "/adapter_output_intent/adapters",
      },
    ]);
    return 1;
  }

  const rendered = renderAdapter(config, adapter);
  writeOutput(rendered, options.output, streams.stdout);
  return 0;
}

function validateFiles(paths, kind) {
  const results = paths.map((path) => {
    const loaded = kind === "auto" ? loadAndValidateAuto(path) : loadAndValidate(path, kind);
    return {
      file: path,
      kind: loaded.kind ?? kind,
      valid: loaded.valid,
      diagnostics: loaded.diagnostics,
    };
  });
  return {
    valid: results.every((result) => result.valid),
    diagnostics: results.flatMap((result) => result.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      file: result.file,
      kind: result.kind,
    }))),
    results,
  };
}

function renderAdapter(config, adapter) {
  const definition = getAdapter(adapter);
  if (!definition) throw new Error(`unsupported adapter: ${adapter}`);
  return definition.render(config);
}

function loadAndValidateAuto(path) {
  try {
    const config = loadConfig(path);
    const kind = inferValidationKind(path, config);
    const validation = kind === "platform"
      ? validatePlatform(config)
      : kind === "deploy-config" ? validateConfig(config) : validateArtifact(kind, config);
    return {
      ...validation,
      kind,
      config,
    };
  } catch (error) {
    if (error instanceof ConfigLoadError) {
      return {
        valid: false,
        kind: inferValidationKindFromPath(path) ?? "auto",
        diagnostics: error.diagnostics,
      };
    }
    throw error;
  }
}

function loadAndValidate(path, kind = "deploy-config") {
  try {
    const config = loadConfig(path);
    const validation = kind === "platform"
      ? validatePlatform(config)
      : kind === "deploy-config" ? validateConfig(config) : validateArtifact(kind, config);
    return {
      ...validation,
      config,
    };
  } catch (error) {
    if (error instanceof ConfigLoadError) {
      return {
        valid: false,
        diagnostics: error.diagnostics,
      };
    }
    throw error;
  }
}

function inferValidationKind(path, document) {
  return inferValidationKindFromPath(path)
    ?? inferValidationKindFromDocument(document)
    ?? "deploy-config";
}

function inferValidationKindFromPath(path) {
  const normalized = path.replaceAll("\\", "/").split("/").at(-1) ?? path;
  if (/platform\.ya?ml$|platform\.json$/i.test(normalized)) return "platform";
  if (/deploy-config\.ya?ml$|deploy-config\.json$/i.test(normalized)) return "deploy-config";
  for (const kind of artifactKinds) {
    const escaped = kind.replaceAll("-", "[-_]");
    if (new RegExp(`${escaped}(\\.sample)?\\.(ya?ml|json)$`, "i").test(normalized)) return kind;
  }
  return undefined;
}

function inferValidationKindFromDocument(document) {
  if (document?.fleet) return "fleet-inventory";
  if (document?.vault) return "vault-dynamic-secrets";
  if (document?.cluster && document?.service_intent) return "deploy-config";
  if (document?.name && document?.domain) return "platform";
  if (document?.services && !document?.cluster) return "service-intent";
  if (document?.hosts || document?.packs) return "platform";
  return undefined;
}

function loadValidateAndExpand(path) {
  const platform = loadAndValidate(path, "platform");
  if (!platform.valid) {
    return {
      valid: false,
      validation: platform,
    };
  }
  const expansion = expandPlatform(platform.config);
  if (!expansion.valid) {
    return {
      valid: false,
      validation: {
        valid: false,
        diagnostics: Object.entries(expansion.validations).flatMap(([kind, validation]) => validation.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          code: `${kind}:${diagnostic.code}`,
        }))),
      },
      expansion,
    };
  }
  return {
    valid: true,
    validation: { valid: true, diagnostics: [] },
    expansion,
  };
}

function parseOptions(args) {
  const positionals = [];
  const options = {
    format: "json",
  };
  const diagnostics = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") {
      const value = args[index + 1];
      if (!value) {
        diagnostics.push({
          code: "E_USAGE",
          message: "--output requires a path",
          path: "/",
        });
      } else {
        options.output = value;
        index += 1;
      }
    } else if (arg === "--format") {
      const value = args[index + 1];
      if (!["json", "text"].includes(value)) {
        diagnostics.push({
          code: "E_USAGE",
          message: "--format must be json or text",
          path: "/",
        });
      } else {
        options.format = value;
        index += 1;
      }
    } else if (arg === "--input") {
      const value = args[index + 1];
      if (!isValidationKind(value)) {
        diagnostics.push({
          code: "E_USAGE",
          message: `--input must be one of: ${validationKinds().join(", ")}`,
          path: "/",
        });
      } else {
        options.input = value;
        index += 1;
      }
    } else if (arg === "--template") {
      const value = args[index + 1];
      if (!value) {
        diagnostics.push({
          code: "E_USAGE",
          message: "--template requires a value",
          path: "/",
        });
      } else {
        options.template = value;
        index += 1;
      }
    } else if (arg === "--target") {
      const value = args[index + 1];
      if (!value) {
        diagnostics.push({
          code: "E_USAGE",
          message: "--target requires a value",
          path: "/",
        });
      } else {
        options.target = value;
        index += 1;
      }
    } else if (arg === "--blueprints-root") {
      const value = args[index + 1];
      if (!value) {
        diagnostics.push({
          code: "E_USAGE",
          message: "--blueprints-root requires a directory",
          path: "/",
        });
      } else {
        options.blueprintsRoot = value;
        index += 1;
      }
    } else if (arg === "--blueprints-version") {
      const value = args[index + 1];
      if (!value) {
        diagnostics.push({
          code: "E_USAGE",
          message: "--blueprints-version requires a tag or ref",
          path: "/",
        });
      } else {
        options.blueprintsVersion = value;
        index += 1;
      }
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--diff") {
      options.diff = true;
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg.startsWith("--")) {
      diagnostics.push({
        code: "E_USAGE",
        message: `unknown option: ${arg}`,
        path: "/",
      });
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, options, diagnostics };
}

function resolveBlueprintsForRender(expansion, options) {
  if (!selectedAdaptersNeedBlueprints(expansion, options.target ?? "all")) {
    return { ok: true };
  }
  return resolveBlueprintRegistry({
    root: options.blueprintsRoot,
    version: options.blueprintsVersion,
  });
}

function selectedAdaptersNeedBlueprints(expansion, target) {
  const selectedAdapters = expansion.artifacts["deploy-config"].adapter_output_intent.adapters;
  return selectedAdapters
    .map((adapterName) => getAdapter(adapterName))
    .filter(Boolean)
    .filter((adapter) => target === "all" || adapter.target === target || adapter.name === target)
    .some((adapter) => ["flux-packs", "flux-source"].includes(adapter.name));
}

function writeExpandedArtifacts(artifacts, output) {
  mkdirSync(output, { recursive: true });
  for (const [kind, artifact] of Object.entries(artifacts)) {
    writeFileSync(`${output}/${kind}.generated.yaml`, stringifyYaml(artifact));
  }
}

function stringifyYaml(value) {
  return YAML.stringify(value, {
    indent: 2,
    lineWidth: 0,
    sortMapEntries: false,
  });
}

function writeOutput(rendered, outputPath, stdout) {
  const text = rendered.endsWith("\n") ? rendered : `${rendered}\n`;
  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, text);
    return;
  }
  stdout.write(text);
}

function writeValidationResult(stream, validation) {
  stream.write(`${JSON.stringify(validation, null, 2)}\n`);
}

function writeDiagnostics(stream, diagnostics) {
  writeValidationResult(stream, {
    valid: false,
    diagnostics,
  });
}

function usageDiagnostic(command) {
  return [
    {
      code: "E_USAGE",
      message: `usage: deploy-config-schema ${command}`,
      path: "/",
    },
  ];
}

function usage() {
  return [
    "Usage:",
    "  deploy-config-schema validate <kind|auto> <file...> [--format json|text]",
    "  deploy-config-schema init platform --template single-node|multi-site --output <path>",
    "  deploy-config-schema expand <platform.yaml> [--output <dir>]",
    "  deploy-config-schema render-plan <platform.yaml> [--target edge|adapter] [--output <root>] [--blueprints-root <dir>] [--blueprints-version <tag>]",
    "  deploy-config-schema render-tree <platform.yaml> --output <root> [--target edge|adapter] [--dry-run|--diff|--check|--force] [--blueprints-root <dir>] [--blueprints-version <tag>]",
    "  deploy-config-schema render <adapter> <config> [--input deploy-config|service-intent] [--output <path>]",
    "  deploy-config-schema adapter-contract",
    "",
    "Artifact kinds:",
    `  ${validationKinds().join(", ")}`,
    "",
    "Adapters:",
    `  ${adapterNames().join("\n  ")}`,
  ].join("\n");
}

function validationKinds() {
  return ["platform", ...artifactKinds];
}

function isValidationKind(value) {
  return value === "platform" || isArtifactKind(value);
}
