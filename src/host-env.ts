type StringMap = Record<string, unknown>;

type SshConfig = {
  host?: unknown;
  user?: unknown;
  port?: unknown;
};

export type HostEnvOptions = {
  install?: boolean;
};

export class HostEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostEnvError";
  }
}

export function hostEnvLines(fleet: unknown, nodeName: string, options: HostEnvOptions = {}): string {
  const fleetObject = asRecord(fleet) ?? {};
  const nodes = asRecord(fleetObject.nodes) ?? {};
  const node = asRecord(nodes[nodeName]);

  if (!node) {
    throw new HostEnvError(`Unknown node: ${nodeName}`);
  }

  const ssh = options.install ? installSsh(node) : asSsh(node.ssh);
  const bootstrapSsh = asSsh(node.bootstrap_ssh);
  const kubernetes = asRecord(asRecord(fleetObject.cluster)?.kubernetes);
  const arch = value(node.arch);

  const lines = [
    ["NODE_NAME", nodeName],
    ["NODE_STATUS", value(node.status)],
    ["NODE_SITE", value(node.site)],
    ["NODE_ARCH", arch],
    ["NIX_SYSTEM", nixSystem(arch)],
    ["K3S_BOOTSTRAP_CONTROL_PLANE_NODE", value(kubernetes?.bootstrap_control_plane)],
    ["K3S_API_SERVER_ENDPOINT", value(kubernetes?.api_server_endpoint)],
    ["K3S_CONTROL_PLANE_TOKEN_FILE", value(kubernetes?.control_plane_token_file)],
    ["K3S_WORKER_JOIN_TOKEN_FILE", value(kubernetes?.worker_join_token_file)],
    ["HAS_SSH", booleanValue(ssh !== undefined)],
    ["HAS_BOOTSTRAP_SSH", booleanValue(bootstrapSsh !== undefined)],
    ["SSH_HOST", sshValue(ssh, "host")],
    ["SSH_USER", sshValue(ssh, "user")],
    ["SSH_PORT", sshValue(ssh, "port")],
    ["BOOTSTRAP_SSH_HOST", sshValue(bootstrapSsh, "host")],
    ["BOOTSTRAP_SSH_USER", sshValue(bootstrapSsh, "user")],
    ["BOOTSTRAP_SSH_PORT", sshValue(bootstrapSsh, "port")],
    ["IS_CONTROL_PLANE", booleanValue(includesString(node.target_roles, "k3s-control-plane"))],
    ["IS_WORKER", booleanValue(includesString(node.target_roles, "k3s-worker"))],
    ["IS_UTILITY_HOST", booleanValue(includesString(node.target_roles, "utility-host"))],
    ["HAS_NVIDIA", booleanValue(includesString(node.capabilities, "nvidia"))],
  ];

  return `${lines.map(([key, lineValue]) => `${key}=${lineValue}`).join("\n")}\n`;
}

function installSsh(node: StringMap): SshConfig | undefined {
  const bootstrapSsh = asSsh(node.bootstrap_ssh);
  if (value(node.status) === "active") {
    return bootstrapSsh ?? asSsh(node.ssh);
  }
  return bootstrapSsh;
}

function nixSystem(arch: string): string {
  if (arch === "amd64") return "x86_64-linux";
  if (arch === "arm64") return "aarch64-linux";
  throw new HostEnvError(`Unsupported arch ${arch}`);
}

function asRecord(valueToCheck: unknown): StringMap | undefined {
  if (typeof valueToCheck !== "object" || valueToCheck === null || Array.isArray(valueToCheck)) {
    return undefined;
  }
  return valueToCheck as StringMap;
}

function asSsh(valueToCheck: unknown): SshConfig | undefined {
  return asRecord(valueToCheck);
}

function includesString(valueToCheck: unknown, item: string): boolean {
  return Array.isArray(valueToCheck) && valueToCheck.includes(item);
}

function sshValue(ssh: SshConfig | undefined, key: keyof SshConfig): string {
  return ssh ? value(ssh[key]) : "";
}

function value(valueToFormat: unknown): string {
  return valueToFormat === null || valueToFormat === undefined ? "" : String(valueToFormat);
}

function booleanValue(valueToFormat: boolean): string {
  return valueToFormat ? "true" : "false";
}
