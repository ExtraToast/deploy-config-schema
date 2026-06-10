import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import YAML from "yaml";
import {
  deployConfigJsonSchema,
  deployConfigSchema,
  fleetInventoryJsonSchema,
  fleetInventorySchema,
  platformJsonSchema,
  platformSchema,
  serviceIntentJsonSchema,
  serviceIntentSchema,
  vaultDynamicSecretsJsonSchema,
  vaultDynamicSecretsSchema,
} from "../src/schemas/index.js";

const repoRoot = process.cwd();
const generator = resolve(repoRoot, "dist/scripts/generate-schemas.js");

const schemaCases = [
  ["platform", platformJsonSchema, platformSchema],
  ["deploy-config", deployConfigJsonSchema, deployConfigSchema],
  ["service-intent", serviceIntentJsonSchema, serviceIntentSchema],
  ["fleet-inventory", fleetInventoryJsonSchema, fleetInventorySchema],
  ["vault-dynamic-secrets", vaultDynamicSecretsJsonSchema, vaultDynamicSecretsSchema],
];

test("generated JSON Schemas are committed without drift", () => {
  const result = spawnSync(process.execPath, [generator, "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Zod schemas and generated JSON Schemas have equivalent sample and fixture verdicts", () => {
  const documents = fixtureDocuments();

  for (const [schemaName, jsonSchema, zodSchema] of schemaCases) {
    const validate = compile(jsonSchema);
    for (const document of documents) {
      const ajvAccepted = validate(document.value);
      const zodAccepted = zodSchema.safeParse(document.value).success;

      assert.equal(
        zodAccepted,
        ajvAccepted,
        `${schemaName} verdict changed for ${document.relativePath}: ${JSON.stringify(validate.errors, null, 2)}`,
      );
    }
  }
});

function compile(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  assert.equal(ajv.validateSchema(schema), true, JSON.stringify(ajv.errors, null, 2));
  return ajv.compile(schema);
}

function fixtureDocuments() {
  return ["samples", "fixtures"]
    .flatMap((directory) => documentFiles(join(repoRoot, directory)))
    .map((path) => ({
      relativePath: path.slice(repoRoot.length + 1),
      value: readDocument(path),
    }));
}

function documentFiles(directory) {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        return documentFiles(path);
      }
      return /\.(json|ya?ml)$/.test(path) ? [path] : [];
    })
    .sort();
}

function readDocument(path) {
  const text = readFileSync(path, "utf8");
  return path.endsWith(".json") ? JSON.parse(text) : YAML.parse(text);
}
