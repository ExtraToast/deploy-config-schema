import YAML from "yaml";

const ADAPTER = "kubernetes";

export function renderKubernetes(context) {
  const artifacts = context.artifacts ?? {};
  const serviceIntent = artifacts["service-intent"];
  if (!serviceIntent?.services) return [];

  const appsRoot = context.pathAllocator?.appsRoot ?? "platform/cluster/flux/apps";
  const deployConfig = artifacts["deploy-config"];
  const serviceGroups = serviceGroupMap(deployConfig, serviceIntent);
  const vaultSecrets = vsoSecretTargets(artifacts["vault-dynamic-secrets"]);

  return sortedEntries(serviceIntent.services).flatMap(([serviceName, service]) => {
    if (service.kubernetes?.render_status === "implemented_elsewhere") return [];
    const namespace = service.kubernetes?.namespace_ref ?? "default";
    const group = serviceGroups.get(serviceName) ?? groupForNamespace(namespace);
    const basePath = `${appsRoot}/${group}/${serviceName}`;
    const docs = serviceDocuments(serviceName, service, namespace, vaultSecrets, artifacts);
    const resources = [];
    const files = [];

    if (namespace !== "default") {
      files.push(file(basePath, "namespace.yaml", [namespaceDocument(namespace)]));
      resources.push("namespace.yaml");
    }

    if (needsServiceAccount(service)) {
      files.push(file(basePath, "serviceaccount.yaml", [serviceAccountDocument(serviceAccountName(service, serviceName), namespace)]));
      resources.push("serviceaccount.yaml");
    }

    if (docs.workload.length > 0) {
      files.push(file(basePath, workloadFileName(service), docs.workload));
      resources.push(workloadFileName(service));
    }
    if (docs.config.length > 0) {
      files.push(file(basePath, "configmap.yaml", docs.config));
      resources.push("configmap.yaml");
    }
    if (docs.storage.length > 0) {
      files.push(file(basePath, "pvc.yaml", docs.storage));
      resources.push("pvc.yaml");
    }
    if (docs.policy.length > 0) {
      files.push(file(basePath, "pdb.yaml", docs.policy));
      resources.push("pdb.yaml");
    }
    if (docs.monitoring.length > 0) {
      files.push(file(basePath, "servicemonitor.yaml", docs.monitoring.filter((doc) => doc.kind === "ServiceMonitor")));
      resources.push("servicemonitor.yaml");
    }
    if (docs.podMonitoring.length > 0) {
      files.push(file(basePath, "podmonitor.yaml", docs.podMonitoring));
      resources.push("podmonitor.yaml");
    }

    files.push({
      path: `${basePath}/kustomization.yaml`,
      content: yaml({
        apiVersion: "kustomize.config.k8s.io/v1beta1",
        kind: "Kustomization",
        resources,
      }),
      adapter: ADAPTER,
    });
    return files;
  }).sort(compareFiles);
}

function serviceDocuments(serviceName, service, namespace, vaultSecrets, artifacts) {
  const workloadKind = service.workload?.kind ?? "deployment";
  const workload = workloadManifest(serviceName, service, namespace, vaultSecrets, artifacts);
  const serviceDoc = serviceManifest(serviceName, service, namespace);
  const workloadDocs = [workload, serviceDoc].filter(Boolean);
  const config = configMapManifest(serviceName, service, namespace);
  const storage = storageManifests(serviceName, service, namespace);
  const policy = pdbManifest(serviceName, service, namespace);
  const monitors = monitorManifests(serviceName, service, namespace).filter((doc) => doc.kind === "ServiceMonitor");
  const podMonitors = monitorManifests(serviceName, service, namespace).filter((doc) => doc.kind === "PodMonitor");

  if (workloadKind === "external_service" || workloadKind === "host_native" || workloadKind === "nomad_job") {
    return { workload: serviceDoc ? [serviceDoc] : [], config: [], storage, policy: [], monitoring: monitors, podMonitoring: podMonitors };
  }

  return {
    workload: workloadDocs,
    config: config ? [config] : [],
    storage,
    policy: policy ? [policy] : [],
    monitoring: monitors,
    podMonitoring: podMonitors,
  };
}

function workloadManifest(serviceName, service, namespace, vaultSecrets, artifacts) {
  const kind = service.workload?.kind ?? "deployment";
  if (kind === "cronjob") return cronJobManifest(serviceName, service, namespace, vaultSecrets, artifacts);
  if (kind === "job") return jobManifest(serviceName, service, namespace, vaultSecrets, artifacts);
  if (kind === "statefulset") return controllerManifest("StatefulSet", serviceName, service, namespace, vaultSecrets, artifacts);
  return controllerManifest("Deployment", serviceName, service, namespace, vaultSecrets, artifacts);
}

function controllerManifest(kind, serviceName, service, namespace, vaultSecrets, artifacts) {
  const spec = {
    replicas: service.workload?.replicas ?? 1,
    selector: { matchLabels: labels(serviceName) },
    template: podTemplate(serviceName, service, vaultSecrets, artifacts),
  };
  if (kind === "StatefulSet") spec.serviceName = service.kubernetes?.service_ref ?? serviceName;
  if (kind === "Deployment") {
    spec.strategy = deploymentStrategy(service);
    if (service.rollout?.update_strategy === "latest_tag" || service.image?.tag === "latest") {
      spec.progressDeadlineSeconds = 600;
    }
  }
  return {
    apiVersion: "apps/v1",
    kind,
    metadata: metadata(serviceName, namespace, keelAnnotations(service)),
    spec,
  };
}

function jobManifest(serviceName, service, namespace, vaultSecrets, artifacts) {
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: metadata(serviceName, namespace, keelAnnotations(service)),
    spec: {
      template: podTemplate(serviceName, service, vaultSecrets, artifacts, { restartPolicy: service.workload?.restart_policy ?? "OnFailure" }),
    },
  };
}

function cronJobManifest(serviceName, service, namespace, vaultSecrets, artifacts) {
  return {
    apiVersion: "batch/v1",
    kind: "CronJob",
    metadata: metadata(serviceName, namespace, keelAnnotations(service)),
    spec: {
      schedule: service.workload?.schedule ?? "0 * * * *",
      jobTemplate: {
        spec: {
          template: podTemplate(serviceName, service, vaultSecrets, artifacts, { restartPolicy: service.workload?.restart_policy ?? "OnFailure" }),
        },
      },
    },
  };
}

function podTemplate(serviceName, service, vaultSecrets, artifacts, options = {}) {
  const spec = {
    containers: [container(serviceName, service, vaultSecrets)],
    restartPolicy: options.restartPolicy ?? service.workload?.restart_policy ?? "Always",
  };
  const pullSecrets = service.image?.pull_secrets ?? [];
  if (pullSecrets.length > 0) spec.imagePullSecrets = pullSecrets.map((name) => ({ name }));
  const accountName = serviceAccountName(service, serviceName);
  if (accountName) spec.serviceAccountName = accountName;
  const volumes = podVolumes(serviceName, service);
  if (volumes.length > 0) spec.volumes = volumes;
  Object.assign(spec, schedulingSpec(serviceName, service, artifacts));
  return {
    metadata: { labels: labels(serviceName) },
    spec,
  };
}

function container(serviceName, service, vaultSecrets) {
  const ports = (service.ports ?? []).map((port) => ({
    containerPort: port.container_port,
    name: port.name,
    ...(port.protocol ? { protocol: port.protocol } : {}),
  }));
  const runtime = service.runtime ?? {};
  const item = {
    name: serviceName,
    image: `${service.image.repository}:${service.image.tag}`,
    imagePullPolicy: service.image.pull_policy ?? (service.image.tag === "latest" ? "Always" : "IfNotPresent"),
  };
  if (ports.length > 0) item.ports = ports;
  const env = envVars(serviceName, service, vaultSecrets);
  if (env.length > 0) item.env = env;
  if ((runtime.args ?? []).length > 0) item.args = [...runtime.args];
  const mounts = volumeMounts(service);
  if (mounts.length > 0) item.volumeMounts = mounts;
  const probe = probeFor(service);
  if (probe) {
    item.readinessProbe = probe;
    item.livenessProbe = structuredClone(probe);
  }
  return item;
}

function envVars(serviceName, service, vaultSecrets) {
  const configEntries = sortedEntries(service.runtime?.env ?? {}).map(([name]) => ({
    name,
    valueFrom: {
      configMapKeyRef: {
        name: `${serviceName}-config`,
        key: name,
      },
    },
  }));
  const secretEntries = (service.secrets ?? []).flatMap((secret) => {
    const secretName = secretSecretName(secret, vaultSecrets);
    return (secret.env_keys ?? []).map((key) => ({
      name: key.toUpperCase().replaceAll(/[^A-Z0-9_]/g, "_"),
      valueFrom: {
        secretKeyRef: {
          name: secretName,
          key,
        },
      },
    }));
  });
  return [...configEntries, ...secretEntries].sort((left, right) => left.name.localeCompare(right.name));
}

function serviceManifest(serviceName, service, namespace) {
  const ports = (service.ports ?? [])
    .filter((port) => port.service_port)
    .map((port) => ({
      name: port.name,
      port: port.service_port,
      targetPort: port.name,
      ...(port.protocol ? { protocol: port.protocol } : {}),
    }));
  if (ports.length === 0) return undefined;
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      ...metadata(service.kubernetes?.service_ref ?? serviceName, namespace),
      ...(Object.keys(service.networking?.service_annotations ?? {}).length > 0
        ? { annotations: sortObject(service.networking.service_annotations) }
        : {}),
    },
    spec: {
      selector: labels(serviceName),
      ports,
    },
  };
}

function configMapManifest(serviceName, service, namespace) {
  const data = sortObject(service.runtime?.env ?? {});
  if (Object.keys(data).length === 0) return undefined;
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: metadata(`${serviceName}-config`, namespace),
    data,
  };
}

function storageManifests(serviceName, service, namespace) {
  return (service.storage?.volumes ?? [])
    .filter((volume) => volume.kind === "pvc" || volume.kind === "host_path")
    .flatMap((volume) => {
      const claim = pvcManifest(serviceName, volume, namespace);
      if (volume.kind !== "host_path") return [claim];
      return [pvManifest(serviceName, volume, service), claim];
    });
}

function pvManifest(serviceName, volume, service) {
  const name = storageName(serviceName, volume);
  const spec = {
    capacity: { storage: volume.size ?? "1Gi" },
    accessModes: volume.access_modes ?? ["ReadWriteOnce"],
    persistentVolumeReclaimPolicy: "Retain",
    storageClassName: "",
    hostPath: {
      path: volume.path,
      type: "DirectoryOrCreate",
    },
  };
  if (service.scheduling?.node_affinity) {
    spec.nodeAffinity = {
      required: {
        nodeSelectorTerms: [{
          matchExpressions: [{
            key: "kubernetes.io/hostname",
            operator: "In",
            values: [service.scheduling.node_affinity],
          }],
        }],
      },
    };
  }
  return {
    apiVersion: "v1",
    kind: "PersistentVolume",
    metadata: { name },
    spec,
  };
}

function pvcManifest(serviceName, volume, namespace) {
  const name = storageName(serviceName, volume);
  const spec = {
    accessModes: volume.access_modes ?? ["ReadWriteOnce"],
    resources: { requests: { storage: volume.size ?? "1Gi" } },
  };
  if (volume.kind === "host_path") {
    spec.storageClassName = "";
    spec.volumeName = name;
  } else if (volume.storage_class) {
    spec.storageClassName = volume.storage_class;
  }
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: metadata(name, namespace),
    spec,
  };
}

function pdbManifest(serviceName, service, namespace) {
  const availability = service.rollout?.availability;
  if (!availability) return undefined;
  const spec = { selector: { matchLabels: labels(serviceName) } };
  if (availability.pdb_min_available !== undefined) spec.minAvailable = availability.pdb_min_available;
  if (availability.max_unavailable !== undefined) spec.maxUnavailable = availability.max_unavailable;
  if (spec.minAvailable === undefined && spec.maxUnavailable === undefined) return undefined;
  return {
    apiVersion: "policy/v1",
    kind: "PodDisruptionBudget",
    metadata: metadata(serviceName, namespace),
    spec,
  };
}

function monitorManifests(serviceName, service, namespace) {
  return (service.observability?.metrics ?? []).map((monitor) => ({
    apiVersion: "monitoring.coreos.com/v1",
    kind: monitor.kind,
    metadata: {
      name: serviceName,
      namespace,
      labels: { release: "metrics-stack" },
    },
    spec: {
      jobLabel: "app.kubernetes.io/name",
      selector: { matchLabels: labels(serviceName) },
      [monitor.kind === "ServiceMonitor" ? "endpoints" : "podMetricsEndpoints"]: [{
        port: monitor.port,
        path: monitor.path ?? "/metrics",
        interval: monitor.interval ?? "30s",
        scheme: "http",
      }],
    },
  }));
}

function schedulingSpec(serviceName, service, artifacts) {
  const scheduling = service.scheduling ?? {};
  const fleet = artifacts["fleet-inventory"]?.fleet;
  const clusterName = fleet?.cluster?.name ?? serviceIntentClusterName(artifacts) ?? "platform";
  const nodeSelector = {};
  if (scheduling.node_affinity) nodeSelector["kubernetes.io/hostname"] = scheduling.node_affinity;
  if (Object.keys(nodeSelector).length > 0) return { nodeSelector };

  const matchExpressions = [];
  if (scheduling.site_affinity) {
    matchExpressions.push({
      key: `${clusterName}/site`,
      operator: "In",
      values: [scheduling.site_affinity],
    });
  }
  for (const capability of scheduling.required_capabilities ?? []) {
    matchExpressions.push({
      key: `${clusterName}/capability-${capability}`,
      operator: "In",
      values: ["true"],
    });
  }
  const result = {};
  if (matchExpressions.length > 0) {
    result.affinity = {
      nodeAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [{ matchExpressions }],
        },
      },
    };
  }
  if ((scheduling.topology_spread ?? []).length > 0) {
    result.topologySpreadConstraints = scheduling.topology_spread.map((topologyKey) => ({
      maxSkew: 1,
      topologyKey: topologyKey === "hostname" ? "kubernetes.io/hostname" : topologyKey,
      whenUnsatisfiable: "ScheduleAnyway",
      labelSelector: { matchLabels: labels(serviceName) },
    }));
  }
  return result;
}

function serviceIntentClusterName(artifacts) {
  return artifacts["service-intent"]?.renderer?.cluster_name;
}

function podVolumes(serviceName, service) {
  return (service.storage?.volumes ?? []).map((volume) => {
    if (volume.kind === "config_map") return { name: volume.name, configMap: { name: volume.name } };
    if (volume.kind === "secret") return { name: volume.name, secret: { secretName: volume.name } };
    if (volume.kind === "empty_dir" || volume.kind === "ephemeral") return { name: volume.name, emptyDir: {} };
    return { name: volume.name, persistentVolumeClaim: { claimName: storageName(serviceName, volume) } };
  });
}

function volumeMounts(service) {
  return (service.storage?.mounts ?? []).map((mount) => ({
    name: mount.volume,
    mountPath: mount.path,
    ...(mount.read_only ? { readOnly: true } : {}),
  }));
}

function probeFor(service) {
  const probe = service.gatus?.endpoints?.[0];
  if (!probe) return undefined;
  if (probe.type === "tcp") {
    return { tcpSocket: { port: probe.port }, timeoutSeconds: 5 };
  }
  return {
    httpGet: {
      path: probe.path ?? "/",
      port: probe.port,
    },
    timeoutSeconds: 5,
  };
}

function deploymentStrategy(service) {
  if (service.workload?.strategy === "recreate") return { type: "Recreate" };
  return {
    type: "RollingUpdate",
    rollingUpdate: {
      maxSurge: 1,
      maxUnavailable: service.rollout?.availability?.max_unavailable ?? 0,
    },
  };
}

function keelAnnotations(service) {
  if (service.rollout?.update_strategy !== "latest_tag" && service.image?.tag !== "latest") return {};
  return {
    "keel.sh/policy": "force",
    "keel.sh/match-tag": "true",
    "keel.sh/trigger": "poll",
    "keel.sh/pollSchedule": "@every 2m",
  };
}

function namespaceDocument(namespace) {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name: namespace },
  };
}

function serviceAccountDocument(name, namespace) {
  return {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: { name, namespace },
  };
}

function metadata(name, namespace, annotations = {}) {
  return {
    name,
    namespace,
    ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
  };
}

function labels(serviceName) {
  return { "app.kubernetes.io/name": serviceName };
}

function storageName(serviceName, volume) {
  if (volume.name === serviceName || volume.name.startsWith(`${serviceName}-`)) return volume.name;
  return `${serviceName}-${volume.name}`;
}

function needsServiceAccount(service) {
  return Boolean(service.kubernetes?.service_account_ref) || (service.secrets ?? []).some((secret) => secret.source !== "kubernetes_secret");
}

function serviceAccountName(service, serviceName) {
  if (service.kubernetes?.service_account_ref) return service.kubernetes.service_account_ref;
  if ((service.secrets ?? []).some((secret) => secret.source !== "kubernetes_secret")) return serviceName;
  return undefined;
}

function secretSecretName(secret, vaultSecrets) {
  return secret.ref ?? vaultSecrets.get(secret.name) ?? secret.name;
}

function vsoSecretTargets(vaultDynamicSecrets) {
  const targets = new Map();
  for (const [name, sync] of sortedEntries(vaultDynamicSecrets?.vault?.vso?.static_syncs ?? {})) {
    targets.set(name, sync.target.name);
  }
  for (const [name, sync] of sortedEntries(vaultDynamicSecrets?.vault?.vso?.dynamic_syncs ?? {})) {
    targets.set(name, sync.target.name);
  }
  return targets;
}

function workloadFileName(service) {
  const kind = service.workload?.kind ?? "deployment";
  if (kind === "statefulset") return "statefulset.yaml";
  if (kind === "job") return "job.yaml";
  if (kind === "cronjob") return "cronjob.yaml";
  return "deployment.yaml";
}

function serviceGroupMap(deployConfig, serviceIntent) {
  const groups = new Map();
  for (const [group, serviceNames] of sortedEntries(deployConfig?.service_intent?.kubernetes ?? {})) {
    for (const serviceName of serviceNames) groups.set(serviceName, group.replaceAll("_", "-"));
  }
  for (const [serviceName, service] of sortedEntries(serviceIntent.services ?? {})) {
    if (!groups.has(serviceName)) groups.set(serviceName, groupForNamespace(service.kubernetes?.namespace_ref ?? "default"));
  }
  return groups;
}

function groupForNamespace(namespace) {
  if (namespace === "default") return "stateless";
  return namespace.replace(/-system$/, "").replaceAll("_", "-");
}

function file(basePath, name, documents) {
  return {
    path: `${basePath}/${name}`,
    content: documents.map(yaml).join("\n---\n"),
    adapter: ADAPTER,
  };
}

function yaml(value) {
  return YAML.stringify(value, {
    indent: 2,
    lineWidth: 0,
    sortMapEntries: false,
    singleQuote: true,
  }).trimEnd();
}

function sortedEntries(object) {
  return Object.entries(object ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

function sortObject(object) {
  return Object.fromEntries(sortedEntries(object));
}

function compareFiles(left, right) {
  return left.path.localeCompare(right.path) || left.adapter.localeCompare(right.adapter);
}
