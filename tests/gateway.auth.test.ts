import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const users = new Map<string, { id: string; email: string; passwordHash: string; role: "USER" | "ADMIN" }>();

vi.mock("@distrifs/db", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
        [...users.values()].find((u) => u.id === where.id || u.email === where.email) ?? null,
      create: async ({ data }: { data: { email: string; passwordHash: string; role: "USER" | "ADMIN" } }) => {
        const user = { id: `u${users.size + 1}`, ...data };
        users.set(user.id, user);
        return user;
      },
    },
  },
}));

import { buildServer } from "../apps/gateway/src/server";

let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

beforeEach(() => users.clear());

const creds = { email: "alice@example.com", password: "supersecret1" };

describe("gateway auth", () => {
  it("registers a user and returns access and refresh tokens", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: creds });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user.role).toBe("USER");
  });

  it("rejects duplicate registration and short passwords", async () => {
    await app.inject({ method: "POST", url: "/api/auth/register", payload: creds });
    const dup = await app.inject({ method: "POST", url: "/api/auth/register", payload: creds });
    expect(dup.statusCode).toBe(409);
    const weak = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "b@example.com", password: "short" },
    });
    expect(weak.statusCode).toBe(400);
  });

  it("logs in with correct credentials only", async () => {
    users.set("u1", { id: "u1", email: creds.email, passwordHash: await bcrypt.hash(creds.password, 4), role: "USER" });
    const ok = await app.inject({ method: "POST", url: "/api/auth/login", payload: creds });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { ...creds, password: "wrongpassword" },
    });
    expect(bad.statusCode).toBe(401);
  });

  it("protects routes and accepts a valid access token", async () => {
    expect((await app.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
    const { token } = (await app.inject({ method: "POST", url: "/api/auth/register", payload: creds })).json();
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(creds.email);
  });

  it("refreshes tokens and refuses a refresh token as an access token", async () => {
    const { refreshToken, token } = (
      await app.inject({ method: "POST", url: "/api/auth/register", payload: creds })
    ).json();

    const asAccess = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    expect(asAccess.statusCode).toBe(401);

    const refreshed = await app.inject({ method: "POST", url: "/api/auth/refresh", payload: { refreshToken } });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().token).toBeTruthy();

    const withAccessToken = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: token },
    });
    expect(withAccessToken.statusCode).toBe(401);
  });

  it("requires admin for admin routes", async () => {
    const { token } = (await app.inject({ method: "POST", url: "/api/auth/register", payload: creds })).json();
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/recovery/trigger",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
