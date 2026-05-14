import React, { createContext, useContext, useState, useEffect } from "react";
import { GoogleLogin, CredentialResponse } from "@react-oauth/google";
import { isAuthenticated, setJwt, clearJwt } from "@/lib/api";

interface AuthContextValue {
  authed: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  authed: false,
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(isAuthenticated);

  useEffect(() => {
    function onUnauthorized() { setAuthed(false); }
    window.addEventListener("rsof:unauthorized", onUnauthorized);
    return () => window.removeEventListener("rsof:unauthorized", onUnauthorized);
  }, []);

  function logout() {
    clearJwt();
    setAuthed(false);
  }

  function onLoginSuccess(jwt: string) {
    setJwt(jwt);
    setAuthed(true);
  }

  return (
    <AuthContext.Provider value={{ authed, logout }}>
      {authed ? children : <LoginScreen onSuccess={onLoginSuccess} />}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// ---------------------------------------------------------------------------
// Google login screen
// ---------------------------------------------------------------------------

const AUTH_API_BASE = import.meta.env.VITE_AUTH_API_BASE_URL as string;
const APP_ID = import.meta.env.VITE_APP_ID as string;

interface LoginScreenProps {
  onSuccess: (jwt: string) => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleGoogleSuccess(credentialResponse: CredentialResponse) {
    const idToken = credentialResponse.credential;
    if (!idToken) {
      setError("Google did not return an ID token");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${AUTH_API_BASE}/auth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Id": APP_ID,
        },
        body: JSON.stringify({ id_token: idToken }),
      });

      if (!res.ok) {
        const text = await res.text();
        setError(`Authentication failed: ${text}`);
        return;
      }

      const data = await res.json();
      if (data?.data?.token) {
        onSuccess(data.data.token);
      } else {
        setError("Unexpected response from auth server");
      }
    } catch {
      setError("Could not reach authentication server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-xl border bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center">
            <img src="/slack.svg" alt="Slack" className="h-12 w-12" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Rumsan Slack</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in with your Google account to continue</p>
        </div>

        <div className="flex flex-col items-center gap-3">
          {loading ? (
            <p className="text-sm text-gray-500">Signing in...</p>
          ) : (
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => setError("Google sign-in failed")}
              useOneTap={false}
            />
          )}
          {error && <p className="text-sm text-red-600 text-center">{error}</p>}
        </div>
      </div>
    </div>
  );
}
