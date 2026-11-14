const frontendWorkflow = `name: Frontend CI
on:
  workflow_dispatch:
  pull_request:
  push:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install --no-audit --no-fund
      - name: Lint (non-blocking)
        continue-on-error: true
        run: npm run lint --if-present
      - run: npm test --if-present
      - run: npm run build
`;

const backendWorkflow = `name: Backend CI
on:
  workflow_dispatch:
  pull_request:
  push:
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
      - run: npm install --no-audit --no-fund
      - name: Lint (non-blocking)
        continue-on-error: true
        run: npm run lint --if-present
      - run: npm test
      - run: npm run build --if-present
`;

export const deployWorkflow = `name: Deploy
on:
  pull_request:
    types: [closed]
  workflow_dispatch:
    inputs:
      environment:
        type: string
        description: Execution AI environment name
        required: true
      provider:
        type: choice
        options: [github, aws]
        required: true
      aws_region:
        type: string
      aws_role_arn:
        type: string
permissions:
  contents: read
  id-token: write
  pages: write
  pull-requests: read
concurrency:
  group: pages-deployment
  cancel-in-progress: false
jobs:
  deploy:
    if: \${{ github.event_name == 'workflow_dispatch' || github.event.pull_request.merged == true }}
    runs-on: ubuntu-latest
    environment:
      name: \${{ github.event_name == 'pull_request' && 'github-pages' || (inputs.provider == 'github' && 'github-pages' || inputs.environment) }}
      url: \${{ (github.event_name == 'pull_request' || inputs.provider == 'github') && steps.pages.outputs.page_url || '' }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event_name == 'pull_request' && github.event.pull_request.base.ref || github.ref_name }}
      - uses: actions/setup-node@v4
        if: \${{ github.event_name == 'pull_request' || inputs.provider == 'github' }}
        with:
          node-version: 22
      - name: Build frontend preview
        if: \${{ github.event_name == 'pull_request' || inputs.provider == 'github' }}
        run: |
          npm install --no-audit --no-fund
          npm run build -- --base "/\${{ github.event.repository.name }}/"
      - name: Configure GitHub Pages
        if: \${{ github.event_name == 'pull_request' || inputs.provider == 'github' }}
        uses: actions/configure-pages@v5
      - name: Upload GitHub Pages artifact
        if: \${{ github.event_name == 'pull_request' || inputs.provider == 'github' }}
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - name: Publish frontend preview
        id: pages
        if: \${{ github.event_name == 'pull_request' || inputs.provider == 'github' }}
        uses: actions/deploy-pages@v4
      - name: Authenticate to AWS with OIDC
        if: \${{ inputs.provider == 'aws' }}
        uses: aws-actions/configure-aws-credentials@v6.3.0
        with:
          role-to-assume: \${{ inputs.aws_role_arn }}
          aws-region: \${{ inputs.aws_region }}
      - if: \${{ github.event_name == 'workflow_dispatch' }}
        run: echo "Deploying to \${{ inputs.environment }}"
      - name: Run repository deployment adapter
        if: \${{ github.event_name == 'workflow_dispatch' && inputs.provider != 'github' }}
        run: |
          if [ -x scripts/deploy.sh ]; then
            scripts/deploy.sh "\${{ inputs.provider }}" "\${{ inputs.environment }}"
          else
            echo "Add scripts/deploy.sh to deploy this repository"
          fi
`;

const backendDeployWorkflow = deployWorkflow.replace("  pull_request:\n    types: [closed]\n", "");

export function templateFiles(type, projectName) {
  const packageName = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "generated-application";
  const common = {
    "README.md": `# ${projectName}\n\nGenerated and managed by Execution AI.\n`,
    ".gitignore": "node_modules/\ndist/\n.env\n",
    "eslint.config.js": eslintConfig,
  };
  if (type === "Frontend") return {
    ...common,
    ".github/workflows/deploy.yml": deployWorkflow,
    "package.json": JSON.stringify({ name: packageName, private: true, version: "0.1.0", type: "module", scripts: { build: "vite build", lint: "eslint .", test: "node --test" }, dependencies: { "@vitejs/plugin-react": "latest", vite: "latest", react: "latest", "react-dom": "latest" }, devDependencies: { eslint: "latest" } }, null, 2),
    "index.html": "<!doctype html><html><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.jsx\"></script></body></html>\n",
    "src/main.jsx": "import React from 'react';\nimport { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')).render(<main><h1>Application ready</h1></main>);\n",
    ".github/workflows/ci.yml": frontendWorkflow,
  };
  return {
    ...common,
    ".github/workflows/deploy.yml": backendDeployWorkflow,
    "package.json": JSON.stringify({ name: packageName, private: true, version: "0.1.0", type: "module", scripts: { start: "node src/index.js", lint: "eslint .", test: "node --test" }, dependencies: { express: "latest", pg: "latest" }, devDependencies: { eslint: "latest" } }, null, 2),
    "src/index.js": "import express from 'express';\nconst app = express();\napp.get('/health', (_req, res) => res.json({ status: 'ok' }));\napp.listen(process.env.PORT || 4000);\n",
    ".github/workflows/ci.yml": backendWorkflow,
  };
}

const eslintConfig = `export default [
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { console: "readonly", process: "readonly", crypto: "readonly", fetch: "readonly", document: "readonly", window: "readonly" }
    },
    rules: { "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^React$", "caughtErrorsIgnorePattern": "^error$" }] }
  }
];
`;
