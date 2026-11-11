import { FolderKanban, Plus, UsersRound } from "lucide-react";

export function EmptyState({ type, onAction }) {
  const isClient = type === "client";
  const Icon = isClient ? UsersRound : FolderKanban;

  return (
    <div className="empty-state">
      <span><Icon size={25} /></span>
      <h3>No {isClient ? "clients" : "projects"} yet</h3>
      <p>{isClient ? "Add your first client to start organizing their work." : "Create a project once you have a client in your workspace."}</p>
      <button className="button button--primary" onClick={onAction}><Plus size={16} /> {isClient ? "Add client" : "Create project"}</button>
    </div>
  );
}
