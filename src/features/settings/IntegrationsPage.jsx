import { useEffect, useState } from "react";
import { Check, ExternalLink, GitBranch, Link2Off, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api.js";

export function IntegrationsPage({ callbackResult }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(callbackResult?.error || "");
  const github = connections.find((connection) => connection.provider === "github");

  useEffect(() => { api.getProviderConnections().then(setConnections).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false)); }, []);

  async function connect() {
    setLoading(true); setError("");
    try { const { url } = await api.getGitHubInstallUrl(); window.location.assign(url); }
    catch (requestError) { setError(requestError.message); setLoading(false); }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect GitHub from this organization? New repositories cannot be provisioned until it is reconnected.")) return;
    setLoading(true); setError("");
    try { await api.disconnectGitHub(); setConnections([]); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">Organization settings</span><h1>Integrations</h1><p>Connect the providers Execution AI uses to provision and deliver applications.</p></div></div>
    {callbackResult?.success && <div className="integration-notice integration-notice--success"><Check size={17} /> GitHub was connected successfully.</div>}
    {error && <div className="integration-notice integration-notice--error">{error}</div>}
    <section className="panel integration-card"><div className="integration-card__brand"><span><GitBranch size={29} /></span><div><h2>GitHub</h2><p>Create repositories, commit application templates, configure Actions, and protect environments.</p></div></div>
      <div className="integration-card__body">{github ? <><div className="connection-summary"><span><ShieldCheck size={19} /></span><div><strong>Connected to {github.owner}</strong><small>GitHub App installation {github.installationId}</small></div><em><Check size={13} /> Connected</em></div><div className="integration-actions"><button className="button button--ghost" onClick={connect} disabled={loading}><RefreshCw size={15} /> Change installation</button><button className="button button--danger" onClick={disconnect} disabled={loading}><Link2Off size={15} /> Disconnect</button></div></> : <><div className="connection-empty"><GitBranch size={25} /><div><strong>GitHub is not connected</strong><span>An organization administrator must install the Execution AI GitHub App before projects can be provisioned.</span></div></div><button className="button button--primary" onClick={connect} disabled={loading}>{loading ? "Checking…" : "Connect GitHub"} <ExternalLink size={15} /></button></>}</div>
      <footer><strong>Requested access</strong><span>Repository creation · Contents and workflows · Branch protection · Environments</span></footer>
    </section>
  </>;
}
