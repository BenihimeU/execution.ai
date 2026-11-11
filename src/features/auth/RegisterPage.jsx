import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Logo } from "../../components/Logo.jsx";

const initialForm = { name: "", email: "", password: "" };

export function RegisterPage({ onRegister, onLogin }) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("register");
  const [loading, setLoading] = useState(false);

  function submit(event) {
    event.preventDefault();
    if ((mode === "register" && !form.name.trim()) || !form.email.includes("@") || form.password.length < (mode === "register" ? 8 : 1)) {
      setError("Enter an organization name, valid work email, and an 8+ character password.");
      return;
    }
    setLoading(true); setError("");
    const action = mode === "register" ? onRegister : onLogin;
    Promise.resolve(action(form)).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
  }

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <Logo dark />
        <div className="auth-story__copy">
          <span className="eyebrow">Your delivery workspace</span>
          <h1>From client brief<br />to shipped product.</h1>
          <p>Organize every client and application in one calm, focused place built for execution.</p>
          <div className="auth-proof">
            {["One workspace for your organization", "Clear client and project ownership", "A foundation ready for your AI workflows"].map((item) => <div key={item}><span><Check size={14} /></span>{item}</div>)}
          </div>
        </div>
        <p className="auth-story__foot">Plan clearly. Build confidently. Ship consistently.</p>
      </section>
      <section className="auth-form-wrap"><div className="auth-form">
        <span className="auth-form__step">{mode === "register" ? "Workspace setup · 1 of 1" : "Welcome back"}</span><h2>{mode === "register" ? "Create your organization" : "Sign in to your workspace"}</h2><p>{mode === "register" ? "Start a workspace for your team, clients, and projects." : "Continue planning and delivering your projects."}</p>
        <form onSubmit={submit}>
          {mode === "register" && <label>Organization name<input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Acme Studio" /></label>}
          <label>Work email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@company.com" /></label>
          <label>Password<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="At least 8 characters" /></label>
          {error && <p className="form-error">{error}</p>}
          <button className="button button--primary button--wide" type="submit" disabled={loading}>{loading ? "Please wait…" : mode === "register" ? "Create workspace" : "Sign in"} <ArrowRight size={17} /></button>
        </form>
        <button className="auth-mode" onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(""); }}>{mode === "register" ? "Already have a workspace? Sign in" : "Need a workspace? Create one"}</button>
        <p className="legal">By continuing, you agree to the Terms of Service and Privacy Policy.</p>
      </div></section>
    </main>
  );
}
