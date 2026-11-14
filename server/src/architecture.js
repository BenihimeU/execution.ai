export function projectNeedsBackend(project) {
  const planned = project.projectPlan?.application?.backendRequired;
  if (typeof planned === "boolean") return planned;
  const source = `${project.discussion || ""}\n${project.plan || ""}`.toLowerCase();
  if (/\b(no|without)\s+(a\s+)?backend\b|\bbackend\s+(is\s+)?not\s+required\b|\bfrontend[- ]only\b|\bstatic\s+(site|website|frontend)\b/.test(source)) return false;
  return true;
}
