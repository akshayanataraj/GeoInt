import { Button, Input, Label } from "@geolibre/ui";
import { Loader2, Lock } from "lucide-react";
import { type FormEvent, useState } from "react";

const SESSION_STORAGE_KEY = "geolibre.authGate.session";

/**
 * Full-screen sign-in gate in front of the single-screen app (
 * UI_REPURPOSE_PLAN.md §2: auth is an overlay, not a mode or a route).
 *
 * This is a CLIENT-SIDE STUB, not real authentication: there is no backend
 * yet to verify a username/password against (the News/Social backend per
 * FRONTEND_FEATURE_REQUIREMENTS.md §5.1 is being built separately). Any
 * non-empty username+password is accepted so the gate and its fields exist
 * and behave per spec (required fields, disabled submit while "in flight",
 * a generic invalid-credentials message), without pretending to a security
 * boundary the client alone can never provide (§4.2: "the backend is
 * authoritative"). Replace `fakeSignIn` with a real `POST /api/auth/login`
 * call once that endpoint exists; keep the field-level behavior as-is, it
 * already matches the documented contract.
 */
function readSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSession(signedIn: boolean): void {
  try {
    if (signedIn) sessionStorage.setItem(SESSION_STORAGE_KEY, "1");
    else sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Best-effort; a disabled/full sessionStorage just re-prompts on reload.
  }
}

interface AuthGateProps {
  children: React.ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [signedIn, setSignedIn] = useState(readSession);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (signedIn) return <>{children}</>;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter a username and password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    // Placeholder round-trip delay so the "submitting" state (spec §5.1: a
    // disabled submit button while the request is active) is visibly real,
    // not just theoretical -- there is no actual network call yet.
    window.setTimeout(() => {
      setSubmitting(false);
      writeSession(true);
      setSignedIn(true);
    }, 300);
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-4">
      <form
        onSubmit={handleSubmit}
        className="geoint-fade-in w-full max-w-sm space-y-5 rounded-2xl border bg-card p-8 shadow-lg"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-background">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-base font-semibold tracking-tight">Sign in</h1>
          <p className="text-xs text-muted-foreground">
            Access is provisioned by an administrator -- there is no self-registration.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="auth-username">Username</Label>
          <Input
            id="auth-username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            maxLength={64}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="auth-password">Password</Label>
          <Input
            id="auth-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={128}
            required
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Forgot your password? Contact an administrator.
        </p>
      </form>
    </div>
  );
}
