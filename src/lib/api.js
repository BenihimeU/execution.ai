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
    const error = new Error(body.error || `Request failed with status ${response.status}`);
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
  provisionProject: (projectId) => request(`/projects/${projectId}/provision`, { method: "POST", body: "{}" }),
  getProvisioningJob: (jobId) => request(`/provisioning-jobs/${jobId}`),
  retryProvisioningJob: (jobId) => request(`/provisioning-jobs/${jobId}/retry`, { method: "POST", body: "{}" }),
  getProviderConnections: () => request("/provider-connections"),
  getGitHubInstallUrl: () => request("/provider-connections/github/install-url"),
  completeGitHubConnection: (connection) => request("/provider-connections/github/complete", { method: "POST", body: JSON.stringify(connection) }),
  disconnectGitHub: () => request("/provider-connections/github", { method: "DELETE" }),
};
