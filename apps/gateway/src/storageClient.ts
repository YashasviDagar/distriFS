import { getConfig, signInternalRequest } from "@distrifs/shared";

export interface NodeAddress {
  host: string;
  port: number;
}

function baseUrl(node: NodeAddress): string {
  return `http://${node.host}:${node.port}`;
}

export async function putChunkToNode(
  node: NodeAddress,
  chunkId: string,
  data: Buffer,
  checksum: string,
): Promise<void> {
  const path = `/chunks/${chunkId}`;
  const response = await fetch(`${baseUrl(node)}${path}`, {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      "x-chunk-checksum": checksum,
      ...signInternalRequest(getConfig().INTERNAL_SERVICE_TOKEN, "PUT", path),
    },
    body: new Uint8Array(data),
  });
  if (!response.ok) {
    throw new Error(`PUT chunk ${chunkId} to ${node.host}:${node.port} failed (${response.status})`);
  }
}

export async function getChunkFromNode(
  node: NodeAddress,
  chunkId: string,
): Promise<{ buffer: Buffer; checksum: string | null }> {
  const path = `/chunks/${chunkId}`;
  const response = await fetch(`${baseUrl(node)}${path}`, {
    headers: signInternalRequest(getConfig().INTERNAL_SERVICE_TOKEN, "GET", path),
  });
  if (!response.ok) {
    throw new Error(`GET chunk ${chunkId} from ${node.host}:${node.port} failed (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), checksum: response.headers.get("x-chunk-checksum") };
}
