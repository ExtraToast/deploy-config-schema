import YAML from "yaml";
import type {
  AdapterContext,
  AdapterFile,
  JsonValue,
  RolloutRestartTarget,
  VaultDynamicSecretsArtifact,
  VaultDynamicSync,
  VaultStaticSync,
} from "./model.js";

const ADAPTER = "vso";
const DEFAULT_VSO_NAMESPACE = "vso-system";
const DEFAULT_CONNECTION_NAME = "default";
const DEFAULT_OPERATOR_SERVICE_ACCOUNT = "vault-secrets-operator";

type VsoOptions = {
  namespace: string;
  connectionName: string;
  vaultAddress: string;
  operatorServiceAccount: string;
};
type VsoOverrides = {
  namespace?: string;
  vaultConnectionName?: string;
  vaultAddress?: string;
  operatorServiceAccount?: string;
};
type ManifestObject = Record<string, unknown>;
type Vault = NonNullable<VaultDynamicSecretsArtifact["vault"]>;

export function renderVso(context: AdapterContext): AdapterFile[] {
  if (!("artifacts" in context)) return [];
  const vault = context.artifacts?.["vault-dynamic-secrets"]?.vault;
  if (!vault) return [];
  const overrides = context.overrides?.vso as VsoOverrides | undefined;

  const options = {
    namespace: overrides?.namespace ?? DEFAULT_VSO_NAMESPACE,
    connectionName: overrides?.vaultConnectionName ?? DEFAULT_CONNECTION_NAME,
    vaultAddress: overrides?.vaultAddress ?? "http://vault.vault-system.svc.cluster.local:8200",
    operatorServiceAccount: overrides?.operatorServiceAccount ?? DEFAULT_OPERATOR_SERVICE_ACCOUNT,
  };
  const appsRoot = context.pathAllocator?.appsRoot ?? "platform/cluster/flux/apps";
  const basePath = `${appsRoot}/vso-secrets`;
  const files = [
    {
      path: `${basePath}/vault-connection.yaml`,
      content: yaml(vaultConnection(options)),
      adapter: ADAPTER,
    },
    {
      path: `${basePath}/vault-auth.yaml`,
      content: yaml(vaultAuth(vault, options)),
      adapter: ADAPTER,
    },
  ];

  const targetNamespaces = new Set<string>();
  for (const sync of Object.values(vault.vso.static_syncs ?? {})) targetNamespaces.add(sync.target.namespace);
  for (const sync of Object.values(vault.vso.dynamic_syncs ?? {})) targetNamespaces.add(sync.target.namespace);
  for (const namespace of [...targetNamespaces].sort()) {
    files.push({
      path: `${basePath}/${namespace}-serviceaccount.yaml`,
      content: yaml(serviceAccount(namespace, options.operatorServiceAccount)),
      adapter: ADAPTER,
    });
  }

  for (const [name, sync] of sortedEntries(vault.vso.static_syncs ?? {})) {
    files.push({
      path: `${basePath}/${name}.yaml`,
      content: yaml(vaultStaticSecret(name, sync, vault, options)),
      adapter: ADAPTER,
    });
  }

  for (const [name, sync] of sortedEntries(vault.vso.dynamic_syncs ?? {})) {
    files.push({
      path: `${basePath}/${name}.yaml`,
      content: yaml(vaultDynamicSecret(name, sync, options)),
      adapter: ADAPTER,
    });
  }

  files.push({
    path: `${basePath}/kustomization.yaml`,
    content: yaml({
      apiVersion: "kustomize.config.k8s.io/v1beta1",
      kind: "Kustomization",
      resources: files.map((file) => file.path.split("/").at(-1)).sort(),
    }),
    adapter: ADAPTER,
  });

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function vaultConnection(options: VsoOptions): ManifestObject {
  return {
    apiVersion: "secrets.hashicorp.com/v1beta1",
    kind: "VaultConnection",
    metadata: {
      name: options.connectionName,
      namespace: options.namespace,
    },
    spec: {
      address: options.vaultAddress,
    },
  };
}

function vaultAuth(vault: Vault, options: VsoOptions): ManifestObject {
  return {
    apiVersion: "secrets.hashicorp.com/v1beta1",
    kind: "VaultAuth",
    metadata: {
      name: DEFAULT_CONNECTION_NAME,
      namespace: options.namespace,
    },
    spec: {
      vaultConnectionRef: options.connectionName,
      method: "kubernetes",
      mount: vault.auth.kubernetes.mount,
      kubernetes: {
        role: vault.vso.auth_role,
        serviceAccount: options.operatorServiceAccount,
      },
    },
  };
}

function serviceAccount(namespace: string, name: string): ManifestObject {
  return {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: { name, namespace },
  };
}

function vaultStaticSecret(name: string, sync: VaultStaticSync, vault: Vault, options: VsoOptions): ManifestObject {
  const kv = vault.kv.paths[sync.kv_path_ref];
  return withoutUndefined({
    apiVersion: "secrets.hashicorp.com/v1beta1",
    kind: "VaultStaticSecret",
    metadata: {
      name,
      namespace: sync.target.namespace,
    },
    spec: withoutUndefined({
      vaultAuthRef: `${options.namespace}/${DEFAULT_CONNECTION_NAME}`,
      type: "kv-v2",
      mount: vault.kv.mount,
      path: normalizeKvPath(kv.path, vault.kv.mount),
      destination: {
        name: sync.target.name,
        create: true,
      },
      refreshAfter: "1h",
      rolloutRestartTargets: rolloutTargets(sync, sync.target.namespace),
    }),
  }) as ManifestObject;
}

function vaultDynamicSecret(name: string, sync: VaultDynamicSync, options: VsoOptions): ManifestObject {
  return withoutUndefined({
    apiVersion: "secrets.hashicorp.com/v1beta1",
    kind: "VaultDynamicSecret",
    metadata: {
      name,
      namespace: sync.target.namespace,
    },
    spec: withoutUndefined({
      vaultAuthRef: `${options.namespace}/${DEFAULT_CONNECTION_NAME}`,
      mount: sync.engine,
      path: `creds/${sync.role}`,
      destination: {
        name: sync.target.name,
        create: true,
      },
      renewalPercent: 67,
      rolloutRestartTargets: rolloutTargets(sync, sync.target.namespace),
    }),
  }) as ManifestObject;
}

function rolloutTargets(sync: { rollout_restart_targets?: RolloutRestartTarget[] }, namespace: string): ManifestObject[] | undefined {
  const targets = (sync.rollout_restart_targets ?? []).map((target) => withoutUndefined({
    kind: target.kind,
    name: target.name,
    ...(target.namespace !== namespace ? { namespace: target.namespace } : {}),
  }) as ManifestObject);
  return targets.length > 0 ? targets : undefined;
}

function normalizeKvPath(path: string, mount: string): string {
  const mountDataPrefix = `${mount}/data/`;
  const mountPrefix = `${mount}/`;
  if (path.startsWith(mountDataPrefix)) return path.slice(mountDataPrefix.length);
  if (path.startsWith(mountPrefix)) return path.slice(mountPrefix.length);
  return path;
}

function yaml(value: unknown): string {
  return YAML.stringify(value, {
    indent: 2,
    lineWidth: 0,
    sortMapEntries: false,
    singleQuote: true,
  }).trimEnd();
}

function sortedEntries<T>(object: Record<string, T> | undefined): Array<[string, T]> {
  return Object.entries(object ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, withoutUndefined(child)]),
  );
}
