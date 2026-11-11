export function ProjectRow({ project, client, onOpen }) {
  const statusClass = project.status.toLowerCase().replace(" ", "-");
  const created = new Date(project.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return <button className="project-row" onClick={onOpen}><span className="project-avatar">{project.name.slice(0, 2).toUpperCase()}</span><span className="project-row__main"><strong>{project.name}</strong><span>{client?.name ?? "Unassigned"}</span></span><span className={`status status--${statusClass}`}>{project.status}</span><span className="project-row__date">Created {created}</span></button>;
}
