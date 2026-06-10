import YAML from "yaml";
import type { DeployConfig, JsonValue } from "./model.js";

type ImageMetadataEntry = {
  service: string;
  repository: string;
  tag: string;
  pull_policy?: string;
  source?: string;
  update: {
    eligible: boolean;
    strategy: string;
    keel?: Record<string, JsonValue>;
  };
};

export function renderImageMetadata(config: DeployConfig): string {
  const workloads = Object.entries(config.image_metadata.workloads)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([serviceName, workload]): ImageMetadataEntry => {
      const entry: ImageMetadataEntry = {
        service: serviceName,
        repository: workload.repository,
        tag: workload.tag,
        pull_policy: workload.pull_policy,
        source: workload.source,
        update: {
          eligible: workload.update.eligible,
          strategy: workload.update.strategy,
        },
      };
      if (workload.update.keel) {
        entry.update.keel = { ...workload.update.keel };
      }
      return entry;
    });

  return YAML.stringify({
    cluster: config.cluster.name,
    workloads,
  }, {
    indent: 2,
    lineWidth: 0,
    sortMapEntries: false,
  }).trimEnd();
}
