import { useMemo, useState } from "react";
import { ChevronDown, CircleUserRound, FolderKanban, LayoutGrid, LogOut, Menu, Settings, UsersRound, X } from "lucide-react";
import { Logo } from "../components/Logo.jsx";
import { api } from "../lib/api.js";
import { ClientModal } from "../features/clients/ClientModal.jsx";
import { ClientsPage } from "../features/clients/ClientsPage.jsx";
import { DashboardPage } from "../features/dashboard/DashboardPage.jsx";
import { ProjectDetailPage } from "../features/projects/ProjectDetailPage.jsx";
import { ProjectModal } from "../features/projects/ProjectModal.jsx";
import { ProjectsPage } from "../features/projects/ProjectsPage.jsx";
import { IntegrationsPage } from "../features/settings/IntegrationsPage.jsx";

export function WorkspaceLayout({ workspace, onChange, onLogout, initialPage = "dashboard", integrationResult }) {
  const [page, setPage] = useState(initialPage);
  const [modal, setModal] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const nav = useMemo(() => [
    { id: "dashboard", label: "Overview", Icon: LayoutGrid },
    { id: "clients", label: "Clients", Icon: UsersRound },
    { id: "projects", label: "Projects", Icon: FolderKanban },
    { id: "integrations", label: "Integrations", Icon: Settings },
  ], []);
  const detailProject = page.startsWith("project:") ? workspace.projects.find((project) => project.id === page.slice(8)) : null;

  async function addClient(form) {
    const client = await api.createClient(form);
    onChange({ ...workspace, clients: [...workspace.clients, client] });
    setModal(null); setPage("clients");
  }
  async function addProject(form) {
    const project = await api.createProject(form);
    onChange({ ...workspace, projects: [...workspace.projects, project] });
    setModal(null); setPage("projects");
  }
  function openProjectModal(clientId) { setModal({ type: "project", clientId: typeof clientId === "string" ? clientId : undefined }); }
  async function updateProject(projectId, changes) {
    const updated = await api.updateProject(projectId, changes);
    onChange({ ...workspace, projects: workspace.projects.map((project) => project.id === projectId ? updated : project) });
  }
  async function provisionProject(projectId) {
    const job = await api.provisionProject(projectId);
    onChange(await api.getWorkspace());
    return job;
  }

  const sharedPageProps = { workspace, onAddClient: () => setModal({ type: "client" }), onAddProject: openProjectModal, onOpenProject: (projectId) => setPage(`project:${projectId}`) };

  return <div className="app-shell">
    <aside className={menuOpen ? "sidebar sidebar--open" : "sidebar"}><div className="sidebar__top"><Logo /><button className="sidebar__close" onClick={() => setMenuOpen(false)}><X size={20} /></button></div><div className="org-switcher"><span>{workspace.organization.name.slice(0, 2).toUpperCase()}</span><div><strong>{workspace.organization.name}</strong><small>Organization</small></div><ChevronDown size={15} /></div><nav>{nav.map(({ id, label, Icon }) => <button className={page === id ? "active" : ""} key={id} onClick={() => { setPage(id); setMenuOpen(false); }}><Icon size={18} />{label}</button>)}</nav><div className="sidebar__footer"><button><CircleUserRound size={18} /><span><strong>{workspace.organization.email.split("@")[0]}</strong><small>{workspace.organization.email}</small></span></button><button className="logout" onClick={onLogout} title="Leave workspace"><LogOut size={17} /></button></div></aside>
    {menuOpen && <button className="mobile-overlay" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
    <main className="app-main"><header className="mobile-header"><button onClick={() => setMenuOpen(true)}><Menu size={22} /></button><Logo /></header><div className="content">{page === "dashboard" && <DashboardPage {...sharedPageProps} onViewProjects={() => setPage("projects")} />}{page === "clients" && <ClientsPage {...sharedPageProps} />}{page === "projects" && <ProjectsPage {...sharedPageProps} />}{page === "integrations" && <IntegrationsPage callbackResult={integrationResult} />}{detailProject && <ProjectDetailPage project={detailProject} client={workspace.clients.find((client) => client.id === detailProject.clientId)} onBack={() => setPage("projects")} onUpdate={(changes) => updateProject(detailProject.id, changes)} onProvision={() => provisionProject(detailProject.id)} onRefresh={async () => onChange(await api.getWorkspace())} />}</div></main>
    {modal?.type === "client" && <ClientModal onClose={() => setModal(null)} onSave={addClient} />}
    {modal?.type === "project" && <ProjectModal clients={workspace.clients} selectedClientId={modal.clientId} onClose={() => setModal(null)} onSave={addProject} />}
  </div>;
}
