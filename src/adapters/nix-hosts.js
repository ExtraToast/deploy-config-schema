const ADAPTER = "nix-hosts";

const roleModules = {
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

const roleEnables = {
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

export function renderNixHosts(context) {
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
        path: `platform/nix/hosts/${node.id}/default.nix`,
        content: renderHostDefault(cluster, node),
        adapter: ADAPTER,
      },
      {
        path: `platform/nix/generated/${node.id}-labels.nix`,
        content: renderLabelsModule(cluster, node),
        adapter: ADAPTER,
      },
    ]),
  ].sort((left, right) => left.path.localeCompare(right.path));
}

function renderFlake(cluster, nodes) {
  const hostEntries = nodes.map((node) => `        ${node.id} = mkHost {
          system = "${node.system}";
          hostModule = ./nix/hosts/${node.id}/default.nix;
        };`).join("\n");
  const deployEntries = nodes
    .filter((node) => node.ssh)
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

function renderDeployNode(node) {
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

function renderHostDefault(cluster, node) {
  const imports = modulesFor(node).map((module) => `      inputs.platform-blueprints.nixosModules.${module}`);
  imports.push(`      ../../generated/${node.id}-labels.nix`);
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
    ++ lib.optional (builtins.pathExists ./overrides.nix) ./overrides.nix
    ++ lib.optional (builtins.pathExists ./disko.nix) ./disko.nix;

  networking.hostName = lib.mkDefault "${node.id}";
  nixpkgs.hostPlatform = lib.mkDefault "${node.system}";
${enables ? `\n${enables}\n` : ""}
${agentConfig}  system.stateVersion = lib.mkDefault "25.05";
}
`;
}

function renderLabelsModule(cluster, node) {
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

function modulesFor(node) {
  return [...new Set(node.roles.map((role) => roleModules[role]).filter(Boolean))].sort();
}

function normalizeNode(id, node) {
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

function normalizeRole(role) {
  if (role === "control-plane") return "k3s-control-plane";
  if (role === "worker") return "k3s-worker";
  return role;
}

function taintsFor(node) {
  if ((node.roles ?? []).includes("control-plane") || (node.roles ?? []).includes("k3s-control-plane")) {
    return ["node-role.kubernetes.io/control-plane=true:NoSchedule"];
  }
  return [];
}

function systemForArch(arch) {
  if (arch === "arm64") return "aarch64-linux";
  if (arch === "armv7") return "armv7l-linux";
  return "x86_64-linux";
}

function parseSsh(value) {
  if (!value) return undefined;
  const match = /^(?<user>[a-z0-9._-]+)@(?<host>[^:]+)(:(?<port>[0-9]+))?$/.exec(value);
  if (!match) return { user: "deploy", host: value, port: 22 };
  return {
    user: match.groups.user,
    host: match.groups.host,
    port: Number(match.groups.port ?? 22),
  };
}

function sortedEntries(object) {
  return Object.entries(object ?? {}).sort(([left], [right]) => left.localeCompare(right));
}
