import type { AdapterContext, AdapterFile, BlueprintRegistry, FleetInventoryArtifact } from "./model.js";

const ADAPTER = "nix-hosts";
type RoleName = keyof typeof roleEnables;
type SshTarget = { user: string; host: string; port: number };
type NormalizedNode = {
  id: string;
  site: string;
  system: string;
  roles: string[];
  capabilities: string[];
  taints: string[];
  ssh?: SshTarget;
};
type NixCluster = {
  name: string;
  domain: string;
  apiServerEndpoint?: string;
  workerJoinTokenFile?: string;
};
type NixValue = string | number | boolean | string[] | undefined;
type FleetNode = NonNullable<NonNullable<FleetInventoryArtifact["fleet"]>["nodes"]>[string];

const fallbackRoleModules: Record<string, string> = {
  base: "base",
  "control-plane": "roleControlPlane",
  worker: "roleWorker",
  "k3s-bootstrap": "roleK3sBootstrap",
  "k3s-control-plane": "roleControlPlane",
  "k3s-worker": "roleWorker",
  utility: "roleUtilityHost",
  "utility-host": "roleUtilityHost",
  "gpu-amd": "roleGpuAmd",
  "gpu-nvidia": "roleGpuNvidia",
  "raspberry-pi-image": "roleRaspberryPiImage",
  "tailscale-network": "roleNetworkTailscale",
};

const roleEnables: Record<string, string> = {
  base: "platformBlueprints.base.enable = lib.mkDefault true;",
  "control-plane": "platformBlueprints.roles.controlPlane.enable = lib.mkDefault true;",
  worker: "platformBlueprints.roles.worker.enable = lib.mkDefault true;",
  "k3s-bootstrap": "platformBlueprints.roles.k3sBootstrap.enable = lib.mkDefault true;",
  "k3s-control-plane": "platformBlueprints.roles.controlPlane.enable = lib.mkDefault true;",
  "k3s-worker": "platformBlueprints.roles.worker.enable = lib.mkDefault true;",
  utility: "platformBlueprints.roles.utilityHost.enable = lib.mkDefault true;",
  "utility-host": "platformBlueprints.roles.utilityHost.enable = lib.mkDefault true;",
  "gpu-amd": "platformBlueprints.roles.gpuAmd.enable = lib.mkDefault true;",
  "gpu-nvidia": "platformBlueprints.roles.gpuNvidia.enable = lib.mkDefault true;",
  "raspberry-pi-image": "platformBlueprints.roles.raspberryPiImage.enable = lib.mkDefault true;",
  "tailscale-network": "platformBlueprints.roles.networkTailscale.enable = lib.mkDefault true;",
};

export function renderNixHosts(context: AdapterContext): AdapterFile[] {
  if (!("artifacts" in context)) return [];
  const fleet = context.artifacts?.["fleet-inventory"]?.fleet;
  if (!fleet?.nodes) return [];

  const nodes = sortedEntries(fleet.nodes).map(([id, node]) => normalizeNode(id, node));
  const deployConfig = context.artifacts?.["deploy-config"];
  const cluster = {
    name: fleet.cluster.name,
    domain: fleet.cluster.domain,
    apiServerEndpoint: deployConfig?.cluster?.kubernetes?.api_server_endpoint,
    workerJoinTokenFile: deployConfig?.cluster?.kubernetes?.worker_join_token_file,
  };

  return [
    {
      path: "platform/flake.nix",
      content: renderFlake(cluster, nodes),
      adapter: ADAPTER,
    },
    ...nodes.flatMap((node) => [
      {
        path: `platform/nix/hosts/${node.id}/README.md`,
        content: renderHostReadme(node),
        adapter: ADAPTER,
      },
      {
        path: `platform/nix/hosts/${node.id}/default.nix`,
        content: renderHostDefault(context, cluster, node),
        adapter: ADAPTER,
      },
      {
        path: `platform/nix/generated/${node.id}-labels.nix`,
        content: renderLabelsModule(cluster, node),
        adapter: ADAPTER,
      },
      {
        path: `platform/nix/generated/${node.id}-deploy-metadata.nix`,
        content: renderDeployMetadata(node),
        adapter: ADAPTER,
      },
    ]),
  ].sort((left, right) => left.path.localeCompare(right.path));
}

function renderFlake(cluster: NixCluster, nodes: NormalizedNode[]): string {
  const hostEntries = nodes.map((node) => `        ${node.id} = mkHost {
          system = "${node.system}";
          hostModule = ./nix/hosts/${node.id}/default.nix;
        };`).join("\n");
  const deployEntries = nodes
    .filter((node): node is NormalizedNode & { ssh: SshTarget } => Boolean(node.ssh))
    .map((node) => renderDeployNode(node))
    .join("\n\n");

  return `{
  description = "${cluster.name} NixOS and k3s platform";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    deploy-rs.url = "github:serokell/deploy-rs";
    disko.url = "github:nix-community/disko";
    platform-blueprints.url = "github:ExtraToast/platform-blueprints";
  };

  outputs =
    inputs@{ self, nixpkgs, deploy-rs, disko, platform-blueprints, ... }:
    let
      lib = nixpkgs.lib;
      mkHost =
        {
          system,
          hostModule,
          extraModules ? [ ],
          extraSpecialArgs ? { },
        }:
        lib.nixosSystem {
          inherit system;
          specialArgs = { inherit inputs; } // extraSpecialArgs;
          modules =
            [
              disko.nixosModules.disko
              hostModule
            ]
            ++ extraModules;
        };
    in
    {
      nixosConfigurations = {
${hostEntries}
      };
      deploy.nodes = {
${deployEntries}
      };

      checks = lib.genAttrs [ "x86_64-linux" "aarch64-linux" ] (
        system:
        deploy-rs.lib.\${system}.deployChecks self.deploy
      );
    };
}
`;
}

function renderDeployNode(node: NormalizedNode & { ssh: SshTarget }): string {
  const sshOpts = node.ssh.port === 22 ? "" : `
          sshOpts = [ "-p" "${node.ssh.port}" ];`;
  return `        ${node.id} = {
          hostname = "${node.ssh.host}";
          profiles.system = {
            sshUser = "${node.ssh.user}";
            user = "root";${sshOpts}
            path = deploy-rs.lib.${node.system}.activate.nixos self.nixosConfigurations.${node.id};
          };
        };`;
}

function renderHostDefault(context: AdapterContext, cluster: NixCluster, node: NormalizedNode): string {
  const imports = modulesFor(context, node).map((module) => `      inputs.platform-blueprints.nixosModules.${module}`);
  imports.push(`      ../../generated/${node.id}-labels.nix`);
  imports.push(`      ../../generated/${node.id}-deploy-metadata.nix`);
  const importBlock = imports.join("\n");
  const enables = [...new Set(node.roles.map((role) => roleEnables[role]).filter(Boolean))]
    .sort()
    .map((line) => `  ${line}`)
    .join("\n");
  const agentConfig = node.roles.includes("k3s-worker") || node.roles.includes("worker")
    ? `  platformBlueprints.k3s.apiServerEndpoint = lib.mkDefault "${cluster.apiServerEndpoint ?? `https://${cluster.name}.${cluster.domain}:6443`}";
  platformBlueprints.k3s.joinTokenFile = lib.mkDefault "${cluster.workerJoinTokenFile ?? "/var/lib/deploy-config-schema/secrets/k3s/agent-token"}";
`
    : "";

  return `{ lib, inputs, ... }:
{
  imports =
    [
${importBlock}
    ]
    ++ lib.optional (builtins.pathExists ./network.nix) ./network.nix
    ++ lib.optional (builtins.pathExists ./disko.nix) ./disko.nix
    ++ lib.optional (builtins.pathExists ./secrets.nix) ./secrets.nix
    ++ lib.optional (builtins.pathExists ./overrides.nix) ./overrides.nix;

  networking.hostName = lib.mkDefault "${node.id}";
  nixpkgs.hostPlatform = lib.mkDefault "${node.system}";
${enables ? `\n${enables}\n` : ""}
${agentConfig}  system.stateVersion = lib.mkDefault "25.05";
}
`;
}

function renderHostReadme(node: NormalizedNode): string {
  return `# ${node.id}

This directory is generated as a NixOS host scaffold.

Consumer-owned extension points:

- \`network.nix\` for static addresses, gateways, firewall, DNS, and VPN wiring.
- \`disko.nix\` for host-specific disk layout.
- \`secrets.nix\` for host-specific secret mounts and activation details.
- \`overrides.nix\` for local module options that should stay outside generated defaults.

The renderer imports those files only when they already exist and never generates
or overwrites them.
`;
}

function renderDeployMetadata(node: NormalizedNode): string {
  const attrs = {
    hostName: node.id,
    site: node.site,
    system: node.system,
    roles: node.roles,
    capabilities: node.capabilities,
    ...(node.ssh ? { sshHost: node.ssh.host, sshUser: node.ssh.user, sshPort: node.ssh.port } : {}),
  };

  return `{ lib, ... }:
{
  _module.args.deployMetadata = lib.mkDefault {
${renderNixAttrs(attrs, 4)}
  };
}
`;
}

function renderLabelsModule(cluster: NixCluster, node: NormalizedNode): string {
  const labels = {
    [`${cluster.name}/site`]: node.site,
    [`${cluster.name}/node`]: node.id,
    "topology.kubernetes.io/region": node.site,
  };
  for (const role of node.roles) labels[`${cluster.name}/role-${role}`] = "true";
  for (const capability of node.capabilities) labels[`${cluster.name}/capability-${capability}`] = "true";

  return `{ lib, ... }:
{
  platformBlueprints.k3s.nodeLabels = lib.mkDefault {
${sortedEntries(labels).map(([key, value]) => `    "${key}" = "${value}";`).join("\n")}
  };
  platformBlueprints.k3s.nodeTaints = lib.mkDefault [
${node.taints.map((taint) => `    "${taint}"`).join("\n")}
  ];
}
`;
}

function modulesFor(context: AdapterContext, node: NormalizedNode): string[] {
  return [...new Set(node.roles.map((role) => roleModuleName(context, role)).filter((role): role is string => Boolean(role)))].sort();
}

function roleModuleName(context: AdapterContext, role: string): string | undefined {
  const registry = "blueprintRegistry" in context ? context.blueprintRegistry : undefined;
  const injected = registryRoleModules(registry);
  return injected?.[role] ?? fallbackRoleModules[role];
}

function registryRoleModules(registry: BlueprintRegistry | undefined): Record<string, string> | undefined {
  if (!registry) return undefined;
  if (typeof registry.roleModuleNameForRole === "function") {
    return new Proxy<Record<string, string>>({}, { get: (_target, role) => registry.roleModuleNameForRole?.(role) });
  }
  if (typeof registry.moduleNameForRole === "function") {
    return new Proxy<Record<string, string>>({}, { get: (_target, role) => registry.moduleNameForRole?.(role) });
  }
  if (registry.roleModuleNames) return registry.roleModuleNames;
  const hostRoles = registry.nixosHostRoles;
  if (hostRoles && typeof hostRoles === "object" && "roleModuleNames" in hostRoles && isStringRecord(hostRoles.roleModuleNames)) {
    return hostRoles.roleModuleNames;
  }
  if (hostRoles && Object.values(hostRoles).every((value) => typeof value === "string")) return hostRoles as Record<string, string>;
  return registry.nixos?.roleModuleNames;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return value !== null && typeof value === "object" && Object.values(value).every((entry) => typeof entry === "string");
}

function normalizeNode(id: string, node: FleetNode): NormalizedNode {
  return {
    id,
    site: node.site,
    system: systemForArch(node.arch),
    roles: (node.roles ?? ["base", "k3s-worker"]).map(normalizeRole).sort(),
    capabilities: [...(node.capabilities ?? [])].sort(),
    taints: taintsFor(node),
    ssh: parseSsh(node.addresses?.ssh ?? node.addresses?.management),
  };
}

function normalizeRole(role: string): string {
  if (role === "control-plane") return "k3s-control-plane";
  if (role === "worker") return "k3s-worker";
  return role;
}

function taintsFor(node: FleetNode): string[] {
  if ((node.roles ?? []).includes("control-plane") || (node.roles ?? []).includes("k3s-control-plane")) {
    return ["node-role.kubernetes.io/control-plane=true:NoSchedule"];
  }
  return [];
}

function systemForArch(arch: string | undefined): string {
  if (arch === "arm64") return "aarch64-linux";
  if (arch === "armv7") return "armv7l-linux";
  if (arch === "riscv64") return "riscv64-linux";
  return "x86_64-linux";
}

function parseSsh(value: string | undefined): SshTarget | undefined {
  if (!value) return undefined;
  const match = /^(?<user>[a-z0-9._-]+)@(?<host>[^:]+)(:(?<port>[0-9]+))?$/.exec(value);
  if (!match) return { user: "deploy", host: value, port: 22 };
  return {
    user: match.groups?.user ?? "deploy",
    host: match.groups?.host ?? value,
    port: Number(match.groups?.port ?? 22),
  };
}

function sortedEntries<T>(object: Record<string, T> | undefined): Array<[string, T]> {
  return Object.entries(object ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

function renderNixAttrs(object: Record<string, NixValue>, indent: number): string {
  return sortedEntries(object).map(([key, value]) => `${" ".repeat(indent)}${key} = ${nixValue(value)};`).join("\n");
}

function nixValue(value: NixValue): string {
  if (Array.isArray(value)) return `[ ${value.map(nixValue).join(" ")} ]`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
