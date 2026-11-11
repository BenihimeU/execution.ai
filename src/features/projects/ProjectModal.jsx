import { useState } from "react";
import { Modal } from "../../components/Modal.jsx";

export function ProjectModal({ clients, selectedClientId, onClose, onSave }) {
  const [form, setForm] = useState({ name: "", clientId: selectedClientId || clients[0]?.id || "", description: "", status: "Planning" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event) { event.preventDefault(); if (!form.name.trim() || !form.clientId) return; setLoading(true); setError(""); try { await onSave(form); } catch (requestError) { setError(requestError.message); setLoading(false); } }

  return <Modal title="Create a project" subtitle="Start a new application for one of your clients." onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <label>Project name<input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Customer operations portal" /></label>
      <label>Client<select required value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}><option value="">Select a client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
      <label>Description<textarea rows="3" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What are you building?" /></label>
      {error && <p className="form-error">{error}</p>}
      <footer><button type="button" className="button button--ghost" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={!clients.length || loading}>{loading ? "Creating…" : "Create project"}</button></footer>
    </form>
  </Modal>;
}
