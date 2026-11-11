import assert from "node:assert/strict";
import test from "node:test";
import { clientSchema, projectPatchSchema, registerSchema } from "../src/validation.js";

test("registration normalizes email", () => { assert.equal(registerSchema.parse({ name: "Acme", email: "OWNER@EXAMPLE.COM", password: "password123" }).email, "owner@example.com"); });
test("registration rejects weak passwords", () => { assert.equal(registerSchema.safeParse({ name: "Acme", email: "a@example.com", password: "short" }).success, false); });
test("client requires a useful name", () => { assert.equal(clientSchema.safeParse({ name: "A" }).success, false); });
test("project updates protect immutable fields", () => { assert.equal(projectPatchSchema.safeParse({ status: "Active" }).success, true); assert.equal(projectPatchSchema.safeParse({ id: "replacement" }).success, false); });
