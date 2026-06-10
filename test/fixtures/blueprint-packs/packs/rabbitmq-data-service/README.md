# RabbitMQ Data-Service Pack

This Flux pack deploys a parameterized RabbitMQ release with:

- OAuth2-backed management/auth configuration
- internal broker password synced from Vault through VSO
- caller-supplied plugin list
- Prometheus `ServiceMonitor`
- storage, resources, replica count, and placement controls

The pack intentionally does not define vhosts, queues, exchanges, bindings, or
application users. Those belong to the consuming service topology.
