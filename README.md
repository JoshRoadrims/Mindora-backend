# Mindora Backend

Node.js + Express + PostgreSQL (via Prisma) API for Mindora, designed to run
entirely free on your laptop right now, and move to a real host with zero
rewrite when you're ready.

## Setup (local, zero cost)

Requires: Node.js 18+, Docker Desktop.

```bash
# 1. Start Postgres (and pgAdmin, optional GUI at localhost:5050)
docker compose up -d

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env

# 4. Create tables from the schema
npm run prisma:migrate

# 5. Load demo data (matches the frontend prototype's mock data)
npm run seed

# 6. Start the API
npm run dev
```

API runs at `http://localhost:4000`. Health check: `GET /health`.

Point the frontend at it by replacing the mock data calls in
`mindora/src/data/mockData.js` with `fetch` calls to this API — that's the
next piece of work once this is running.

## Why this stack, given no funding yet

- **Docker Compose** gives you a real Postgres instance for free, identical
  to what you'll run in prod — no "works on my laptop, breaks on the server"
  surprises later.
- **Prisma** gives you migrations (versioned schema changes) for free, so
  your database structure evolves safely instead of via manual SQL you'll
  forget you ran.
- **Plain Express + JWT** — no vendor auth service, so you're not rebuilding
  auth later when you outgrow a free tier.
- Everything here runs on a $0 budget and ports to any $5-20/month host
  later (Railway, Render, a DigitalOcean droplet) with no code changes —
  just point `DATABASE_URL` at the new database.

## Environments: dev → test → prod

You don't need three servers today. You need three **separate databases**
and a config pattern that keeps them from ever touching each other. Start
here, add real infrastructure (CI/CD, staging server) once there's a reason to.

| Environment | Database | Where it runs today | Purpose |
|---|---|---|---|
| **dev** | `mindora_dev` (in your local Docker Postgres) | Your laptop | Day-to-day development |
| **test** | `mindora_test` (same Postgres instance, different DB name) | Your laptop / CI | Automated tests — always reset to a known state before each run |
| **prod** | A separate managed Postgres instance | Not yet provisioned | Real user data, once you have real users |

To create the test database locally:

```bash
docker exec -it mindora-db createdb -U mindora mindora_test
```

Then run tests with `DATABASE_URL` pointed at `mindora_test` instead of
`mindora_dev` (e.g. via a `.env.test` file loaded by your test runner).

**Never let dev and test share a database.** The moment they do, a bug in a
test can silently corrupt the data you're using to develop against, and
you'll lose hours figuring out why.

**Don't provision prod infrastructure until you have something worth
protecting with it.** At idea stage, spending time on a prod deploy pipeline
before the product does anything is effort better spent validating the
product itself. Come back to this section when you have your first real
users lined up — at that point the priorities become: managed Postgres with
automated backups, secrets stored in your host's secrets manager (never in
`.env` committed anywhere), and TLS everywhere.

## Security notes specific to Mindora

- `passwordHash` fields use bcrypt with 12 salt rounds — never store or log
  plaintext passwords.
- `ClinicalNote` and raw `CheckInAnswer` data are the most sensitive tables
  in this schema. Every route touching them must check that the requester
  actually owns/is-assigned-to that record — see `referral.routes.js` for
  the pattern (check ownership even on routes that "shouldn't" need it).
- `AuditLog` is written on every referral view/accept in the current routes.
  Extend this same pattern to clinical notes and check-in access as you
  build those routes out.
- Before any real user data touches this system, get a proper legal read on
  Kenya's Data Protection Act 2019 obligations for health data specifically
  — this schema is a reasonable technical starting point, not a compliance
  sign-off.

## Next steps

1. Wire the frontend to this API (replace `mockData.js` reads with `fetch`
   calls; the response shapes were designed to match the mock data closely).
2. Add routes for check-in submission, appointment booking, and clinical
   notes, following the RBAC + audit pattern in `referral.routes.js`.
3. Add automated tests against the `mindora_test` database.
4. When you're ready to show this to real users: pick a host (Render or
   Railway are the simplest for a two-person team), provision a managed
   Postgres instance for prod, and set up a basic CI pipeline (GitHub
   Actions is free for public/small private repos) to run tests before
   deploy.
