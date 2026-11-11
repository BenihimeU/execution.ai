import { useCallback, useEffect, useState } from "react";
import { RegisterPage } from "./features/auth/RegisterPage.jsx";
import { WorkspaceLayout } from "./layout/WorkspaceLayout.jsx";
import { api, session } from "./lib/api.js";

export default function App() {
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(Boolean(session.getToken()));
  const [integrationResult, setIntegrationResult] = useState(null);

  const completeGitHubCallback = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const installationId = params.get("installation_id");
    const state = params.get("state");
    if (!installationId || !state) return;
    try { await api.completeGitHubConnection({ installationId, state }); setIntegrationResult({ success: true }); }
    catch (error) { setIntegrationResult({ error: error.message }); }
    finally { window.history.replaceState({}, document.title, window.location.pathname); }
  }, []);

  useEffect(() => {
    if (!session.getToken()) return;
    async function bootstrap() {
      try { setWorkspace(await api.getWorkspace()); await completeGitHubCallback(); }
      catch { session.clear(); setWorkspace(null); }
    }
    bootstrap().finally(() => setLoading(false));
  }, [completeGitHubCallback]);

  async function register(credentials) {
    const result = await api.register(credentials);
    session.setToken(result.token);
    setWorkspace(result.workspace);
  }

  async function login(credentials) {
    const result = await api.login({ email: credentials.email, password: credentials.password });
    session.setToken(result.token);
    setWorkspace(await api.getWorkspace());
    await completeGitHubCallback();
  }

  function logout() {
    session.clear();
    setWorkspace(null);
  }

  if (loading) return <main className="app-loading">Loading workspace…</main>;
  return workspace
    ? <WorkspaceLayout key={integrationResult ? "github-callback" : "workspace"} workspace={workspace} onChange={setWorkspace} onLogout={logout} initialPage={integrationResult ? "integrations" : "dashboard"} integrationResult={integrationResult} />
    : <RegisterPage onRegister={register} onLogin={login} />;
}
