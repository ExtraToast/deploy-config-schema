import { createRequire } from "node:module";
import type { Ajv2020 as Ajv2020Class } from "ajv/dist/2020.js";
import { z } from "zod";

export type JsonSchemaObject = Record<string, unknown>;

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js").default as typeof Ajv2020Class;

export function jsonSchemaBackedZodSchema(schema: JsonSchemaObject): z.ZodType<unknown> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  return z.custom((value) => validate(value), {
    message: "document must match its generated JSON Schema",
  });
}
