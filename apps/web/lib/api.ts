export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export interface User {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
}

export interface NodeInfo {
  id: string;
  nodeName: string;
  host: string;
  port: number;
  status: "HEALTHY" | "OFFLINE" | "DECOMMISSIONED";
  capacityBytes: number;
  availableBytes: number;
  lastHeartbeat: string | null;
}

export interface ClusterStatus {
  totalNodes: number;
  healthyNodes: number;
  offlineNodes: number;
  totalFiles: number;
  totalBytes: string;
  replicationFactor: number;
  nodes: NodeInfo[];
}

export interface Metrics {
  totalChunks: number;
  replicasByStatus: Record<string, number>;
  recentEvents: Array<{ type: string; message: string; createdAt: string }>;
}

export interface FileSummary {
  id: string;
  name: string;
  size: string;
  totalChunks: number;
  currentVersionNo: number;
  versionCount: number;
  updatedAt: string;
}

export interface ChunkLocation {
  chunkIndex: number;
  chunkId: string;
  size: number;
  checksum: string;
  nodes: Array<{ nodeName: string; status: string; nodeStatus: string }>;
}

export interface FileDetail extends FileSummary {
  replicationFactor: number;
  integrity: { status: "HEALTHY" | "DEGRADED"; totalChunks: number; healthyReplicas: number; degradedChunks: number };
  versions: Array<{ versionNo: number; size: string; chunkLocations: ChunkLocation[] }>;
}

interface Session {
  token: string;
  refreshToken: string;
  user: User;
}

const SESSION_KEY = "distrifs.session";

export function loadSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null): void {
  try {
    if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function errorFrom(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return new ApiError(body?.error?.message ?? `Request failed (${response.status})`, response.status);
}

async function refresh(session: Session): Promise<Session | null> {
  const response = await fetch(`${API_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  if (!response.ok) return null;
  const next = (await response.json()) as Session;
  saveSession(next);
  return next;
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let session = loadSession();
  const send = (token: string | undefined) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });

  let response = await send(session?.token);
  if (response.status === 401 && session) {
    session = await refresh(session);
    if (!session) {
      saveSession(null);
      throw new ApiError("Session expired", 401);
    }
    response = await send(session.token);
  }
  return response;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (typeof init.body === "string") headers["content-type"] = "application/json";
  const response = await authedFetch(path, { ...init, headers });
  if (!response.ok) throw await errorFrom(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function authenticate(mode: "login" | "register", email: string, password: string): Promise<Session> {
  const response = await fetch(`${API_URL}/api/auth/${mode}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw await errorFrom(response);
  const session = (await response.json()) as Session;
  saveSession(session);
  return session;
}

export async function uploadFile(file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await authedFetch("/api/files/upload", { method: "POST", body: form });
  if (!response.ok) throw await errorFrom(response);
}

export async function downloadFile(id: string, name: string, version?: number): Promise<void> {
  const query = version ? `?version=${version}` : "";
  const response = await authedFetch(`/api/files/${id}/download${query}`);
  if (!response.ok) throw await errorFrom(response);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function formatBytes(value: number | string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const scaled = bytes / 1024 ** exponent;
  return `${scaled.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
