"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authenticate } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authenticate(mode, email, password);
      router.replace("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="panel login">
        <h1>DistriFS</h1>
        <p className="muted">{mode === "login" ? "Sign in to your account" : "Create an account"}</p>
        <form onSubmit={submit}>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input
            type="password"
            placeholder="Password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          {error && <div className="error">{error}</div>}
          <button className="primary" type="submit" disabled={busy}>
            {mode === "login" ? "Sign in" : "Register"}
          </button>
          <button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
