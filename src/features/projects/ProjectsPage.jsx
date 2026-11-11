import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ProjectRow } from "./ProjectRow.jsx";

export function ProjectsPage({ workspace, onAddProject, onAddClient, onOpenProject }) {
  const [query, setQuery] = useState("");
  const projects = workspace.projects.filter((project) => project.name.toLowerCase().includes(query.toLowerCase()));
  const addAction = workspace.clients.length ? onAddProject : onAddClient;
  return <>
    <div className="page-heading"><div><span className="eyebrow">Delivery</span><h1>Projects</h1><p>Track every application from idea to launch.</p></div><button className="button button--primary" onClick={addAction}><Plus size={17} /> New project</button></div>
    {workspace.projects.length ? <section className="panel panel--table"><div className="table-tools"><label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" /></label><span>{projects.length} project{projects.length === 1 ? "" : "s"}</span></div><div className="project-list">{projects.map((project) => <ProjectRow key={project.id} project={project} client={workspace.clients.find((client) => client.id === project.clientId)} onOpen={() => onOpenProject(project.id)} />)}</div></section> : <section className="panel"><EmptyState type="project" onAction={addAction} /></section>}
  </>;
}
