import type { FastifyReply, FastifyRequest } from "fastify";
import { forbidden, unauthorized, type UserRole } from "@distrifs/shared";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; email: string; role: UserRole };
    user: { sub: string; email: string; role: UserRole };
  }
}

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw unauthorized("A valid access token is required");
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authenticate(request, reply);
  if (request.user.role !== "ADMIN") {
    throw forbidden("Administrator privileges are required");
  }
}
