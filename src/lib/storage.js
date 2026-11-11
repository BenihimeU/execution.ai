const STORAGE_KEY = "execution-ai-workspace";

export function loadWorkspace() {
  try {
    const workspace = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return workspace ? normalizeWorkspace(workspace) : null;
  } catch {
    return null;
  }
}

function normalizeWorkspace(workspace) {
  return {
    ...workspace,
    clients: workspace.clients || [],
    projects: (workspace.projects || []).map((project) => ({
      ...project,
      provisioning: project.provisioning ? {
        ...project.provisioning,
        repositories: project.provisioning.repositories || [],
        pipelines: (project.provisioning.pipelines || []).map((pipeline) => ({
          ...pipeline,
          stages: Array.isArray(pipeline.stages) ? pipeline.stages : ["install", "test", "build", "deploy"],
        })),
      } : undefined,
    })),
  };
}

export function saveWorkspace(workspace) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  return workspace;
}

export function clearWorkspace() {
  localStorage.removeItem(STORAGE_KEY);
}

export function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
