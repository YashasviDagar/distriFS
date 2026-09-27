import { getConfig } from "@distrifs/shared";

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
  const response = await fetch(`${baseUrl(node)}/chunks/${chunkId}`, {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      "x-chunk-checksum": checksum,
      "x-internal-token": getConfig().INTERNAL_SERVICE_TOKEN,
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
  const response = await fetch(`${baseUrl(node)}/chunks/${chunkId}`, {
    headers: { "x-internal-token": getConfig().INTERNAL_SERVICE_TOKEN },
  });
  if (!response.ok) {
    throw new Error(`GET chunk ${chunkId} from ${node.host}:${node.port} failed (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), checksum: response.headers.get("x-chunk-checksum") };
}
