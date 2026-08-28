import { useState, useEffect, ReactNode } from "react";
import { getAccessToken, setAccessToken } from "../utils/api";
import { KmuttMark } from "./Layout";
import "./AuthGate.css";

/**
 * Access-token gate — the first thing anyone sees before the app loads.
 *
 * Verifies whatever token is already stored (so a returning visitor skips
 * straight past this), otherwise asks for the token configured server-side
 * (ACCESS_TOKEN in .env). Kept visually on-brand rather than the old generic
 * dark-mode form, since it's the very first impression of the app.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: getAccessToken() }),
      });
      const data = await res.json();
      setAuthed(Boolean(data.ok));
    } catch {
      setAuthed(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.ok) {
        setAccessToken(token);
        setAuthed(true);
      } else {
        setError("Invalid access token");
      }
    } catch {
      setError("Could not reach the server — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (authed === null) {
    return (
      <div className="authgate-screen">
        <div className="authgate-loading">
          <span className="authgate-mark authgate-mark-loading"><KmuttMark size={32} /></span>
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="authgate-screen">
        <form onSubmit={handleSubmit} className="authgate-card">
          <span className="authgate-mark"><KmuttMark size={34} /></span>
          <h1>KMUTT-Assistant</h1>
          <p className="authgate-sub">Enter the access token to continue</p>

          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Access token"
            autoFocus
            className="authgate-input"
          />

          {error && <div className="authgate-error">{error}</div>}

          <button type="submit" className="authgate-submit" disabled={submitting || !token}>
            {submitting ? "Checking…" : "Enter"}
          </button>
        </form>
        <p className="authgate-footer">King Mongkut's University of Technology Thonburi</p>
      </div>
    );
  }

  return <>{children}</>;
}
