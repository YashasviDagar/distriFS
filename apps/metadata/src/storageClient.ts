import { getConfig, signInternalRequest } from "@distrifs/shared";

export interface NodeAddress {
  host: string;
  port: number;
}

function baseUrl(node: NodeAddress): string {
  return `http://${node.host}:${node.port}`;
}

function internalHeaders(method: string, path: string, extra: Record<string, string> = {}): Record<string, string> {
  return { ...signInternalRequest(getConfig().INTERNAL_SERVICE_TOKEN, method, path), ...extra };
}

async function ensureOk(response: Response, action: string): Promise<void> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${action} failed (${response.status}): ${text}`);
  }
}

export async function putChunk(
  node: NodeAddress,
  chunkId: string,
  data: Buffer,
  checksum: string,
): Promise<void> {
  const path = `/chunks/${chunkId}`;
  const response = await fetch(`${baseUrl(node)}${path}`, {
    method: "PUT",
    headers: internalHeaders("PUT", path, { "content-type": "application/octet-stream", "x-chunk-checksum": checksum }),
    body: new Uint8Array(data),
  });
  await ensureOk(response, `PUT chunk ${chunkId} to ${node.host}:${node.port}`);
}

export async function getChunk(
  node: NodeAddress,
  chunkId: string,
): Promise<{ buffer: Buffer; checksum: string | null }> {
  const path = `/chunks/${chunkId}`;
  const response = await fetch(`${baseUrl(node)}${path}`, {
    headers: internalHeaders("GET", path),
  });
  await ensureOk(response, `GET chunk ${chunkId} from ${node.host}:${node.port}`);
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), checksum: response.headers.get("x-chunk-checksum") };
}

export async function deleteChunk(node: NodeAddress, chunkId: string): Promise<void> {
  const path = `/chunks/${chunkId}`;
  const response = await fetch(`${baseUrl(node)}${path}`, {
    method: "DELETE",
    headers: internalHeaders("DELETE", path),
  });
  await ensureOk(response, `DELETE chunk ${chunkId} on ${node.host}:${node.port}`);
}

export async function setNodeFailure(node: NodeAddress, failed: boolean): Promise<void> {
  const path = failed ? "fail" : "recover";
  const url = `/internal/admin/${path}`;
  const response = await fetch(`${baseUrl(node)}${url}`, {
    method: "POST",
    headers: internalHeaders("POST", url),
  });
  await ensureOk(response, `${failed ? "fail" : "recover"} node ${node.host}:${node.port}`);
}

export async function corruptChunk(node: NodeAddress, chunkId: string): Promise<void> {
  const path = `/internal/admin/chunks/${chunkId}/corrupt`;
  const response = await fetch(`${baseUrl(node)}${path}`, {
    method: "POST",
    headers: internalHeaders("POST", path),
  });
  await ensureOk(response, `corrupt chunk ${chunkId} on ${node.host}:${node.port}`);
}

export async function pingNode(node: NodeAddress): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl(node)}/health`, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}
