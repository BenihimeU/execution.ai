import { ArrowRight, ChevronDown, FolderKanban, Plus } from "lucide-react";
import { EmptyState } from "../../components/EmptyState.jsx";

export function ClientsPage({ workspace, onAddClient, onAddProject }) {
  return <>
    <div className="page-heading"><div><span className="eyebrow">Relationships</span><h1>Clients</h1><p>Manage the organizations you build for.</p></div><button className="button button--primary" onClick={onAddClient}><Plus size={17} /> Add client</button></div>
    {workspace.clients.length ? <div className="card-grid">{workspace.clients.map((client) => {
      const count = workspace.projects.filter((project) => project.clientId === client.id).length;
      return <article className="client-card" key={client.id}><header><span>{client.name.slice(0, 2).toUpperCase()}</span><button className="icon-button"><ChevronDown size={17} /></button></header><h3>{client.name}</h3><p>{client.industry || "Client organization"}</p><div className="client-meta"><span><FolderKanban size={15} /> {count} project{count === 1 ? "" : "s"}</span><span>{client.contact || client.email || "No contact added"}</span></div><button className="button button--soft" onClick={() => onAddProject(client.id)}>Create project <ArrowRight size={15} /></button></article>;
    })}</div> : <section className="panel"><EmptyState type="client" onAction={onAddClient} /></section>}
  </>;
}
