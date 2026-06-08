export const stubAdapters = new Set([
  "gatus",
  "edge-catalog",
  "edge-route-catalog",
  "image-metadata",
]);

export function stubDiagnostic(adapter) {
  return {
    code: "E_ADAPTER_TODO",
    message: `adapter ${adapter} is a documented TODO in the initial skeleton`,
    path: "/adapter_output_intent/adapters",
  };
}
