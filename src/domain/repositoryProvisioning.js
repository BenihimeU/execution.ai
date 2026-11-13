export function createProvisioningManifest(project, plan, environments) {
  if (plan?.status !== "approved") throw new Error("An approved project plan is required before provisioning.");
  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const repositories = [
    repository(`${slug}-web`, "Frontend", ["src", "public", ".github/workflows"], "web-ci.yml"),
    repository(`${slug}-api`, "Backend", ["src", "migrations", "tests", ".github/workflows"], "api-ci.yml"),
  ];
  return {
    version: 1,
    status: "ready",
    idempotencyKey: `${project.id}:plan-${plan.version}`,
    provider: "unconnected",
    repositories,
    environments: environments.map((name, index) => ({ name, protection: index === 0 ? "automatic" : "approval-required", secrets: [], status: "Configured" })),
    pipelines: environments.map((name, index) => ({ name, trigger: index === 0 ? "merge-to-main" : "promotion", stages: ["install", "lint", "test", "security-scan", "build", "deploy"], status: "Configured" })),
    audit: [{ event: "manifest.created", at: new Date().toISOString(), actor: "workspace-user" }],
    createdAt: new Date().toISOString(),
  };
}

function repository(name, type, directories, workflow) {
  return { name, type, visibility: "private", defaultBranch: "main", directories, workflow, status: "Ready" };
}
