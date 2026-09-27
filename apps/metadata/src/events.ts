import { prisma } from "@distrifs/db";

export async function logEvent(
  type: string,
  message: string,
  options: { nodeId?: string | null; chunkId?: string | null } = {},
): Promise<void> {
  try {
    await prisma.event.create({
      data: {
        type,
        message,
        nodeId: options.nodeId ?? null,
        chunkId: options.chunkId ?? null,
      },
    });
  } catch (error) {
    console.error("[metadata] failed to persist event", type, message, error);
  }
}
