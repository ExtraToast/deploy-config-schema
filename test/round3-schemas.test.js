import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import YAML from "yaml";

const cases = [
  {
    name: "service intent",
    schema: "../schemas/round3/service-intent.schema.json",
    fixture: "../fixtures/round3/service-intent.sample.yaml",
  },
  {
    name: "fleet inventory extension",
    schema: "../schemas/round3/fleet-inventory.schema.json",
    fixture: "../fixtures/round3/fleet-inventory.sample.yaml",
  },
  {
    name: "vault dynamic secrets",
    schema: "../schemas/round3/vault-dynamic-secrets.schema.json",
    fixture: "../fixtures/round3/vault-dynamic-secrets.sample.yaml",
  },
];

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function readYaml(relativePath) {
  return YAML.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function compile(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  assert.equal(ajv.validateSchema(schema), true, JSON.stringify(ajv.errors, null, 2));
  return ajv.compile(schema);
}

for (const schemaCase of cases) {
  test(`round-3 ${schemaCase.name} schema validates its fixture`, () => {
    const validate = compile(readJson(schemaCase.schema));
    const fixture = readYaml(schemaCase.fixture);

    assert.equal(validate(fixture), true, JSON.stringify(validate.errors, null, 2));
  });
}

test("round-3 service intent keeps Nomad renderer design-only", () => {
  const validate = compile(readJson("../schemas/round3/service-intent.schema.json"));
  const fixture = readYaml("../fixtures/round3/service-intent.sample.yaml");

  fixture.services["future-nomad-worker"].nomad.renderer_status = "implemented";

  assert.equal(validate(fixture), false);
  assert.ok(
    validate.errors.some((error) => error.instancePath.endsWith("/nomad/renderer_status")),
    JSON.stringify(validate.errors, null, 2),
  );
});

test("round-3 fixtures avoid reference-repo concrete values", () => {
  const disallowed = [
    "jorisjonkers",
    "esa-blueshell",
    "blueshell",
    "personal-stack",
    "167.86.79.203",
    "130.89.174.190",
    "192.168.0.99",
    "ghcr.io/jorisjonkers",
    "ghcr.io/esa-blueshell",
    "auth-system",
    "assistant-system",
    "knowledge-system",
    "media-system",
    "mail-system",
    "utility-system",
    "data-system",
  ];

  for (const schemaCase of cases) {
    const fixtureText = readFileSync(new URL(schemaCase.fixture, import.meta.url), "utf8");
    for (const value of disallowed) {
      assert.equal(
        fixtureText.includes(value),
        false,
        `${schemaCase.fixture} contains reference-specific value ${value}`,
      );
    }
  }
});
