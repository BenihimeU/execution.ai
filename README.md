# Execution AI

Starter platform for organizations to manage clients and the web-application
projects delivered for them.

## Run locally

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run db:migrate
npm run dev
```

Copying `.env.example` is optional for local development because the API uses
the same localhost database settings by default. Production always requires
explicit `DATABASE_URL` and `JWT_SECRET` values.

The web app runs at `http://localhost:5173` and the API at
`http://localhost:4000`. `npm run dev` starts the web app, API, and provisioning
worker. Use `npm run dev:web`, `npm run dev:api`, or `npm run dev:worker` to
start one process independently.

## Backend

The API in `server/` provides:

- PostgreSQL migrations with an idempotent migration runner
- organization registration and password login using bcrypt and signed JWTs
- tenant-scoped workspace, client, and project endpoints
- request validation, security headers, CORS, and JSON size limits
- liveness (`/api/health`) and database readiness (`/api/ready`) probes

Run the API validation and provisioning tests with `npm run test:api`. The
frontend uses these endpoints for authentication, workspace loading, client
and project creation, project updates, and provisioning requests.

The current frontend keeps data in the browser's local storage. It includes:

- organization registration and workspace onboarding
- a dashboard with client and project summaries
- client creation and management
- project creation linked to a client
- project discussion, delivery plan, and sketch intake
- configurable development, test, production, and custom environments
- simulated frontend/backend repository and CI/CD pipeline provisioning
- responsive navigation and empty states

## API routes

```text
POST  /api/auth/register
POST  /api/auth/login
GET   /api/workspace
POST  /api/clients
POST  /api/projects
PATCH /api/projects/:id
POST  /api/projects/:id/provision
GET   /api/provisioning-jobs/:id
POST  /api/provisioning-jobs/:id/retry
GET   /api/provider-connections
PUT   /api/provider-connections/github
GET   /api/health
GET   /api/ready
```

All workspace routes require `Authorization: Bearer <token>`.

## Next integration points

The frontend API client lives in `src/lib/api.js`. Provisioning is validated
and persisted by the backend, which generates an idempotent manifest and queues
a durable job. The provisioning worker uses a GitHub App installation token to
create or reconcile repositories, starter files, GitHub Actions workflows,
branch protection, and deployment environments.

## GitHub provisioning

Create a GitHub App with repository creation, contents, workflows,
administration, environments, actions, and metadata permissions. Configure its
App ID, slug, and private key in `.env`. Set the GitHub App Setup URL to the
Execution AI web URL (for local development, `http://localhost:5173/`).

Organization administrators connect GitHub from **Integrations → GitHub →
Connect GitHub**. Execution AI signs the installation request, GitHub redirects
back with the installation identifier, and the backend verifies the installation
directly through the GitHub App API before saving it. Users never enter an
installation ID or private key.

The private key may be provided with escaped newlines in
`GITHUB_PRIVATE_KEY`. Provisioning jobs are idempotent per project plan version;
failed retryable requests use bounded exponential backoff, and terminally failed
jobs can be queued again through the retry endpoint.

## Source structure

```text
src/
  components/   Reusable, domain-neutral UI
  domain/       Entity factories and provisioning rules
  features/     Auth, clients, dashboard, and projects
  layout/       Workspace navigation and screen orchestration
  lib/          Browser storage and future infrastructure adapters
```

`App.jsx` is only the application composition root. Feature folders own their
pages and dialogs; cross-feature business rules belong in `domain` rather than
inside presentation components.
