import { useState } from "react";
import { Modal } from "../../components/Modal.jsx";

export function ClientModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name: "", contact: "", email: "", industry: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event) { event.preventDefault(); if (!form.name.trim()) return; setLoading(true); setError(""); try { await onSave(form); } catch (requestError) { setError(requestError.message); setLoading(false); } }

  return <Modal title="Add a client" subtitle="Create a client workspace for upcoming projects." onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <label>Client name<input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Northstar Labs" /></label>
      <div className="form-grid"><label>Primary contact<input value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} placeholder="Jordan Lee" /></label><label>Industry<input value={form.industry} onChange={(event) => setForm({ ...form, industry: event.target.value })} placeholder="Technology" /></label></div>
      <label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="jordan@northstar.com" /></label>
      {error && <p className="form-error">{error}</p>}
      <footer><button type="button" className="button button--ghost" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={loading}>{loading ? "Adding…" : "Add client"}</button></footer>
    </form>
  </Modal>;
}
