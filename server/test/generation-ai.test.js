import assert from "node:assert/strict";
import test from "node:test";
import { GenerationAiProvider } from "../src/generation/aiProvider.js";

test("generation agent returns validated repository files", async () => {
  class FakeAgent extends GenerationAiProvider {
    async withGemini() { return { summary: "Created the product dashboard", files: [{ path: "src/App.jsx", content: "export default function App(){return <main>Ready</main>}" }] }; }
  }
  const result = await new FakeAgent({ aiProvider: "gemini" }).generateRepository({ blueprint: { application: { backendRequired: false } }, repositoryType: "Frontend", baselineFiles: {} });
  assert.equal(result.summary, "Created the product dashboard");
  assert.ok(result.files["src/App.jsx"]);
});

test("generation agent rejects unsafe files", async () => {
  class UnsafeAgent extends GenerationAiProvider {
    async withGemini() { return { summary: "Unsafe", files: [{ path: ".env", content: "SECRET=value" }] }; }
  }
  await assert.rejects(() => new UnsafeAgent({ aiProvider: "gemini" }).generateRepository({ blueprint: {}, repositoryType: "Frontend", baselineFiles: {} }), /Unsafe generated path/);
});
