import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ajv = new Ajv2020({ allErrors: true, strict: false });

const schemasRoot = new URL("../schemas", import.meta.url);
let failed = false;

for (const schemaPath of schemaFiles(schemasRoot.pathname)) {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  if (!ajv.validateSchema(schema)) {
    console.error(`${schemaPath} failed schema validation`);
    console.error(JSON.stringify(ajv.errors, null, 2));
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
}

function schemaFiles(directory) {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        return schemaFiles(path);
      }
      return path.endsWith(".schema.json") ? [path] : [];
    })
    .sort();
}
