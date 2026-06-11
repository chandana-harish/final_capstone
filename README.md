# PipelineIQ

PipelineIQ is a separate AKS-hosted platform for running and analyzing GitHub Actions workflows.

Users log in with GitHub, select a repository, workflow, and branch, then start that workflow from PipelineIQ. PipelineIQ monitors the workflow run. If the run fails, it fetches the real GitHub Actions jobs and logs, extracts the failed step and error evidence, sends that evidence to Gemini, and shows a failure explanation with suggested fixes.

PipelineIQ does not directly deploy user applications. If the selected GitHub Actions workflow deploys to dev or prod, GitHub Actions performs that deployment. PipelineIQ triggers, monitors, and analyzes the workflow.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Auth: GitHub OAuth + JWT cookie
- GitHub: REST API for repositories, workflows, dispatches, runs, jobs, and logs
- AI: Gemini API
- Database: PostgreSQL
- Queue: RabbitMQ
- Runtime: Docker containers on AKS
- Ingress: NGINX Ingress Controller
- Secrets: Kubernetes Secrets or Azure Key Vault CSI Driver

## Services

```text
services/
  auth-service                GitHub OAuth login and session creation
  dashboard-api               Frontend-facing API aggregator
  github-integration-service  GitHub repositories, workflows, dispatches, runs, logs
  pipeline-runner-service     Workflow run monitor and queue producer
  workflow-analyzer-service   Failed job/step/log extraction
  gemini-ai-service           Gemini failure explanation and fix suggestions
  webhook-service             GitHub webhook receiver and signature validation
  notification-service        Email notification worker
frontend/                     React UI
shared/                       Database schema, shared JS utilities
k8s/                          AKS manifests
```

## Local Setup

1. Copy `.env.example` to `.env`.
2. Create a GitHub OAuth app.
3. Put the OAuth app credentials and Gemini API key in `.env`.
4. Start the stack:

```bash
docker compose up --build
```

5. Open `http://localhost:5173`.

This environment currently does not have Node or Docker installed, so the implementation has been scaffolded statically and is ready to run on a machine with Node 20+ and Docker.

## GitHub OAuth App Settings

For local development:

```text
Homepage URL: http://localhost:5173
Authorization callback URL: http://localhost:8081/api/auth/github/callback
```

For AKS production, use your public HTTPS domain:

```text
Homepage URL: https://pipelineiq.example.com
Authorization callback URL: https://pipelineiq.example.com/api/auth/github/callback
```

## Required Workflow Condition

PipelineIQ can trigger only workflows that support manual dispatch:

```yaml
on:
  workflow_dispatch:
```

If a workflow does not include `workflow_dispatch`, PipelineIQ can still display existing runs, but it cannot start that workflow.

## Core Flow

```text
User logs in with GitHub
↓
User selects repo, workflow, and branch
↓
PipelineIQ dispatches the GitHub Actions workflow
↓
PipelineIQ monitors the run
↓
If passed, dashboard shows success
↓
If failed, PipelineIQ fetches jobs and logs
↓
Analyzer extracts failed step and error evidence
↓
Gemini generates explanation and suggested fix
↓
Dashboard shows failure reason, risk score, confidence, and fix
```

## AKS Deployment

Build and push service images to Azure Container Registry, then apply manifests:

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secrets.example.yaml
kubectl apply -f k8s/
```

Before production, replace `secrets.example.yaml` with real Kubernetes Secrets or Azure Key Vault CSI integration.

