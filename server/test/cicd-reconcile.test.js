import assert from "node:assert/strict";
import test from "node:test";
import { deriveChangeStatus } from "../src/cicd/reconcile.js";

test("CI reconciliation reflects the latest failed action", () => {
  assert.equal(deriveChangeStatus([{ status: "completed", conclusion: "failure" }], 1), "ci_failed");
});

test("CI reconciliation waits for every required repository", () => {
  assert.equal(deriveChangeStatus([{ status: "completed", conclusion: "success" }], 2), "ci_running");
  assert.equal(deriveChangeStatus([{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "success" }], 2), "ready_to_merge");
});
