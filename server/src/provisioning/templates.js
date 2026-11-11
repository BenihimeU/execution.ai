const frontendWorkflow = `name: Frontend CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test --if-present
      - run: npm run build
`;

const backendWorkflow = `name: Backend CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_PASSWORD: postgres
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build --if-present
`;

const deployWorkflow = `name: Deploy
on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [Development, Test, Production]
        required: true
jobs:
  deploy:
    environment: \${{ inputs.environment }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "Connect the selected cloud deployment adapter here"
`;

export function templateFiles(type, projectName) {
  const common = {
    "README.md": `# ${projectName}\n\nGenerated and managed by Execution AI.\n`,
    ".gitignore": "node_modules/\ndist/\n.env\n",
    ".github/workflows/deploy.yml": deployWorkflow,
  };
  if (type === "Frontend") return {
    ...common,
    "package.json": JSON.stringify({ name: projectName, private: true, version: "0.1.0", type: "module", scripts: { build: "vite build", lint: "eslint .", test: "node --test" }, dependencies: { "@vitejs/plugin-react": "latest", vite: "latest", react: "latest", "react-dom": "latest" }, devDependencies: { eslint: "latest" } }, null, 2),
    "index.html": "<!doctype html><html><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.jsx\"></script></body></html>\n",
    "src/main.jsx": "import React from 'react';\nimport { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')).render(<main><h1>Application ready</h1></main>);\n",
    ".github/workflows/ci.yml": frontendWorkflow,
  };
  return {
    ...common,
    "package.json": JSON.stringify({ name: projectName, private: true, version: "0.1.0", type: "module", scripts: { start: "node src/index.js", lint: "eslint .", test: "node --test" }, dependencies: { express: "latest", pg: "latest" }, devDependencies: { eslint: "latest" } }, null, 2),
    "src/index.js": "import express from 'express';\nconst app = express();\napp.get('/health', (_req, res) => res.json({ status: 'ok' }));\napp.listen(process.env.PORT || 4000);\n",
    ".github/workflows/ci.yml": backendWorkflow,
  };
}
