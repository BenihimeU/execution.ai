import assert from "node:assert/strict";
import test from "node:test";
import { changeRequestPatchSchema, changeRequestSchema, clientSchema, environmentSchema, projectPatchSchema, registerSchema } from "../src/validation.js";

test("registration normalizes email", () => { assert.equal(registerSchema.parse({ name: "Acme", email: "OWNER@EXAMPLE.COM", password: "password123" }).email, "owner@example.com"); });
test("registration rejects weak passwords", () => { assert.equal(registerSchema.safeParse({ name: "Acme", email: "a@example.com", password: "short" }).success, false); });
test("client requires a useful name", () => { assert.equal(clientSchema.safeParse({ name: "A" }).success, false); });
test("project updates protect immutable fields", () => { assert.equal(projectPatchSchema.safeParse({ status: "Active" }).success, true); assert.equal(projectPatchSchema.safeParse({ id: "replacement" }).success, false); });
test("change requests require discussion, acceptance criteria, and a repository", () => {
  assert.equal(changeRequestSchema.safeParse({ title: "Recurring expenses", discussion: "Add recurring expenses without changing existing records.", acceptanceCriteria: ["Existing records remain unchanged"], repositories: ["Frontend", "Backend"] }).success, true);
  assert.equal(changeRequestSchema.safeParse({ title: "Bad", discussion: "Too short", acceptanceCriteria: [], repositories: [] }).success, false);
});
test("approved change requests cannot be cleared with an empty patch", () => { assert.equal(changeRequestPatchSchema.safeParse({}).success, false); });
test("deployment environments support GitHub and AWS providers", () => {
  for (const deploymentProvider of ["github", "aws"]) assert.equal(environmentSchema.safeParse({ name: "Test", environmentType: "test", deploymentProvider, requiresApproval: true }).success, true);
  assert.equal(environmentSchema.safeParse({ name: "Test", environmentType: "test", deploymentProvider: "gcp", requiresApproval: true }).success, false);
});
