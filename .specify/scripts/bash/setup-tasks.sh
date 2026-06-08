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
tasks_file="${feature_dir}/tasks.md"
for required in "${spec_file}" "${plan_file}"; do
  if [[ ! -f "${required}" ]]; then
    echo "Missing required file: ${required}" >&2
    exit 1
  fi
done

if [[ ! -f "${tasks_file}" ]]; then
  cp .specify/templates/tasks-template.md "${tasks_file}"
fi

if [[ "${json}" == true ]]; then
  python3 - <<PY
import json
print(json.dumps({
    "FEATURE_DIR": "${feature_dir}",
    "PLAN_FILE": "${plan_file}",
    "TASKS_FILE": "${tasks_file}",
}))
PY
else
  printf 'FEATURE_DIR=%s\nPLAN_FILE=%s\nTASKS_FILE=%s\n' "${feature_dir}" "${plan_file}" "${tasks_file}"
fi
