import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig, ConfigLoadError } from "./config-loader.js";
import { validateConfig } from "./validator.js";
import { renderTraefik } from "./adapters/traefik.js";
import { renderEdgeCatalog, renderEdgeRouteCatalog } from "./adapters/catalog.js";
import { renderGatus } from "./adapters/gatus.js";
import { renderImageMetadata } from "./adapters/image-metadata.js";

const allAdapters = new Set(["traefik-public", "traefik-lan", "gatus", "edge-catalog", "edge-route-catalog", "image-metadata"]);

export async function runCli(args, streams = { stdout: process.stdout, stderr: process.stderr }) {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    streams.stderr.write(`${usage()}\n`);
    return args.length === 0 ? 1 : 0;
  }

  const [command, ...rest] = args;
  if (command === "validate") {
    return runValidate(rest, streams);
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
  if (diagnostics.length > 0 || positionals.length !== 1) {
    writeDiagnostics(streams.stderr, diagnostics.length > 0 ? diagnostics : usageDiagnostic("validate <config>"));
    return 1;
  }

  const loaded = loadAndValidate(positionals[0]);
  if (!loaded.valid) {
    writeValidationResult(streams.stdout, loaded);
    return 1;
  }

  if (options.format === "text") {
    streams.stdout.write("valid\n");
  } else {
    writeValidationResult(streams.stdout, loaded);
  }
  return 0;
}

function runRender(args, streams) {
  const { positionals, options, diagnostics } = parseOptions(args);
  if (diagnostics.length > 0 || positionals.length !== 2) {
    writeDiagnostics(streams.stderr, diagnostics.length > 0 ? diagnostics : usageDiagnostic("render <adapter> <config> [--output <path>]"));
    return 1;
  }

  const [adapter, configPath] = positionals;
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

  const loaded = loadAndValidate(configPath);
  if (!loaded.valid) {
    writeValidationResult(streams.stderr, loaded);
    return 1;
  }

  if (!loaded.config.adapter_output_intent.adapters.includes(adapter)) {
    writeDiagnostics(streams.stderr, [
      {
        code: "E_ADAPTER_NOT_SELECTED",
        message: `adapter ${adapter} is not selected by adapter_output_intent.adapters`,
        path: "/adapter_output_intent/adapters",
      },
    ]);
    return 1;
  }

  const rendered = renderAdapter(loaded.config, adapter);
  writeOutput(rendered, options.output, streams.stdout);
  return 0;
}

function renderAdapter(config, adapter) {
  switch (adapter) {
    case "traefik-public":
    case "traefik-lan":
      return renderTraefik(config, adapter);
    case "gatus":
      return renderGatus(config);
    case "edge-catalog":
      return renderEdgeCatalog(config);
    case "edge-route-catalog":
      return renderEdgeRouteCatalog(config);
    case "image-metadata":
      return renderImageMetadata(config);
    default:
      throw new Error(`unsupported adapter: ${adapter}`);
  }
}

function loadAndValidate(path) {
  try {
    const config = loadConfig(path);
    const validation = validateConfig(config);
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
  stream.write(`${JSON.stringify({ valid: validation.valid, diagnostics: validation.diagnostics }, null, 2)}\n`);
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
    "  deploy-config-schema validate <config> [--format json|text]",
    "  deploy-config-schema render <adapter> <config> [--output <path>]",
    "",
    "Adapters:",
    "  traefik-public",
    "  traefik-lan",
    "  gatus",
    "  edge-catalog",
    "  edge-route-catalog",
    "  image-metadata",
  ].join("\n");
}
