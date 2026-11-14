const API_BASE = import.meta.env.VITE_API_URL || "/api";
const TOKEN_KEY = "execution-ai-token";

export const session = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function request(path, options = {}) {
  const token = session.getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fieldMessage = Object.values(body.details?.fieldErrors || {}).flat().find(Boolean);
    const error = new Error(fieldMessage ? `${body.error || "Invalid request"}: ${fieldMessage}` : body.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.details = body.details;
    throw error;
  }
  return body;
}

export const api = {
  register: (credentials) => request("/auth/register", { method: "POST", body: JSON.stringify(credentials) }),
  login: (credentials) => request("/auth/login", { method: "POST", body: JSON.stringify(credentials) }),
  getWorkspace: () => request("/workspace"),
  createClient: (client) => request("/clients", { method: "POST", body: JSON.stringify(client) }),
  createProject: (project) => request("/projects", { method: "POST", body: JSON.stringify(project) }),
  updateProject: (projectId, changes) => request(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(changes) }),
  generateProjectPlan: (projectId, brief) => request(`/projects/${projectId}/plan-assistance`, { method: "POST", body: JSON.stringify(brief) }),
  provisionProject: (projectId) => request(`/projects/${projectId}/provision`, { method: "POST", body: "{}" }),
  getProvisioningJob: (jobId) => request(`/provisioning-jobs/${jobId}`),
  retryProvisioningJob: (jobId) => request(`/provisioning-jobs/${jobId}/retry`, { method: "POST", body: "{}" }),
  generateProject: (projectId) => request(`/projects/${projectId}/generate`, { method: "POST", body: "{}" }),
  getGenerationJob: (jobId) => request(`/generation-jobs/${jobId}`),
  retryGenerationJob: (jobId) => request(`/generation-jobs/${jobId}/retry`, { method: "POST", body: "{}" }),
  redeployGenerationJob: (jobId) => request(`/generation-jobs/${jobId}/redeploy`, { method: "POST", body: "{}" }),
  getProjectBlueprint: (projectId) => request(`/projects/${projectId}/blueprint`),
  createChangeRequest: (projectId, changeRequest) => request(`/projects/${projectId}/change-requests`, { method: "POST", body: JSON.stringify(changeRequest) }),
  getChangeRequests: (projectId) => request(`/projects/${projectId}/change-requests`),
  updateChangeRequest: (changeRequestId, changes) => request(`/change-requests/${changeRequestId}`, { method: "PATCH", body: JSON.stringify(changes) }),
  approveChangeRequest: (changeRequestId) => request(`/change-requests/${changeRequestId}/approve`, { method: "POST", body: "{}" }),
  retryChangeJob: (jobId) => request(`/change-jobs/${jobId}/retry`, { method: "POST", body: "{}" }),
  implementChangeRequest: (changeRequestId) => request(`/change-requests/${changeRequestId}/implement`, { method: "POST", body: "{}" }),
  getChangeJobCicd: (jobId) => request(`/change-jobs/${jobId}/cicd`),
  mergeChangeJob: (jobId) => request(`/change-jobs/${jobId}/merge`, { method: "POST", body: "{}" }),
  getProjectEnvironments: (projectId) => request(`/projects/${projectId}/environments`),
  saveProjectEnvironment: (projectId, environment) => request(`/projects/${projectId}/environments`, { method: "POST", body: JSON.stringify(environment) }),
  deleteProjectEnvironment: (projectId, environmentId) => request(`/projects/${projectId}/environments/${environmentId}`, { method: "DELETE" }),
  deployChangeJob: (jobId, environmentId) => request(`/change-jobs/${jobId}/deploy`, { method: "POST", body: JSON.stringify({ environmentId }) }),
  approveDeployment: (deploymentId) => request(`/deployments/${deploymentId}/approve`, { method: "POST", body: "{}" }),
  getProviderConnections: () => request("/provider-connections"),
  getGitHubInstallUrl: () => request("/provider-connections/github/install-url"),
  completeGitHubConnection: (connection) => request("/provider-connections/github/complete", { method: "POST", body: JSON.stringify(connection) }),
  disconnectGitHub: () => request("/provider-connections/github", { method: "DELETE" }),
};
