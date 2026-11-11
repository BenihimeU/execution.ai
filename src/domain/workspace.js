import { createId } from "../lib/storage.js";

export const DEFAULT_ENVIRONMENTS = ["Development", "Test", "Production"];

export function createOrganizationWorkspace({ name, email }) {
  return {
    organization: { id: createId("org"), name: name.trim(), email: email.trim() },
    clients: [],
    projects: [],
  };
}

export function createClient(data) {
  return { ...data, id: createId("client"), createdAt: new Date().toISOString() };
}

export function createProject(data) {
  return { ...data, id: createId("project"), createdAt: new Date().toISOString() };
}

