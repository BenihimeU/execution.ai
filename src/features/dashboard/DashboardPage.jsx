import { ArrowRight, FolderKanban, Gauge, Plus, UsersRound } from "lucide-react";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ProjectRow } from "../projects/ProjectRow.jsx";

export function DashboardPage({ workspace, onViewProjects, onAddClient, onAddProject, onOpenProject }) {
  const recentProjects = workspace.projects.slice(-3).reverse();
  const stats = [
    { label: "Active clients", value: workspace.clients.length, Icon: UsersRound, tone: "blue" },
    { label: "Total projects", value: workspace.projects.length, Icon: FolderKanban, tone: "violet" },
    { label: "In progress", value: workspace.projects.filter((project) => project.status === "In progress").length, Icon: Gauge, tone: "amber" },
  ];
  const addAction = workspace.clients.length ? onAddProject : onAddClient;

  return <>
    <div className="page-heading"><div><span className="eyebrow">Overview</span><h1>Good to see you.</h1><p>Here’s what’s happening across {workspace.organization.name}.</p></div><button className="button button--primary" onClick={addAction}><Plus size={17} /> New {workspace.clients.length ? "project" : "client"}</button></div>
    <div className="stat-grid">{stats.map(({ label, value, Icon, tone }) => <article className="stat-card" key={label}><span className={`stat-card__icon stat-card__icon--${tone}`}><Icon size={20} /></span><div><strong>{value}</strong><p>{label}</p></div></article>)}</div>
    <section className="panel"><header><div><h2>Recent projects</h2><p>Your latest client work at a glance.</p></div>{workspace.projects.length > 0 && <button className="text-button" onClick={onViewProjects}>View all <ArrowRight size={14} /></button>}</header>{recentProjects.length ? <div className="project-list">{recentProjects.map((project) => <ProjectRow key={project.id} project={project} client={workspace.clients.find((client) => client.id === project.clientId)} onOpen={() => onOpenProject(project.id)} />)}</div> : <EmptyState type="project" onAction={addAction} />}</section>
  </>;
}
