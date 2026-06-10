# Observability Pack

Parameterized Flux bases for small k3s observability stacks:

- kube-prometheus-stack metrics
- Grafana and Grafana Operator dashboards
- Loki logs
- Tempo traces
- Alloy log/OTLP/Faro collection
- Gatus status probes
- optional Pyroscope profiling
- optional DCGM GPU telemetry
- platform alert rule library

Consumers decide which component directories to include. Service-specific
dashboards, alert routing, Gatus endpoint ConfigMaps, domains, OIDC settings,
and node placement stay in consumer repositories.
