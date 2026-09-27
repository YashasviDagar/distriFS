import { getConfig, loadEnv } from "@distrifs/shared";
import { ChunkStore } from "./chunkStore";
import { loadNodeConfig } from "./config";
import { buildServer, type NodeState } from "./server";

async function register(config: ReturnType<typeof loadNodeConfig>, store: ChunkStore): Promise<void> {
  const response = await fetch(`${config.metadataUrl}/internal/nodes/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-token": config.internalToken },
    body: JSON.stringify({
      nodeName: config.id,
      host: config.host,
      port: config.port,
      capacityBytes: config.capacityBytes,
      availableBytes: store.availableBytes,
    }),
  });
  if (!response.ok) {
    throw new Error(`Registration failed: ${response.status} ${await response.text()}`);
  }
}

async function heartbeat(config: ReturnType<typeof loadNodeConfig>, store: ChunkStore): Promise<void> {
  const response = await fetch(`${config.metadataUrl}/internal/nodes/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-token": config.internalToken },
    body: JSON.stringify({
      nodeName: config.id,
      host: config.host,
      port: config.port,
      capacityBytes: config.capacityBytes,
      availableBytes: store.availableBytes,
      status: "HEALTHY",
    }),
  });
  if (!response.ok) {
    throw new Error(`Heartbeat failed: ${response.status}`);
  }
}

async function main(): Promise<void> {
  loadEnv();
  getConfig();
  const config = loadNodeConfig();
  const store = new ChunkStore(config.dataDir, config.capacityBytes);
  await store.init();

  const state: NodeState = { failed: false };
  const app = await buildServer(config, store, state);

  let registered = false;
  const tryRegister = async () => {
    try {
      await register(config, store);
      registered = true;
      app.log.info(`[${config.id}] registered with metadata`);
    } catch (error) {
      app.log.warn(`[${config.id}] registration retry pending: ${String(error)}`);
    }
  };

  await tryRegister();

  const timer = setInterval(async () => {
    if (state.failed) return;
    if (!registered) {
      await tryRegister();
      return;
    }
    try {
      await heartbeat(config, store);
    } catch (error) {
      app.log.warn(`[${config.id}] heartbeat failed: ${String(error)}`);
    }
  }, config.heartbeatIntervalMs);
  timer.unref?.();

  await app.listen({ host: "0.0.0.0", port: config.port });
  app.log.info(`[${config.id}] storage node listening on ${config.port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
