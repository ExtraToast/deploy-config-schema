export {
  platformJsonSchema,
  platformSchema,
  type PlatformSchemaInput,
} from "./platform.js";
export {
  deployConfigJsonSchema,
  deployConfigSchema,
  type DeployConfigSchemaInput,
} from "./deploy-config.js";
export {
  serviceIntentJsonSchema,
  serviceIntentSchema,
  type ServiceIntentSchemaInput,
} from "./service-intent.js";
export {
  fleetInventoryJsonSchema,
  fleetInventorySchema,
  type FleetInventorySchemaInput,
} from "./fleet-inventory.js";
export {
  vaultDynamicSecretsJsonSchema,
  vaultDynamicSecretsSchema,
  type VaultDynamicSecretsSchemaInput,
} from "./vault-dynamic-secrets.js";

export const generatedSchemaEntries = [
  {
    path: "schemas/platform.schema.json",
    schemaName: "platformSchema",
    jsonSchemaName: "platformJsonSchema",
  },
  {
    path: "schemas/deploy-config.schema.json",
    schemaName: "deployConfigSchema",
    jsonSchemaName: "deployConfigJsonSchema",
  },
  {
    path: "schemas/round3/service-intent.schema.json",
    schemaName: "serviceIntentSchema",
    jsonSchemaName: "serviceIntentJsonSchema",
  },
  {
    path: "schemas/round3/fleet-inventory.schema.json",
    schemaName: "fleetInventorySchema",
    jsonSchemaName: "fleetInventoryJsonSchema",
  },
  {
    path: "schemas/round3/vault-dynamic-secrets.schema.json",
    schemaName: "vaultDynamicSecretsSchema",
    jsonSchemaName: "vaultDynamicSecretsJsonSchema",
  },
] as const;
