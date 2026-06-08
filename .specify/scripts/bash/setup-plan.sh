#!/usr/bin/env bash
set -euo pipefail

json=false
if [[ "${1:-}" == "--json" ]]; then
  json=true
fi

feature_dir="$(find specs -maxdepth 1 -mindepth 1 -type d -name '001-*' | sort | head -n 1)"
if [[ -z "${feature_dir}" ]]; then
  echo "No active feature directory found under specs/001-*" >&2
  exit 1
fi

spec_file="${feature_dir}/spec.md"
plan_file="${feature_dir}/plan.md"
if [[ ! -f "${spec_file}" ]]; then
  echo "Missing spec file: ${spec_file}" >&2
  exit 1
fi

if [[ ! -f "${plan_file}" ]]; then
  cp .specify/templates/plan-template.md "${plan_file}"
fi

if [[ "${json}" == true ]]; then
  python3 - <<PY
import json
print(json.dumps({
    "FEATURE_DIR": "${feature_dir}",
    "SPEC_FILE": "${spec_file}",
    "PLAN_FILE": "${plan_file}",
}))
PY
else
  printf 'FEATURE_DIR=%s\nSPEC_FILE=%s\nPLAN_FILE=%s\n' "${feature_dir}" "${spec_file}" "${plan_file}"
fi
