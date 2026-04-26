# Build Your Own K8s (Mini Control Plane in Node.js)

A learning project that mimics core Kubernetes scheduling behavior using Node.js, BullMQ, Docker Desktop, PostgreSQL, and Valkey.

This project is a simplified "mini K8s":
- API server accepts workload requests.
- Scheduler/dispatch loop moves jobs through lifecycle states.
- CRI worker starts Docker containers (pods/processes).
- Watcher reconciles final state back to the database.

## Kubernetes Architecture Reference

The project follows the same high-level control-plane/data-plane model as Kubernetes.

![Kubernetes Cluster Architecture](https://kubernetes.io/images/docs/kubernetes-cluster-architecture.svg)

## What This Project Implements

### Component Mapping (K8s -> This Project)

- `kube-apiserver` -> Express API in `server.js`
  - Accepts `POST /job` and stores desired state.
- `etcd` -> PostgreSQL table `jobs` via Drizzle ORM (`db/schema.js`)
  - Stores source of truth for desired/actual state.
- `kube-scheduler` -> Dispatch worker/scheduler (`schedular.js`, `queues/workers.js`)
  - Moves jobs from `SUBMITTED` -> `RUNNABLE`.
- `kubelet + CRI` -> CRI worker using Dockerode (`queues/workers.js`)
  - Pulls image, creates container, starts it, sets `RUNNING`.
- `controller loops` -> Watch worker (`queues/workers.js`)
  - Inspects container state, updates to `SUCCEEDED`/`FAILED`.
- Work queue/event bus -> BullMQ + Valkey (`queues/queues.js`)

### Job Lifecycle

A job transitions through this state machine:

`SUBMITTED -> RUNNABLE -> RUNNING -> SUCCEEDED | FAILED`

Status enum is defined in `db/schema.js` and migrations in `drizzle/`.

## Codebase Structure

- `server.js`: API endpoint to create jobs.
- `schedular.js`: Starts periodic schedulers for queue processing.
- `queues/queues.js`: Queue/scheduler definitions.
- `queues/workers.js`: Dispatch, CRI, and watcher workers.
- `db/index.js`: Drizzle DB connection.
- `db/schema.js`: Jobs table + status enum.
- `docker-compose.yml`: Local Postgres + Valkey.
- `drizzle.config.js`: Drizzle migration configuration.
- `drizzle/*.sql`: Migration history.

## Runtime Architecture in This Repo

1. Client sends `POST /job` with container image and optional command.
2. API inserts row in Postgres with status `SUBMITTED`.
3. Dispatch worker claims submitted jobs and marks `RUNNABLE`.
4. CRI worker pulls image (if missing), creates and starts Docker container, stores container id, marks `RUNNING`.
5. Watcher inspects running container and marks final state (`SUCCEEDED` or `FAILED`).

## Prerequisites

- Node.js 20+ (Node.js 18+ may also work)
- Docker Desktop running (required to run containers via Docker socket)
- Valkey (local via Docker Compose)
- PostgreSQL
  - Option A: local via Docker Compose
  - Option B: Neon PostgreSQL (cloud)

## Environment Variables

Create `.env` (based on `.env.example`):

```env
DATABASE_URL=<postgres_connection_string>
PORT=3000
```

Examples:

- Local Postgres from compose:

```env
DATABASE_URL=postgresql://admin:admin@localhost:5433/mydb
PORT=3000
```

- Neon Postgres:

```env
DATABASE_URL=postgresql://<user>:<password>@<neon-host>/<db>?sslmode=require
PORT=3000
```

Note: BullMQ/Valkey connection is currently hardcoded to `127.0.0.1:6379` in `queues/workers.js`.

## Local Setup and Run

### 1. Install dependencies

```bash
npm install
```

### 2. Start infrastructure (Valkey + optional local Postgres)

```bash
docker compose up -d
```

If you use Neon for DB, you can still run compose for Valkey only, or run Valkey separately.

### 3. Configure env

Create `.env` and set `DATABASE_URL` + `PORT`.

### 4. Apply database schema

```bash
npm run db:migrate
```

Alternative (schema sync):

```bash
npm run db:push
```

### 5. Start API server

```bash
npm run dev
```

### 6. Start scheduler/workers (separate terminal)

```bash
npm run worker
```

## How to Submit a Job

### API

`POST /job`

Body:

```json
{
  "image": "alpine",
  "cmd": "echo hello-from-mini-k8s"
}
```

### cURL example

```bash
curl -X POST http://localhost:3000/job \
  -H "Content-Type: application/json" \
  -d '{"image":"alpine","cmd":"echo hello-from-mini-k8s"}'
```

Expected response:

```json
{ "jobId": "<uuid>" }
```

Then watch logs in worker terminal for transitions and container execution.

## How Docker Desktop Is Used ("ECS-like" Runtime)

This project uses Docker Desktop as the local compute runtime:
- The CRI worker talks to Docker Engine socket.
- On Windows it uses `//./pipe/docker_engine`.
- Job images are pulled and run as short-lived containers.

Think of it as a local container execution substrate similar to what ECS/Kubernetes nodes provide, but simplified.

## Current Limitations (Expected for Learning Project)

- Single-node local runtime (no real multi-node scheduling).
- No resource-aware scheduling (CPU/memory fitting).
- No retries/backoff policies yet.
- Queue/Valkey host is hardcoded.
- Basic status reconciliation and error handling.

## Useful Commands

```bash
npm run dev         # Start API server (watch mode)
npm run worker      # Start schedulers + workers (watch mode)
npm run db:migrate  # Run migrations
npm run db:push     # Push schema
npm run db:studio   # Open Drizzle Studio
```

## Summary

This repository is a practical mini-Kubernetes control loop:
- desired state is written via API,
- persisted in Postgres (etcd-like role),
- scheduled through queues,
- executed on Docker runtime,
- reconciled to terminal state by watcher loops.

It is intentionally minimal and ideal for understanding how Kubernetes-style orchestration works internally.
