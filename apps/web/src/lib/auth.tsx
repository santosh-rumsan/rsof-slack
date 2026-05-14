import React, { createContext, useContext, useState, useEffect } from "react";
import { isAuthenticated, setApiKey, clearApiKey } from "@/lib/api";

interface AuthContextValue {
  authed: boolean;
  login: (key: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  authed: false,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(isAuthenticated);

  useEffect(() => {
    function onUnauthorized() { setAuthed(false); }
    window.addEventListener("rsof:unauthorized", onUnauthorized);
    return () => window.removeEventListener("rsof:unauthorized", onUnauthorized);
  }, []);

  function login(key: string) {
    setApiKey(key);
    setAuthed(true);
  }

  function logout() {
    clearApiKey();
    setAuthed(false);
  }

  return <AuthContext.Provider value={{ authed, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function LoginScreen() {
  const { login } = useAuth();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    // Quick validation — try health endpoint
    try {
      const res = await fetch("/api/v1/health", {
        headers: { "X-API-Key": key.trim() },
      });
      if (res.ok) {
        login(key.trim());
      } else {
        setError("Invalid API key");
      }
    } catch {
      setError("Could not reach server");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-xl border bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white font-bold text-xl">S</div>
          <h1 className="text-xl font-semibold text-gray-900">rsof-slack</h1>
          <p className="mt-1 text-sm text-gray-500">Enter your admin API key to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            placeholder="API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoFocus
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-brand py-2 text-sm font-medium text-white hover:bg-brand-light transition-colors"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
