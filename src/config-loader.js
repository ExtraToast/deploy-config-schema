import { readFileSync } from "node:fs";
import { extname } from "node:path";
import YAML from "yaml";

export class ConfigLoadError extends Error {
  constructor(diagnostics) {
    super("failed to load deploy config");
    this.name = "ConfigLoadError";
    this.diagnostics = diagnostics;
  }
}

export function loadConfig(path) {
  const text = readFileSync(path, "utf8");
  const extension = extname(path).toLowerCase();

  try {
    if (extension === ".json") {
      return JSON.parse(text);
    }
    return YAML.parse(text);
  } catch (error) {
    throw new ConfigLoadError([
      {
        code: "E_PARSE",
        message: error.message,
        path: "/",
      },
    ]);
  }
}
