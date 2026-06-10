import { readFileSync } from "node:fs";
import { extname } from "node:path";
import YAML from "yaml";

export type Diagnostic = {
  code: string;
  message: string;
  path: string;
};

export class ConfigLoadError extends Error {
  diagnostics: Diagnostic[];

  constructor(diagnostics: Diagnostic[]) {
    super("failed to load deploy config");
    this.name = "ConfigLoadError";
    this.diagnostics = diagnostics;
  }
}

export function loadConfig(path: string): unknown {
  const text = readFileSync(path, "utf8");
  const extension = extname(path).toLowerCase();

  try {
    if (extension === ".json") {
      return JSON.parse(text);
    }
    return YAML.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigLoadError([
      {
        code: "E_PARSE",
        message,
        path: "/",
      },
    ]);
  }
}
