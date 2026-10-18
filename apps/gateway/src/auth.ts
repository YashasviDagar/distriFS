import type { FastifyReply, FastifyRequest } from "fastify";
import { forbidden, unauthorized, type UserRole } from "@distrifs/shared";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; email: string; role: UserRole; typ?: "access" | "refresh" };
    user: { sub: string; email: string; role: UserRole; typ?: "access" | "refresh" };
  }
}

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw unauthorized("A valid access token is required");
  }
  if (request.user.typ === "refresh") {
    throw unauthorized("A refresh token cannot be used to access this resource");
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authenticate(request, reply);
  if (request.user.role !== "ADMIN") {
    throw forbidden("Administrator privileges are required");
  }
}
