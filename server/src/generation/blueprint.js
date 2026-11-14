import { projectNeedsBackend } from "../architecture.js";

export function createApplicationBlueprint(project) {
  const plan = project.projectPlan;
  if (plan?.status !== "approved") throw Object.assign(new Error("The delivery plan must be approved before generation"), { status: 409 });
  const resources = inferResources(project);
  return {
    version: plan.version,
    product: { name: project.name, summary: project.description || plan.product?.vision || `${project.name} web application` },
    frontend: {
      framework: "React and Vite",
      pages: ["Dashboard", ...resources.map((resource) => title(resource.plural))],
      apiOperations: resources.flatMap((resource) => [`list${title(resource.plural)}`, `create${title(resource.singular)}`]),
    },
    application: { backendRequired: projectNeedsBackend(project) },
    backend: {
      runtime: "Node.js and Express",
      routes: resources.flatMap((resource) => [
        { method: "GET", path: `/api/${resource.plural}` },
        { method: "POST", path: `/api/${resource.plural}` },
      ]),
      resources,
    },
    database: { engine: "PostgreSQL", resources: resources.map((resource) => resource.plural) },
    environments: project.environments || ["Development", "Test", "Production"],
    source: { discussion: project.discussion || "", plan: project.plan || "", sketchName: project.sketchName || null },
  };
}

function inferResources(project) {
  const text = `${project.name} ${project.description || ""} ${project.discussion || ""} ${project.plan || ""}`.toLowerCase();
  const candidates = [
    ["client", "clients"], ["project", "projects"], ["transaction", "transactions"],
    ["expense", "expenses"], ["invoice", "invoices"], ["task", "tasks"], ["user", "users"],
  ];
  const matches = candidates.filter(([singular, plural]) => text.includes(singular) || text.includes(plural));
  return (matches.length ? matches : [["item", "items"]]).slice(0, 4).map(([singular, plural]) => ({ singular, plural }));
}

function title(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
