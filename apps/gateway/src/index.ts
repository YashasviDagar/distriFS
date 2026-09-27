import { getConfig, loadEnv } from "@distrifs/shared";
import { buildServer } from "./server";

async function main(): Promise<void> {
  loadEnv();
  const config = getConfig();
  const app = await buildServer();
  await app.listen({ host: "0.0.0.0", port: config.GATEWAY_PORT });
  app.log.info(`API gateway listening on ${config.GATEWAY_PORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
