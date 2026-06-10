import { exposureByService, fqdn, routeRules } from "./model.js";
import type { DeployConfig, KubernetesBackend, ResolvedRouteRule } from "./model.js";

const PUBLIC_ADAPTER = "traefik-public";
const LAN_ADAPTER = "traefik-lan";
type TraefikAdapter = typeof PUBLIC_ADAPTER | typeof LAN_ADAPTER;
type DnsTarget = { target: string; cloudflareProxied: boolean };

export function renderTraefik(config: DeployConfig, adapter: TraefikAdapter): string {
  if (![PUBLIC_ADAPTER, LAN_ADAPTER].includes(adapter)) {
    throw new Error(`unsupported Traefik adapter: ${adapter}`);
  }

  const isLan = adapter === LAN_ADAPTER;
  const serviceNames = isLan
    ? new Set<string>([...config.exposure_intent.public_and_lan, ...config.exposure_intent.lan_only])
    : new Set<string>([...config.exposure_intent.public, ...config.exposure_intent.public_and_lan]);
  const className = isLan
    ? config.ingress_intent.defaults.lan_ingress_class
    : config.ingress_intent.defaults.public_ingress_class;
  const suffix = isLan ? "-lan" : "";
  const dnsTargets = isLan ? new Map<string, DnsTarget>() : publicDnsTargets(config);

  const routes = routeRules(config)
    .filter((route) => serviceNames.has(route.service))
    .filter((route) => config.ingress_intent.kubernetes_backends[route.service])
    .map((route) => ({
      route: {
        ...route,
        name: `${route.name}${suffix}`,
        access: isLan ? "direct" : route.access,
      },
      backend: config.ingress_intent.kubernetes_backends[route.service],
      dnsTarget: dnsTargets.get(route.service) ?? dnsTargets.get("*"),
    }))
    .sort((left, right) => left.route.name.localeCompare(right.route.name));

  return routes
    .map(({ route, backend, dnsTarget }) => renderIngressRoute(config, route, backend, className, dnsTarget))
    .join("\n---\n");
}

function publicDnsTargets(config: DeployConfig): Map<string, DnsTarget> {
  const targets = new Map<string, DnsTarget>([
    [
      "*",
      {
        target: config.ingress_intent.defaults.public_dns_target ?? `ingress.${config.cluster.public_domain}`,
        cloudflareProxied: true,
      },
    ],
  ]);

  const homeWanIp = siteWanIp(config, "home_lan_and_media_site");
  const edgeWanIp = siteWanIp(config, "primary_cluster_site");
  for (const [serviceName, origin] of Object.entries(config.ingress_intent.wan_origin_overrides)) {
    if (origin === "home_direct" && homeWanIp) {
      targets.set(serviceName, { target: homeWanIp, cloudflareProxied: false });
    }
    if (origin === "edge_direct" && edgeWanIp) {
      targets.set(serviceName, { target: edgeWanIp, cloudflareProxied: false });
    }
  }

  return targets;
}

function siteWanIp(config: DeployConfig, purpose: string): string | undefined {
  return Object.values(config.sites).find((site) => site.purpose === purpose)?.networking?.wan_public_ip;
}

function renderIngressRoute(
  config: DeployConfig,
  route: ResolvedRouteRule,
  backend: KubernetesBackend,
  className: string,
  dnsTarget: DnsTarget | undefined,
): string {
  const namespace = config.ingress_intent.defaults.namespace;
  const lines = [
    "apiVersion: traefik.io/v1alpha1",
    "kind: IngressRoute",
    "metadata:",
    `  name: ${route.name}`,
    `  namespace: ${namespace}`,
    "  annotations:",
  ];

  if (dnsTarget) {
    lines.push(`    external-dns.alpha.kubernetes.io/target: ${dnsTarget.target}`);
    lines.push(`    external-dns.alpha.kubernetes.io/cloudflare-proxied: '${dnsTarget.cloudflareProxied}'`);
  }
  lines.push(`    kubernetes.io/ingress.class: ${className}`);
  lines.push("spec:");
  lines.push("  entryPoints:");
  lines.push(`    - ${config.ingress_intent.defaults.entrypoint}`);
  lines.push("  routes:");
  lines.push("    - kind: Rule");
  lines.push(`      match: ${yamlSingleQuoted(toTraefikMatch(config, route))}`);

  const middlewares = routeMiddlewares(config, route);
  if (middlewares.length > 0) {
    lines.push("      middlewares:");
    for (const middleware of middlewares) {
      lines.push(`        - name: ${middleware}`);
      lines.push(`          namespace: ${namespace}`);
    }
  }

  lines.push("      services:");
  lines.push(`        - name: ${backend.service}`);
  lines.push(`          namespace: ${backend.namespace}`);
  lines.push(`          port: ${backend.port}`);
  if (config.ingress_intent.defaults.tls) {
    lines.push("  tls: {}");
  }

  return lines.join("\n");
}

function routeMiddlewares(config: DeployConfig, route: ResolvedRouteRule): string[] {
  const middlewares: string[] = [];
  const rootRedirect = config.access_intent.root_redirect[route.service];
  if (rootRedirect) {
    middlewares.push(rootRedirect);
  }
  if (route.access === "sso_protected") {
    middlewares.push(config.ingress_intent.defaults.sso_middleware ?? "forward-auth");
  }
  return middlewares;
}

function toTraefikMatch(config: DeployConfig, route: ResolvedRouteRule): string {
  const positive = [
    ...(route.path_prefixes ?? []).map((path) => `PathPrefix(\`${path}\`)`),
    ...(route.exact_paths ?? []).map((path) => `Path(\`${path}\`)`),
  ];
  const negative = [
    ...(route.excluded_path_prefixes ?? []).map((path) => `!PathPrefix(\`${path}\`)`),
    ...(route.excluded_exact_paths ?? []).map((path) => `!Path(\`${path}\`)`),
  ];
  const predicates = [`Host(\`${route.host}\`)`];
  const combined = combinePredicates(positive);
  if (combined) {
    predicates.push(combined);
  }
  predicates.push(...negative);
  return predicates.join(" && ");
}

function combinePredicates(predicates: string[]): string | undefined {
  if (predicates.length === 0) return undefined;
  if (predicates.length === 1) return predicates[0];
  return `(${predicates.join(" || ")})`;
}

function yamlSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
