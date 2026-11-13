export function generatedBackendFiles(blueprint) {
  const resources = blueprint.backend.resources;
  const routeImports = resources.map((resource) => `import { ${resource.plural}Router } from "./modules/${resource.plural}.js";`).join("\n");
  const routeUses = resources.map((resource) => `app.use("/api/${resource.plural}", ${resource.plural}Router);`).join("\n");
  const modules = Object.fromEntries(resources.map((resource) => [`src/modules/${resource.plural}.js`, resourceModule(resource)]));
  return validateFiles({
    "src/app.js": `import express from "express";\n${routeImports}\n\nexport const app = express();\napp.use(express.json());\napp.get("/health", (_req, res) => res.json({ status: "ok" }));\n${routeUses}\n`,
    "src/index.js": `import { app } from "./app.js";\nconst port = Number(process.env.PORT || 4000);\napp.listen(port, () => console.log(\`${escapeTemplate(blueprint.product.name)} API listening on port \${port}\`));\n`,
    "openapi.yaml": openApi(blueprint),
    "generation-blueprint.json": `${JSON.stringify(blueprint, null, 2)}\n`,
    ...modules,
  });
}

export function generatedFrontendFiles(blueprint) {
  const resources = blueprint.backend.resources;
  const links = resources.map((resource) => `<button onClick={() => load("${resource.plural}")}>${title(resource.plural)}</button>`).join("\n        ");
  return validateFiles({
    "src/App.jsx": `import { useState } from "react";\nimport { api } from "./lib/api.js";\nimport "./styles.css";\n\nexport default function App() {\n  const [records, setRecords] = useState([]);\n  const [section, setSection] = useState("Dashboard");\n  async function load(resource) { setSection(resource); setRecords(await api.list(resource)); }\n  return <div className="shell"><aside><h1>${escapeHtml(blueprint.product.name)}</h1><button onClick={() => { setSection("Dashboard"); setRecords([]); }}>Dashboard</button>${links}</aside><main><span>Generated application</span><h2>{section}</h2><p>${escapeHtml(blueprint.product.summary)}</p><pre>{JSON.stringify(records, null, 2)}</pre></main></div>;\n}\n`,
    "src/lib/api.js": `const API_URL = import.meta.env.VITE_API_URL || "/api";\nexport const api = { async list(resource) { const response = await fetch(\`${"${API_URL}"}/\${resource}\`); if (!response.ok) throw new Error("API request failed"); return response.json(); } };\n`,
    "vite.config.js": `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({ plugins: [react()], server: { proxy: { "/api": "http://127.0.0.1:4000" } } });\n`,
    "src/main.jsx": `import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App.jsx";\ncreateRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);\n`,
    "src/styles.css": "*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui;background:#f6f7fb;color:#252936}.shell{display:grid;grid-template-columns:240px 1fr;min-height:100vh}aside{padding:28px;background:#171c2c;color:white}aside h1{font-size:20px}button{display:block;width:100%;margin:8px 0;padding:10px;border:0;border-radius:8px;text-align:left;cursor:pointer}main{padding:48px}main span{color:#7056e8;font-weight:700;text-transform:uppercase}pre{padding:18px;border-radius:12px;background:white;box-shadow:0 8px 30px #20263a12}\n",
    "generation-blueprint.json": `${JSON.stringify(blueprint, null, 2)}\n`,
  });
}

function resourceModule(resource) {
  return `import { Router } from "express";\nexport const ${resource.plural}Router = Router();\nconst records = [];\n${resource.plural}Router.get("/", (_req, res) => res.json(records));\n${resource.plural}Router.post("/", (req, res) => { const record = { id: crypto.randomUUID(), ...req.body }; records.push(record); res.status(201).json(record); });\n`;
}

function openApi(blueprint) {
  const paths = blueprint.backend.resources.map((resource) => `  /api/${resource.plural}:\n    get:\n      summary: List ${resource.plural}\n      responses:\n        "200":\n          description: Successful response\n    post:\n      summary: Create ${resource.singular}\n      responses:\n        "201":\n          description: Created\n`).join("");
  return `openapi: 3.1.0\ninfo:\n  title: ${blueprint.product.name} API\n  version: 1.0.0\npaths:\n${paths}`;
}

function validateFiles(files) {
  for (const [path, content] of Object.entries(files)) {
    if (path.startsWith("/") || path.split("/").includes("..") || path === ".env") throw new Error(`Unsafe generated path: ${path}`);
    if (typeof content !== "string" || Buffer.byteLength(content) > 500_000) throw new Error(`Invalid generated content: ${path}`);
  }
  return files;
}

function title(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function escapeHtml(value) { return String(value).replace(/[<>&]/g, ""); }
function escapeTemplate(value) { return String(value).replace(/[`$\\]/g, ""); }
