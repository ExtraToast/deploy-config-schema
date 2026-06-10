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
    validateService(serviceName, service);
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
    if (docs.autoscaling.length > 0) {
      files.push(file(basePath, "hpa.yaml", docs.autoscaling));
      resources.push("hpa.yaml");
    }
    if (docs.monitoring.length > 0) {
      files.push(file(basePath, "servicemonitor.yaml", docs.monitoring));
      resources.push("servicemonitor.yaml");
    }
    if (docs.podMonitoring.length > 0) {
      files.push(file(basePath, "podmonitor.yaml", docs.podMonitoring));
      resources.push("podmonitor.yaml");
    }
    if (docs.raw.length > 0) {
      files.push(file(basePath, "raw.yaml", docs.raw));
      resources.push("raw.yaml");
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
  const autoscaling = hpaManifest(serviceName, service, namespace);
  const monitors = monitorManifests(serviceName, service, namespace).filter((doc) => doc.kind === "ServiceMonitor");
  const podMonitors = monitorManifests(serviceName, service, namespace).filter((doc) => doc.kind === "PodMonitor");
  const raw = rawManifests(service, namespace);

  if (workloadKind === "external_service" || workloadKind === "host_native" || workloadKind === "nomad_job") {
    return { workload: serviceDoc ? [serviceDoc] : [], config: [], storage, policy: [], autoscaling: [], monitoring: monitors, podMonitoring: podMonitors, raw };
  }

  return {
    workload: workloadDocs,
    config: config ? [config] : [],
    storage,
    policy: policy ? [policy] : [],
    autoscaling: autoscaling ? [autoscaling] : [],
    monitoring: monitors,
    podMonitoring: podMonitors,
    raw,
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
  if (kind === "StatefulSet") {
    const templates = volumeClaimTemplates(serviceName, service);
    if (templates.length > 0) spec.volumeClaimTemplates = templates;
  }
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
  const runtime = service.runtime ?? {};
  const spec = {
    containers: [
      container(serviceName, service, vaultSecrets),
      ...(runtime.sidecars ?? []).map(containerLike),
    ],
    restartPolicy: options.restartPolicy ?? service.workload?.restart_policy ?? "Always",
  };
  if ((runtime.init_containers ?? []).length > 0) spec.initContainers = runtime.init_containers.map(containerLike);
  const pullSecrets = service.image?.pull_secrets ?? [];
  if (pullSecrets.length > 0) spec.imagePullSecrets = pullSecrets.map((name) => ({ name }));
  const accountName = serviceAccountName(service, serviceName);
  if (accountName) spec.serviceAccountName = accountName;
  const volumes = podVolumes(serviceName, service);
  if (volumes.length > 0) spec.volumes = volumes;
  Object.assign(spec, schedulingSpec(serviceName, service, artifacts));
  Object.assign(spec, cloneSorted(service.kubernetes?.pod_spec ?? {}));
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
  if ((runtime.env_from ?? []).length > 0) {
    item.envFrom = runtime.env_from.map((ref) => ({
      secretRef: {
        name: ref.name,
        ...(ref.optional !== undefined ? { optional: ref.optional } : {}),
      },
    }));
  }
  const mounts = volumeMounts(service);
  if (mounts.length > 0) item.volumeMounts = mounts;
  const probe = probeFor(service);
  if (probe) {
    item.readinessProbe = probe;
    item.livenessProbe = structuredClone(probe);
  }
  return item;
}

function containerLike(item) {
  const result = {
    name: item.name,
    image: `${item.image.repository}:${item.image.tag}`,
    imagePullPolicy: item.image.pull_policy ?? (item.image.tag === "latest" ? "Always" : "IfNotPresent"),
  };
  if ((item.args ?? []).length > 0) result.args = [...item.args];
  const env = sortedEntries(item.env ?? {}).map(([name, value]) => ({ name, value }));
  if (env.length > 0) result.env = env;
  return result;
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
  const data = sortObject({
    ...(service.runtime?.env ?? {}),
    ...(service.runtime?.files ?? {}),
  });
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
    .filter((volume) => (volume.kind === "pvc" || volume.kind === "host_path") && !volume.claim_template)
    .flatMap((volume) => {
      const claim = pvcManifest(serviceName, volume, namespace);
      if (volume.kind !== "host_path") return [claim];
      return [pvManifest(serviceName, volume, service), claim];
    });
}

function volumeClaimTemplates(serviceName, service) {
  return (service.storage?.volumes ?? [])
    .filter((volume) => volume.claim_template)
    .map((volume) => pvcManifest(serviceName, volume, undefined));
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

function hpaManifest(serviceName, service, namespace) {
  const autoscaling = service.rollout?.autoscaling;
  if (!autoscaling?.enabled) return undefined;
  const metrics = [];
  if (autoscaling.target_cpu_utilization !== undefined) {
    metrics.push(resourceMetric("cpu", autoscaling.target_cpu_utilization));
  }
  if (autoscaling.target_memory_utilization !== undefined) {
    metrics.push(resourceMetric("memory", autoscaling.target_memory_utilization));
  }
  return {
    apiVersion: "autoscaling/v2",
    kind: "HorizontalPodAutoscaler",
    metadata: metadata(serviceName, namespace),
    spec: {
      scaleTargetRef: {
        apiVersion: "apps/v1",
        kind: workloadApiKind(service),
        name: serviceName,
      },
      minReplicas: autoscaling.min_replicas ?? 1,
      maxReplicas: autoscaling.max_replicas,
      ...(metrics.length > 0 ? { metrics } : {}),
    },
  };
}

function resourceMetric(name, averageUtilization) {
  return {
    type: "Resource",
    resource: {
      name,
      target: {
        type: "Utilization",
        averageUtilization,
      },
    },
  };
}

function workloadApiKind(service) {
  const kind = service.workload?.kind ?? "deployment";
  if (kind === "statefulset") return "StatefulSet";
  return "Deployment";
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
  return (service.storage?.volumes ?? []).filter((volume) => !volume.claim_template).map((volume) => {
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

function rawManifests(service, namespace) {
  return (service.kubernetes?.raw_manifests ?? []).map((manifest) => withDefaultNamespace(cloneSorted(manifest), namespace));
}

function withDefaultNamespace(manifest, namespace) {
  if (!manifest?.metadata || manifest.metadata.namespace || manifest.kind === "Namespace") return manifest;
  return {
    ...manifest,
    metadata: {
      ...manifest.metadata,
      namespace,
    },
  };
}

function validateService(serviceName, service) {
  const declaredPorts = new Set((service.ports ?? []).map((port) => port.name));
  for (const route of service.networking?.routes ?? []) {
    assertDeclared(declaredPorts, route.port, `service ${serviceName} route ${route.name} references undeclared port ${route.port}`);
  }
  for (const probe of service.gatus?.endpoints ?? []) {
    assertDeclared(declaredPorts, probe.port, `service ${serviceName} probe ${probe.name} references undeclared port ${probe.port}`);
  }
  for (const monitor of service.observability?.metrics ?? []) {
    assertDeclared(declaredPorts, monitor.port, `service ${serviceName} ${monitor.kind} references undeclared port ${monitor.port}`);
  }

  const declaredVolumes = new Set((service.storage?.volumes ?? []).map((volume) => volume.name));
  for (const mount of service.storage?.mounts ?? []) {
    assertDeclared(declaredVolumes, mount.volume, `service ${serviceName} mount ${mount.path} references undeclared volume ${mount.volume}`);
  }

  for (const volume of service.storage?.volumes ?? []) {
    if (volume.kind !== "host_path" || volume.portable) continue;
    if (!service.scheduling?.node_affinity && !service.scheduling?.site_affinity && (service.scheduling?.required_capabilities ?? []).length === 0) {
      throw new Error(`service ${serviceName} host_path volume ${volume.name} requires node or host affinity unless marked portable`);
    }
  }

  for (const secret of service.secrets ?? []) {
    rejectSecretMaterial(secret, `service ${serviceName} secret ${secret.name}`);
  }
  for (const manifest of service.kubernetes?.raw_manifests ?? []) {
    rejectRawSecret(manifest, `service ${serviceName} raw manifest ${manifest.kind ?? "unknown"}`);
  }
}

function assertDeclared(declared, value, message) {
  if (!value || declared.has(value)) return;
  throw new Error(message);
}

function rejectSecretMaterial(value, path) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["value", "values", "data", "stringData", "literal", "secret_value"].includes(key)) {
      throw new Error(`${path} contains secret material in ${key}; use a secret reference instead`);
    }
    rejectSecretMaterial(child, `${path}.${key}`);
  }
}

function rejectRawSecret(manifest, path) {
  if (manifest?.kind === "Secret" && (manifest.data || manifest.stringData)) {
    throw new Error(`${path} contains Secret data; use a secret reference instead`);
  }
  rejectSecretMaterial(manifest?.metadata?.annotations, `${path}.metadata.annotations`);
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
    ...(namespace ? { namespace } : {}),
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

function cloneSorted(value) {
  if (Array.isArray(value)) return value.map(cloneSorted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(sortedEntries(value).map(([key, child]) => [key, cloneSorted(child)]));
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
