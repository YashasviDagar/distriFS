#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const dotenv = await import("dotenv");
  const envPath = join(root, ".env");
  if (existsSync(envPath)) dotenv.config({ path: envPath });
} catch {
  // dotenv is optional; environment may already be configured.
}

const nodeConfigs = [1, 2, 3].map((index) => ({
  id: process.env[`NODE_${index}_ID`] ?? `node-${index}`,
  host: process.env[`NODE_${index}_HOST`] ?? "localhost",
  port: Number(process.env[`NODE_${index}_PORT`] ?? 5000 + index),
  dataDir: process.env[`NODE_${index}_DATA_DIR`] ?? `storage/node-${index}/data`,
  capacityBytes: Number(process.env[`NODE_${index}_CAPACITY_BYTES`] ?? 10 * 1024 * 1024 * 1024),
}));

const children = [];

function start(name, { entry, args = [], env = {}, cwd = root }) {
  const child = spawn(process.execPath, ["--import", "tsx", entry, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tag = `[${name}]`;
  child.stdout.on("data", (data) => process.stdout.write(`${tag} ${data}`));
  child.stderr.on("data", (data) => process.stderr.write(`${tag} ${data}`));
  child.on("exit", (code) => console.log(`${tag} exited (code ${code})`));
  children.push(child);
  return child;
}

function shutdown() {
  console.log("\n[cluster] shutting down...");
  for (const child of children) {
    child.kill();
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("[cluster] starting metadata server...");
start("metadata", { entry: join(root, "apps/metadata/src/index.ts") });

for (const node of nodeConfigs) {
  console.log(`[cluster] starting ${node.id} on port ${node.port}...`);
  start(node.id, {
    entry: join(root, "apps/storage-node/src/index.ts"),
    env: {
      STORAGE_NODE_ID: node.id,
      STORAGE_NODE_HOST: node.host,
      STORAGE_NODE_PORT: String(node.port),
      STORAGE_NODE_DATA_DIR: node.dataDir,
      STORAGE_NODE_CAPACITY_BYTES: String(node.capacityBytes),
    },
  });
}

console.log("[cluster] starting API gateway...");
start("gateway", { entry: join(root, "apps/gateway/src/index.ts") });

const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
if (existsSync(nextBin)) {
  console.log("[cluster] starting web dashboard on port 3000...");
  start("web", {
    entry: nextBin,
    args: ["dev", "-p", "3000"],
    cwd: join(root, "apps", "web"),
  });
} else {
  console.log("[cluster] Next.js not installed yet; skipping dashboard.");
}

console.log("[cluster] all services launched. Press Ctrl+C to stop.");
