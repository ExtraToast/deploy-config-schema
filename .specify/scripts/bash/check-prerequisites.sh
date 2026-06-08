#!/usr/bin/env bash
set -euo pipefail

json=false
require_tasks=false
include_tasks=false

for arg in "$@"; do
  case "${arg}" in
    --json) json=true ;;
    --require-tasks) require_tasks=true ;;
    --include-tasks) include_tasks=true ;;
  esac
done

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

if [[ "${require_tasks}" == true && ! -f "${tasks_file}" ]]; then
  echo "Missing required file: ${tasks_file}" >&2
  exit 1
fi

if [[ "${json}" == true ]]; then
  include_tasks_python=False
  if [[ "${include_tasks}" == true ]]; then
    include_tasks_python=True
  fi
  python3 - <<PY
import json
payload = {
    "FEATURE_DIR": "${feature_dir}",
    "SPEC_FILE": "${spec_file}",
    "PLAN_FILE": "${plan_file}",
}
if ${include_tasks_python}:
    payload["TASKS_FILE"] = "${tasks_file}"
print(json.dumps(payload))
PY
else
  printf 'FEATURE_DIR=%s\nSPEC_FILE=%s\nPLAN_FILE=%s\n' "${feature_dir}" "${spec_file}" "${plan_file}"
  if [[ "${include_tasks}" == true ]]; then
    printf 'TASKS_FILE=%s\n' "${tasks_file}"
  fi
fi
