import { jsonSchemaBackedZodSchema } from "./support.js";

export const serviceIntentJsonSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.extratoast.com/round3/service-intent.schema.json",
  "title": "ExtraToast Round 3 Service Intent Skeleton",
  "description": "Design-first schema for per-service special-casing and future Nomad input contracts. No production renderer consumes this schema in round 3.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "version",
    "services"
  ],
  "properties": {
    "version": {
      "type": "integer",
      "minimum": 1
    },
    "services": {
      "type": "object",
      "minProperties": 1,
      "propertyNames": {
        "$ref": "#/$defs/identifier"
      },
      "additionalProperties": {
        "$ref": "#/$defs/serviceProfile"
      }
    },
    "renderer": {
      "$ref": "#/$defs/renderer"
    },
    "notes": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/nonEmptyString"
      }
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
    "path": {
      "type": "string",
      "pattern": "^/"
    },
    "hostname": {
      "type": "string",
      "pattern": "^(root|[a-z0-9][a-z0-9.-]*[a-z0-9])$"
    },
    "duration": {
      "type": "string",
      "pattern": "^[0-9]+(s|m|h|d)$"
    },
    "quantity": {
      "type": "string",
      "pattern": "^[0-9]+(m|Mi|Gi|Ti)?$"
    },
    "serviceProfile": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "workload",
        "image"
      ],
      "properties": {
        "description": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "workload": {
          "$ref": "#/$defs/workload"
        },
        "image": {
          "$ref": "#/$defs/image"
        },
        "ports": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/port"
          }
        },
        "runtime": {
          "$ref": "#/$defs/runtime"
        },
        "secrets": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/secretBinding"
          }
        },
        "storage": {
          "$ref": "#/$defs/storage"
        },
        "networking": {
          "$ref": "#/$defs/networking"
        },
        "gatus": {
          "$ref": "#/$defs/gatus"
        },
        "observability": {
          "$ref": "#/$defs/observability"
        },
        "scheduling": {
          "$ref": "#/$defs/scheduling"
        },
        "rollout": {
          "$ref": "#/$defs/rollout"
        },
        "kubernetes": {
          "$ref": "#/$defs/kubernetesContract"
        },
        "nomad": {
          "$ref": "#/$defs/nomadContract"
        },
        "unsupported_until": {
          "type": "array",
          "items": {
            "enum": [
              "schema_review",
              "renderer_fixture",
              "platform_pack",
              "consumer_migration"
            ]
          }
        }
      }
    },
    "workload": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind"
      ],
      "properties": {
        "kind": {
          "enum": [
            "deployment",
            "statefulset",
            "job",
            "cronjob",
            "external_service",
            "host_native",
            "nomad_job"
          ]
        },
        "replicas": {
          "type": "integer",
          "minimum": 0
        },
        "schedule": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "restart_policy": {
          "enum": [
            "Always",
            "OnFailure",
            "Never"
          ]
        },
        "strategy": {
          "enum": [
            "rolling",
            "recreate",
            "replace",
            "blue_green",
            "manual"
          ]
        }
      }
    },
    "image": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "repository",
        "tag"
      ],
      "properties": {
        "repository": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "tag": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "pull_policy": {
          "enum": [
            "Always",
            "IfNotPresent",
            "Never"
          ]
        },
        "pull_secrets": {
          "type": "array",
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/identifier"
          }
        },
        "source": {
          "enum": [
            "first_party",
            "third_party",
            "generated",
            "external"
          ]
        }
      }
    },
    "port": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "container_port"
      ],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "container_port": {
          "type": "integer",
          "minimum": 1,
          "maximum": 65535
        },
        "protocol": {
          "enum": [
            "TCP",
            "UDP"
          ]
        },
        "service_port": {
          "type": "integer",
          "minimum": 1,
          "maximum": 65535
        },
        "exposure": {
          "enum": [
            "public",
            "lan",
            "internal",
            "metrics",
            "admin",
            "none"
          ]
        }
      }
    },
    "runtime": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "env": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/nonEmptyString"
          }
        },
        "files": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/nonEmptyString"
          }
        },
        "env_from": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/secretRef"
          }
        },
        "args": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/nonEmptyString"
          }
        },
        "sidecars": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/containerLike"
          }
        },
        "init_containers": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/containerLike"
          }
        }
      }
    },
    "containerLike": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "image"
      ],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "image": {
          "$ref": "#/$defs/image"
        },
        "args": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/nonEmptyString"
          }
        },
        "env": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/nonEmptyString"
          }
        }
      }
    },
    "secretRef": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name"
      ],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "optional": {
          "type": "boolean"
        }
      }
    },
    "secretBinding": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "source"
      ],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "source": {
          "enum": [
            "kubernetes_secret",
            "vso_static",
            "vault_kv",
            "vault_dynamic_database",
            "vault_dynamic_rabbitmq",
            "vault_transit"
          ]
        },
        "ref": {
          "$ref": "#/$defs/identifier"
        },
        "mount_path": {
          "$ref": "#/$defs/path"
        },
        "env_keys": {
          "type": "array",
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/identifier"
          }
        },
        "lease": {
          "$ref": "#/$defs/lease"
        }
      }
    },
    "lease": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "default_ttl": {
          "$ref": "#/$defs/duration"
        },
        "max_ttl": {
          "$ref": "#/$defs/duration"
        },
        "rotation_mode": {
          "enum": [
            "process_restart",
            "sidecar_renewal",
            "library_lifecycle",
            "manual"
          ]
        }
      }
    },
    "storage": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "volumes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/volume"
          }
        },
        "mounts": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/mount"
          }
        }
      }
    },
    "volume": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "kind"
      ],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "kind": {
          "enum": [
            "pvc",
            "host_path",
            "config_map",
            "secret",
            "empty_dir",
            "ephemeral"
          ]
        },
        "size": {
          "$ref": "#/$defs/quantity"
        },
        "storage_class": {
          "$ref": "#/$defs/identifier"
        },
        "path": {
          "$ref": "#/$defs/path"
        },
        "access_modes": {
          "type": "array",
          "items": {
            "enum": [
              "ReadWriteOnce",
              "ReadWriteMany",
              "ReadOnlyMany"
            ]
          }
        },
        "claim_template": {
          "type": "boolean"
        },
        "portable": {
          "type": "boolean"
        }
      }
    },
    "mount": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "volume",
        "path"
      ],
      "properties": {
        "volume": {
          "$ref": "#/$defs/identifier"
        },
        "path": {
          "$ref": "#/$defs/path"
        },
        "read_only": {
          "type": "boolean"
        }
      }
    },
    "networking": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "host_network": {
          "type": "boolean"
        },
        "routes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/route"
          }
        },
        "service_annotations": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/nonEmptyString"
          }
        }
      }
    },
    "route": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "port"
      ],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "host": {
          "$ref": "#/$defs/nonEmptyString"
        },
        "port": {
          "$ref": "#/$defs/identifier"
        },
        "paths": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/path"
          }
        },
        "bypass_paths": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/path"
          }
        },
        "access": {
          "enum": [
            "direct",
            "sso",
            "token",
            "internal"
          ]
        },
        "origin": {
          "$ref": "#/$defs/identifier"
        },
        "websocket": {
          "type": "boolean"
        },
        "root_redirect": {
          "$ref": "#/$defs/path"
        },
        "middleware_profile": {
          "$ref": "#/$defs/identifier"
        }
      }
    },
    "gatus": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "endpoints": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/probe"
          }
        }
      }
    },
    "probe": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "type"
      ],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "type": {
          "enum": [
            "http",
            "tcp"
          ]
        },
        "port": {
          "$ref": "#/$defs/identifier"
        },
        "path": {
          "$ref": "#/$defs/path"
        },
        "expected_status": {
          "type": "integer",
          "minimum": 100,
          "maximum": 599
        },
        "strategy": {
          "enum": [
            "internal",
            "external",
            "both"
          ]
        },
        "group": {
          "$ref": "#/$defs/identifier"
        }
      }
    },
    "observability": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "metrics": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/monitor"
          }
        },
        "logs": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/nonEmptyString"
          }
        },
        "tracing": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "enabled": {
              "type": "boolean"
            },
            "protocol": {
              "enum": [
                "otlp_http",
                "otlp_grpc",
                "none"
              ]
            }
          }
        }
      }
    },
    "monitor": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind",
        "port"
      ],
      "properties": {
        "kind": {
          "enum": [
            "ServiceMonitor",
            "PodMonitor"
          ]
        },
        "port": {
          "$ref": "#/$defs/identifier"
        },
        "path": {
          "$ref": "#/$defs/path"
        },
        "interval": {
          "$ref": "#/$defs/duration"
        }
      }
    },
    "scheduling": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "site_affinity": {
          "$ref": "#/$defs/identifier"
        },
        "node_affinity": {
          "$ref": "#/$defs/identifier"
        },
        "required_capabilities": {
          "type": "array",
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/identifier"
          }
        },
        "gpu": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "class": {
              "$ref": "#/$defs/identifier"
            },
            "count": {
              "type": "integer",
              "minimum": 1
            }
          }
        },
        "topology_spread": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/identifier"
          }
        }
      }
    },
    "rollout": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "update_strategy": {
          "enum": [
            "pinned",
            "latest_tag",
            "semver",
            "manual"
          ]
        },
        "restart_triggers": {
          "type": "array",
          "items": {
            "enum": [
              "config",
              "secret",
              "image",
              "schedule",
              "manual"
            ]
          }
        },
        "availability": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "pdb_min_available": {
              "type": "integer",
              "minimum": 0
            },
            "max_unavailable": {
              "type": "integer",
              "minimum": 0
            }
          }
        },
        "autoscaling": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "enabled",
            "max_replicas"
          ],
          "properties": {
            "enabled": {
              "type": "boolean"
            },
            "min_replicas": {
              "type": "integer",
              "minimum": 1
            },
            "max_replicas": {
              "type": "integer",
              "minimum": 1
            },
            "target_cpu_utilization": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100
            },
            "target_memory_utilization": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100
            }
          }
        }
      }
    },
    "kubernetesContract": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "namespace_ref": {
          "$ref": "#/$defs/identifier"
        },
        "service_account_ref": {
          "$ref": "#/$defs/identifier"
        },
        "service_ref": {
          "$ref": "#/$defs/identifier"
        },
        "render_status": {
          "enum": [
            "design_only",
            "candidate",
            "implemented_elsewhere"
          ]
        },
        "resource_hints": {
          "type": "array",
          "items": {
            "enum": [
              "Deployment",
              "StatefulSet",
              "Job",
              "CronJob",
              "Service",
              "IngressRoute",
              "PVC",
              "PDB",
              "HPA",
              "ServiceMonitor",
              "PodMonitor",
              "VaultStaticSecret"
            ]
          }
        },
        "pod_spec": {
          "type": "object",
          "additionalProperties": true
        },
        "raw_manifests": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true
          }
        }
      }
    },
    "nomadContract": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "renderer_status",
        "implementation_prerequisites"
      ],
      "properties": {
        "renderer_status": {
          "const": "design_only"
        },
        "implementation_prerequisites": {
          "type": "array",
          "minItems": 1,
          "items": {
            "enum": [
              "representative_input_fixture",
              "expected_output_fixture",
              "operator_review",
              "platform_boundary_review"
            ]
          }
        },
        "datacenters": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/identifier"
          }
        },
        "groups": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/nomadGroup"
          }
        },
        "restart": {
          "type": "object",
          "additionalProperties": true
        },
        "update": {
          "type": "object",
          "additionalProperties": true
        }
      }
    },
    "nomadGroup": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name"
      ],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "count": {
          "type": "integer",
          "minimum": 1
        },
        "tasks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/nomadTask"
          }
        },
        "volumes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/volume"
          }
        },
        "networks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/port"
          }
        }
      }
    },
    "nomadTask": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "driver"
      ],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "driver": {
          "enum": [
            "docker",
            "exec",
            "java",
            "raw_exec",
            "custom"
          ]
        },
        "resources": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "cpu_mhz": {
              "type": "integer",
              "minimum": 1
            },
            "memory_mb": {
              "type": "integer",
              "minimum": 1
            }
          }
        },
        "services": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/nomadService"
          }
        },
        "templates": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/nomadTemplate"
          }
        }
      }
    },
    "nomadService": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "port"
      ],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "port": {
          "$ref": "#/$defs/identifier"
        },
        "checks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/probe"
          }
        },
        "tags": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/nonEmptyString"
          }
        }
      }
    },
    "nomadTemplate": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "destination"
      ],
      "properties": {
        "destination": {
          "$ref": "#/$defs/path"
        },
        "source_ref": {
          "$ref": "#/$defs/identifier"
        },
        "change_mode": {
          "enum": [
            "noop",
            "signal",
            "restart",
            "script"
          ]
        }
      }
    },
    "renderer": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "cluster_name": {
          "$ref": "#/$defs/identifier"
        },
        "public_domain": {
          "$ref": "#/$defs/hostname"
        },
        "host_native_node": {
          "$ref": "#/$defs/identifier"
        },
        "adapters": {
          "type": "array",
          "uniqueItems": true,
          "items": {
            "enum": [
              "traefik-public",
              "traefik-lan",
              "gatus",
              "edge-catalog",
              "edge-route-catalog",
              "image-metadata",
              "kubernetes",
              "flux-root",
              "flux-packs",
              "flux-source",
              "nix-hosts",
              "vso"
            ]
          }
        },
        "output_paths": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/nonEmptyString"
          }
        },
        "namespaces": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/identifier"
          }
        },
        "configmap_names": {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/identifier"
          },
          "additionalProperties": {
            "$ref": "#/$defs/identifier"
          }
        },
        "ingress_defaults": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "namespace": {
              "$ref": "#/$defs/identifier"
            },
            "public_ingress_class": {
              "$ref": "#/$defs/identifier"
            },
            "lan_ingress_class": {
              "$ref": "#/$defs/identifier"
            },
            "entrypoint": {
              "$ref": "#/$defs/identifier"
            },
            "tls": {
              "type": "boolean"
            },
            "public_dns_target": {
              "$ref": "#/$defs/hostname"
            },
            "sso_middleware": {
              "$ref": "#/$defs/identifier"
            }
          }
        }
      }
    }
  }
} as const;

export const serviceIntentSchema = jsonSchemaBackedZodSchema(serviceIntentJsonSchema);

export type ServiceIntentSchemaInput = unknown;
