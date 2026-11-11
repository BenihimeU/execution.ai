export function generateProjectPlan(project, brief) {
  const discussion = brief.discussion.trim();
  const initialPlan = brief.plan.trim();
  return {
    version: 1,
    status: "review",
    generatedAt: new Date().toISOString(),
    product: {
      vision: project.description || discussion.split(/[.!?]/)[0] || project.name,
      sourceDiscussion: discussion,
      assumptions: ["Responsive web application", "Organization-scoped access", "Observable production workloads"],
    },
    scope: {
      included: extractPlanItems(initialPlan),
      excluded: ["Native mobile applications", "Provider-specific infrastructure until credentials are connected"],
    },
    architecture: {
      frontend: "React web application",
      backend: "API service with organization-scoped authorization",
      data: "Relational database with migrations",
      delivery: "Independent frontend and backend pipelines",
    },
    phases: [
      { name: "Foundation", outcome: "Repositories, environments, authentication, and delivery pipelines" },
      { name: "Core product", outcome: "Primary user journeys and API capabilities" },
      { name: "Hardening", outcome: "Automated tests, security checks, observability, and release readiness" },
    ],
    qualityGates: ["Lint and unit tests", "Build verification", "Dependency and secret scan", "Test environment approval", "Production approval"],
  };
}

export function approveProjectPlan(plan) {
  return { ...plan, status: "approved", approvedAt: new Date().toISOString() };
}

function extractPlanItems(plan) {
  const items = plan.split(/\n|[.;]/).map((item) => item.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 8);
  return items.length ? items : ["Validate the product scope", "Implement the primary user journey", "Prepare the application for release"];
}
