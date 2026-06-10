import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";
import { runCli } from "../src/cli.js";
import { hostEnvLines } from "../src/index.js";

const fleetPath = new URL("./fixtures/host-env/fleet.yaml", import.meta.url);

function stream() {
  return {
    chunks: [],
    write(chunk) {
      this.chunks.push(String(chunk));
      return true;
    },
    text() {
      return this.chunks.join("");
    },
  };
}

function loadFleet() {
  return YAML.parse(readFileSync(fleetPath, "utf8"));
}

test("hostEnvLines emits exact show-host-env lines for active control-plane node", () => {
  assert.equal(hostEnvLines(loadFleet(), "cp-1"), [
    "NODE_NAME=cp-1",
    "NODE_STATUS=active",
    "NODE_SITE=frankfurt",
    "NODE_ARCH=amd64",
    "NIX_SYSTEM=x86_64-linux",
    "K3S_BOOTSTRAP_CONTROL_PLANE_NODE=cp-1",
    "K3S_API_SERVER_ENDPOINT=https://k3s.example.test:6443",
    "K3S_CONTROL_PLANE_TOKEN_FILE=/run/secrets/k3s-control-plane-token",
    "K3S_WORKER_JOIN_TOKEN_FILE=/run/secrets/k3s-worker-token",
    "HAS_SSH=true",
    "HAS_BOOTSTRAP_SSH=true",
    "SSH_HOST=cp-1.example.test",
    "SSH_USER=admin",
    "SSH_PORT=22",
    "BOOTSTRAP_SSH_HOST=bootstrap-cp-1.example.test",
    "BOOTSTRAP_SSH_USER=root",
    "BOOTSTRAP_SSH_PORT=2222",
    "IS_CONTROL_PLANE=true",
    "IS_WORKER=false",
    "IS_UTILITY_HOST=true",
    "HAS_NVIDIA=true",
    "",
  ].join("\n"));
});

test("hostEnvLines uses bootstrap SSH for active install env when present", () => {
  assert.equal(hostEnvLines(loadFleet(), "cp-1", { install: true }), [
    "NODE_NAME=cp-1",
    "NODE_STATUS=active",
    "NODE_SITE=frankfurt",
    "NODE_ARCH=amd64",
    "NIX_SYSTEM=x86_64-linux",
    "K3S_BOOTSTRAP_CONTROL_PLANE_NODE=cp-1",
    "K3S_API_SERVER_ENDPOINT=https://k3s.example.test:6443",
    "K3S_CONTROL_PLANE_TOKEN_FILE=/run/secrets/k3s-control-plane-token",
    "K3S_WORKER_JOIN_TOKEN_FILE=/run/secrets/k3s-worker-token",
    "HAS_SSH=true",
    "HAS_BOOTSTRAP_SSH=true",
    "SSH_HOST=bootstrap-cp-1.example.test",
    "SSH_USER=root",
    "SSH_PORT=2222",
    "BOOTSTRAP_SSH_HOST=bootstrap-cp-1.example.test",
    "BOOTSTRAP_SSH_USER=root",
    "BOOTSTRAP_SSH_PORT=2222",
    "IS_CONTROL_PLANE=true",
    "IS_WORKER=false",
    "IS_UTILITY_HOST=true",
    "HAS_NVIDIA=true",
    "",
  ].join("\n"));
});

test("hostEnvLines falls back to normal SSH for active install env without bootstrap SSH", () => {
  assert.equal(hostEnvLines(loadFleet(), "worker-1", { install: true }), [
    "NODE_NAME=worker-1",
    "NODE_STATUS=active",
    "NODE_SITE=enschede",
    "NODE_ARCH=arm64",
    "NIX_SYSTEM=aarch64-linux",
    "K3S_BOOTSTRAP_CONTROL_PLANE_NODE=cp-1",
    "K3S_API_SERVER_ENDPOINT=https://k3s.example.test:6443",
    "K3S_CONTROL_PLANE_TOKEN_FILE=/run/secrets/k3s-control-plane-token",
    "K3S_WORKER_JOIN_TOKEN_FILE=/run/secrets/k3s-worker-token",
    "HAS_SSH=true",
    "HAS_BOOTSTRAP_SSH=false",
    "SSH_HOST=worker-1.example.test",
    "SSH_USER=deploy",
    "SSH_PORT=2201",
    "BOOTSTRAP_SSH_HOST=",
    "BOOTSTRAP_SSH_USER=",
    "BOOTSTRAP_SSH_PORT=",
    "IS_CONTROL_PLANE=false",
    "IS_WORKER=true",
    "IS_UTILITY_HOST=false",
    "HAS_NVIDIA=false",
    "",
  ].join("\n"));
});

test("hostEnvLines emits empty SSH fields when selected SSH is absent", () => {
  assert.equal(hostEnvLines(loadFleet(), "no-ssh"), [
    "NODE_NAME=no-ssh",
    "NODE_STATUS=active",
    "NODE_SITE=enschede",
    "NODE_ARCH=amd64",
    "NIX_SYSTEM=x86_64-linux",
    "K3S_BOOTSTRAP_CONTROL_PLANE_NODE=cp-1",
    "K3S_API_SERVER_ENDPOINT=https://k3s.example.test:6443",
    "K3S_CONTROL_PLANE_TOKEN_FILE=/run/secrets/k3s-control-plane-token",
    "K3S_WORKER_JOIN_TOKEN_FILE=/run/secrets/k3s-worker-token",
    "HAS_SSH=false",
    "HAS_BOOTSTRAP_SSH=false",
    "SSH_HOST=",
    "SSH_USER=",
    "SSH_PORT=",
    "BOOTSTRAP_SSH_HOST=",
    "BOOTSTRAP_SSH_USER=",
    "BOOTSTRAP_SSH_PORT=",
    "IS_CONTROL_PLANE=false",
    "IS_WORKER=false",
    "IS_UTILITY_HOST=true",
    "HAS_NVIDIA=false",
    "",
  ].join("\n"));
});

test("hostEnvLines uses bootstrap SSH for inactive install env", () => {
  assert.equal(hostEnvLines(loadFleet(), "bootstrap-only", { install: true }), [
    "NODE_NAME=bootstrap-only",
    "NODE_STATUS=provisioning",
    "NODE_SITE=frankfurt",
    "NODE_ARCH=arm64",
    "NIX_SYSTEM=aarch64-linux",
    "K3S_BOOTSTRAP_CONTROL_PLANE_NODE=cp-1",
    "K3S_API_SERVER_ENDPOINT=https://k3s.example.test:6443",
    "K3S_CONTROL_PLANE_TOKEN_FILE=/run/secrets/k3s-control-plane-token",
    "K3S_WORKER_JOIN_TOKEN_FILE=/run/secrets/k3s-worker-token",
    "HAS_SSH=true",
    "HAS_BOOTSTRAP_SSH=true",
    "SSH_HOST=bootstrap-only.example.test",
    "SSH_USER=root",
    "SSH_PORT=2022",
    "BOOTSTRAP_SSH_HOST=bootstrap-only.example.test",
    "BOOTSTRAP_SSH_USER=root",
    "BOOTSTRAP_SSH_PORT=2022",
    "IS_CONTROL_PLANE=false",
    "IS_WORKER=true",
    "IS_UTILITY_HOST=false",
    "HAS_NVIDIA=false",
    "",
  ].join("\n"));
});

test("show-host-env CLI writes exact host env output", async () => {
  const stdout = stream();
  const stderr = stream();

  const exitCode = await runCli(["show-host-env", fleetPath.pathname, "no-ssh"], { stdout, stderr });

  assert.equal(exitCode, 0);
  assert.equal(stderr.text(), "");
  assert.match(stdout.text(), /^NODE_NAME=no-ssh\n/);
  assert.match(stdout.text(), /\nSSH_HOST=\nSSH_USER=\nSSH_PORT=\n/);
});

test("show-host-env CLI reports unknown node exactly", async () => {
  const stdout = stream();
  const stderr = stream();

  const exitCode = await runCli(["show-host-env", fleetPath.pathname, "missing"], { stdout, stderr });

  assert.equal(exitCode, 1);
  assert.equal(stdout.text(), "");
  assert.equal(stderr.text(), "Unknown node: missing\n");
});

test("hostEnvLines reports unsupported architecture exactly", () => {
  const fleet = loadFleet();
  fleet.nodes["bad-arch"] = {
    ...fleet.nodes["no-ssh"],
    arch: "riscv64",
  };

  assert.throws(
    () => hostEnvLines(fleet, "bad-arch"),
    /Unsupported arch riscv64/,
  );
});
