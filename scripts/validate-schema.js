import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";

const schema = JSON.parse(readFileSync(new URL("../schemas/deploy-config.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });

if (!ajv.validateSchema(schema)) {
  console.error(JSON.stringify(ajv.errors, null, 2));
  process.exitCode = 1;
}
