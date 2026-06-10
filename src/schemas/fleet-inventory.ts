import { jsonSchemaBackedZodSchema } from "./support.js";

export const fleetInventoryJsonSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.extratoast.com/round3/fleet-inventory.schema.json",
  "title": "ExtraToast Round 3 Fleet Inventory Extension Skeleton",
  "description": "Design-first schema for richer sites, nodes, capabilities, placement, origins, exposure, SSO, and renderer target selection.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "version",
    "fleet"
  ],
  "properties": {
    "version": {
      "type": "integer",
      "minimum": 1
    },
    "fleet": {
      "$ref": "#/$defs/fleet"
    }
  },
  "$defs": {
    "identifier": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9._-]*$"
    },
    "nonEmptyString": {
      "type": "string",
      "minLength": 1
    },
    "hostname": {
      "type": "string",
      "pattern": "^(root|[a-z0-9][a-z0-9.-]*[a-z0-9])$"
    },
    "duration": {
      "type": "string",
      "pattern": "^[0-9]+(s|m|h|d)$"
    },
    "fleet": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "cluster",
        "sites",
        "nodes",
        "capabilities",
        "placement",
        "origins",
        "exposure",
        "sso",
        "renderer_targets"
      ],
      "properties": {
        "cluster": {
          "$ref": "#/$defs/cluster"
        },
        "sites": {
          "type": "object",
          "minProperties": 1,
          "propertyNames": {
            "$ref": "#/$defs/identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/site"
          }
        },
        "nodes": {
          "type": "object",
          "minProperties": 1,
          "propertyNames": {
            "$ref": "#/$defs/identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/node"
          }
        },
        "capabilities": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/capability"
          }
        },
        "placement": {
          "$ref": "#/$defs/placement"
        },
        "origins": {
          "type": "object",
          "minProperties": 1,
          "propertyNames": {
            "$ref": "#/$defs/identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/origin"
          }
        },
        "exposure": {
          "$ref": "#/$defs/exposure"
        },
        "sso": {
          "$ref": "#/$defs/sso"
        },
        "renderer_targets": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/rendererTarget"
          }
        },
        "ingress_intent": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "route_rules": {
              "type": "array",
              "items": {
                "$ref": "#/$defs/routeRule"
              }
            }
          }
        }
      }
    },
    "cluster": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "domain"
      ],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "domain": {
          "$ref": "#/$defs/hostname"
        },
        "platform": {
          "enum": [
            "kubernetes",
            "nomad",
            "mixed",
            "inventory_only"
          ]
        },
        "labels": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/nonEmptyString"
          }
        }
      }
    },
    "site": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind",
        "purpose"
      ],
      "properties": {
        "kind": {
          "enum": [
            "home",
            "vps",
            "cloud",
            "edge",
            "lab",
            "colo",
            "custom"
          ]
        },
        "purpose": {
          "$ref": "#/$defs/identifier"
        },
        "region": {
          "$ref": "#/$defs/identifier"
        },
        "networking": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "lan_cidrs": {
              "type": "array",
              "items": {
                "$ref": "#/$defs/nonEmptyString"
              }
            },
            "wan_address_ref": {
              "$ref": "#/$defs/identifier"
            },
            "lan_ingress_address_ref": {
              "$ref": "#/$defs/identifier"
            },
            "tailnet": {
              "type": "boolean"
            }
          }
        },
        "labels": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/nonEmptyString"
          }
        }
      }
    },
    "node": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "site",
        "arch",
        "roles",
        "capacity",
        "capabilities"
      ],
      "properties": {
        "status": {
          "enum": [
            "active",
            "install_ready",
            "planned",
            "retired",
            "maintenance"
          ]
        },
        "site": {
          "$ref": "#/$defs/identifier"
        },
        "arch": {
          "enum": [
            "amd64",
            "arm64",
            "armv7",
            "riscv64"
          ]
        },
        "roles": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/identifier"
          }
        },
        "capacity": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "cpu_millicores",
            "memory_mib"
          ],
          "properties": {
            "cpu_millicores": {
              "type": "integer",
              "minimum": 1
            },
            "memory_mib": {
              "type": "integer",
              "minimum": 1
            },
            "ephemeral_storage_mib": {
              "type": "integer",
              "minimum": 1
            }
          }
        },
        "capabilities": {
          "type": "array",
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/identifier"
          }
        },
        "accelerators": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/accelerator"
          }
        },
        "addresses": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/nonEmptyString"
          }
        }
      }
    },
    "accelerator": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "vendor",
        "model",
        "class"
      ],
      "properties": {
        "vendor": {
          "$ref": "#/$defs/identifier"
        },
        "model": {
          "$ref": "#/$defs/identifier"
        },
        "class": {
          "$ref": "#/$defs/identifier"
        },
        "count": {
          "type": "integer",
          "minimum": 1
        }
      }
    },
    "capability": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "description"
      ],
      "properties": {
        "description": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "scope": {
          "enum": [
            "node",
            "site",
            "cluster",
            "renderer"
          ]
        },
        "labels": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/nonEmptyString"
          }
        }
      }
    },
    "placement": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "rules": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/placementRule"
          }
        }
      }
    },
    "placementRule": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "selector"
      ],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "selector": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "sites": {
              "type": "array",
              "items": {
                "$ref": "#/$defs/identifier"
              }
            },
            "nodes": {
              "type": "array",
              "items": {
                "$ref": "#/$defs/identifier"
              }
            },
            "required_capabilities": {
              "type": "array",
              "items": {
                "$ref": "#/$defs/identifier"
              }
            },
            "accelerator_classes": {
              "type": "array",
              "items": {
                "$ref": "#/$defs/identifier"
              }
            }
          }
        },
        "applies_to": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/identifier"
          }
        },
        "fallback": {
          "enum": [
            "fail",
            "soft_preference",
            "manual_override"
          ]
        }
      }
    },
    "origin": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind"
      ],
      "properties": {
        "kind": {
          "enum": [
            "proxied_dns",
            "direct_wan",
            "direct_lan",
            "internal_service",
            "custom"
          ]
        },
        "address_ref": {
          "$ref": "#/$defs/identifier"
        },
        "site": {
          "$ref": "#/$defs/identifier"
        },
        "provider": {
          "$ref": "#/$defs/identifier"
        },
        "proxied": {
          "type": "boolean"
        },
        "ttl": {
          "$ref": "#/$defs/duration"
        },
        "metadata": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/nonEmptyString"
          }
        }
      }
    },
    "exposure": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "classes": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/exposureClass"
          }
        },
        "services": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/serviceExposure"
          }
        }
      }
    },
    "exposureClass": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "reachability"
      ],
      "properties": {
        "reachability": {
          "enum": [
            "public",
            "public_and_lan",
            "lan_only",
            "internal_only",
            "monitoring_only",
            "custom"
          ]
        },
        "default_origin": {
          "$ref": "#/$defs/identifier"
        },
        "renderer_hints": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/identifier"
          }
        }
      }
    },
    "serviceExposure": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "class"
      ],
      "properties": {
        "class": {
          "$ref": "#/$defs/identifier"
        },
        "host_label": {
          "$ref": "#/$defs/hostname"
        },
        "origin": {
          "$ref": "#/$defs/identifier"
        },
        "sso_policy": {
          "$ref": "#/$defs/identifier"
        }
      }
    },
    "sso": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "policies": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/ssoPolicy"
          }
        }
      }
    },
    "ssoPolicy": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mode"
      ],
      "properties": {
        "mode": {
          "enum": [
            "none",
            "forward_auth",
            "oidc",
            "token",
            "custom"
          ]
        },
        "provider_ref": {
          "$ref": "#/$defs/identifier"
        },
        "bypass_paths": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^/"
          }
        },
        "required_claims": {
          "type": "object",
          "additionalProperties": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/nonEmptyString"
            }
          }
        }
      }
    },
    "pathList": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^/"
      }
    },
    "routeRule": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "service"
      ],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "service": {
          "$ref": "#/$defs/identifier"
        },
        "access": {
          "enum": [
            "direct",
            "sso_protected",
            "cluster_internal",
            "token_protected"
          ]
        },
        "path_prefixes": {
          "$ref": "#/$defs/pathList"
        },
        "exact_paths": {
          "$ref": "#/$defs/pathList"
        },
        "excluded_path_prefixes": {
          "$ref": "#/$defs/pathList"
        },
        "excluded_exact_paths": {
          "$ref": "#/$defs/pathList"
        },
        "excluded_paths": {
          "$ref": "#/$defs/pathList"
        }
      }
    },
    "rendererTarget": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "kind",
        "status"
      ],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "kind": {
          "enum": [
            "traefik_routes",
            "gatus_endpoints",
            "edge_catalog",
            "image_metadata",
            "vault_policy_inputs",
            "nomad_jobs",
            "kubernetes_workloads",
            "custom"
          ]
        },
        "status": {
          "enum": [
            "implemented",
            "design_only",
            "external"
          ]
        },
        "consumes": {
          "type": "array",
          "items": {
            "enum": [
              "fleet",
              "service_intent",
              "vault_inputs",
              "images",
              "origins",
              "sso",
              "packs"
            ]
          }
        },
        "output_ref": {
          "$ref": "#/$defs/identifier"
        }
      }
    }
  }
} as const;

export const fleetInventorySchema = jsonSchemaBackedZodSchema(fleetInventoryJsonSchema);

export type FleetInventorySchemaInput = unknown;
