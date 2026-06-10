import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
cpSync("schemas", "dist/schemas", { recursive: true });
cpSync("fixtures", "dist/fixtures", { recursive: true });
cpSync("samples", "dist/samples", { recursive: true });
cpSync("test/fixtures", "dist/test/fixtures", { recursive: true });
