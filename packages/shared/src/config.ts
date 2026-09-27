import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

let envLoaded = false;

/**
 * Loads the nearest `.env` file by walking up from `startDir`.
 * Existing process environment variables always win (dotenv does not override).
 * The real `.env` is never read into source control — see .env.example.
 */
export function loadEnv(startDir: string = process.cwd()): void {
  if (envLoaded) return;
  let dir = resolve(startDir);
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  envLoaded = true;
}

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().default("dev-insecure-secret"),
  JWT_EXPIRES_IN: z.string().default("1h"),
  INTERNAL_SERVICE_TOKEN: z.string().default("dev-internal-token"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  CHUNK_SIZE_BYTES: positiveInt(4 * 1024 * 1024),
  REPLICATION_FACTOR: positiveInt(2),
  MAX_FILE_SIZE_BYTES: positiveInt(512 * 1024 * 1024),
  ALLOWED_MIME_TYPES: z
    .string()
    .default("application/pdf,image/png,image/jpeg,text/plain,application/octet-stream"),

  HEARTBEAT_INTERVAL_MS: positiveInt(5000),
  HEARTBEAT_TIMEOUT_MS: positiveInt(15000),
  HEALTH_SWEEP_INTERVAL_MS: positiveInt(3000),
  RECOVERY_INTERVAL_MS: positiveInt(10000),

  GATEWAY_PORT: positiveInt(8080),
  METADATA_PORT: positiveInt(8081),
  METADATA_URL: z.string().default("http://localhost:8081"),
  NEXT_PUBLIC_API_URL: z.string().default("http://localhost:8080"),
});

export type AppConfig = z.infer<typeof envSchema> & {
  allowedMimeTypes: string[];
};

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;
  loadEnv();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  cachedConfig = {
    ...parsed.data,
    allowedMimeTypes: parsed.data.ALLOWED_MIME_TYPES.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
  envLoaded = false;
}

export interface StorageNodeConfig {
  id: string;
  host: string;
  port: number;
  dataDir: string;
  capacityBytes: number;
}

export function getStorageNodeConfigs(): StorageNodeConfig[] {
  const nodes: StorageNodeConfig[] = [];
  for (let index = 1; index <= 3; index++) {
    nodes.push({
      id: process.env[`NODE_${index}_ID`] ?? `node-${index}`,
      host: process.env[`NODE_${index}_HOST`] ?? "localhost",
      port: Number(process.env[`NODE_${index}_PORT`] ?? 5000 + index),
      dataDir: process.env[`NODE_${index}_DATA_DIR`] ?? `storage/node-${index}/data`,
      capacityBytes: Number(process.env[`NODE_${index}_CAPACITY_BYTES`] ?? 10 * 1024 * 1024 * 1024),
    });
  }
  return nodes;
}

export function requireDatabaseUrl(): string {
  const config = getConfig();
  if (!config.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  }
  return config.DATABASE_URL;
}
