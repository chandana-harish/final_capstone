import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import {
  asyncHandler,
  errorMiddleware,
  health,
  optionalEnv,
  publish,
  query,
  requireUser
} from "@pipelineiq/shared";

const app = express();
const port = process.env.PORT || 8080;
const githubServiceUrl = optionalEnv("GITHUB_SERVICE_URL", "http://github-integration-service:8082");

app.use(cors({ origin: optionalEnv("FRONTEND_URL"), credentials: true }));
app.use(express.json());
app.use(cookieParser());
health(app, "dashboard-api");

async function ensureSchema() {
  await query("ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS repository_context JSONB NOT NULL DEFAULT '{}'");
  await query("ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS suggested_fixes JSONB NOT NULL DEFAULT '[]'");
  await query("ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS affected_files JSONB NOT NULL DEFAULT '[]'");
}

async function serviceJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(typeof body === "string" ? body : body.error || "Service request failed");
    error.status = response.status;
    throw error;
  }
  return body;
}

app.get("/api/repos", requireUser, asyncHandler(async (req, res) => {
  const data = await serviceJson(`${githubServiceUrl}/internal/users/${req.user.sub}/repos`);
  res.json(data);
}));

app.get("/api/repos/:owner/:repo/workflows", requireUser, asyncHandler(async (req, res) => {
  const data = await serviceJson(`${githubServiceUrl}/internal/users/${req.user.sub}/repos/${req.params.owner}/${req.params.repo}/workflows`);
  res.json(data);
}));

app.get("/api/repos/:owner/:repo/branches", requireUser, asyncHandler(async (req, res) => {
  const data = await serviceJson(`${githubServiceUrl}/internal/users/${req.user.sub}/repos/${req.params.owner}/${req.params.repo}/branches`);
  res.json(data);
}));

app.get("/api/repos/:owner/:repo/runs", requireUser, asyncHandler(async (req, res) => {
  const params = new URLSearchParams();
  if (req.query.branch) params.set("branch", req.query.branch);
  if (req.query.workflow_id) params.set("workflow_id", req.query.workflow_id);
  const data = await serviceJson(`${githubServiceUrl}/internal/users/${req.user.sub}/repos/${req.params.owner}/${req.params.repo}/runs?${params.toString()}`);
  res.json(data);
}));

app.post("/api/repos/:owner/:repo/workflows/:workflowId/run", requireUser, asyncHandler(async (req, res) => {
  const { branch, workflowName, repositoryId, inputs } = req.body;
  if (!branch) return res.status(400).json({ error: "branch is required" });

  await serviceJson(`${githubServiceUrl}/internal/users/${req.user.sub}/repos/${req.params.owner}/${req.params.repo}/workflows/${req.params.workflowId}/dispatches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch, inputs })
  });

  const runResult = await query(
    `INSERT INTO pipeline_runs (user_id, repository_id, workflow_id, workflow_name, owner, repo, branch, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'dispatched')
     RETURNING *`,
    [req.user.sub, repositoryId || null, req.params.workflowId, workflowName || null, req.params.owner, req.params.repo, branch]
  );

  await publish("pipeline.monitor", {
    pipelineRunId: runResult.rows[0].id,
    userId: req.user.sub,
    owner: req.params.owner,
    repo: req.params.repo,
    workflowId: req.params.workflowId,
    branch,
    dispatchedAt: runResult.rows[0].created_at
  });

  res.status(202).json({ pipelineRun: runResult.rows[0] });
}));

app.get("/api/pipeline-runs/:id", requireUser, asyncHandler(async (req, res) => {
  const run = await query("SELECT * FROM pipeline_runs WHERE id = $1 AND user_id = $2", [req.params.id, req.user.sub]);
  if (!run.rows[0]) return res.status(404).json({ error: "Pipeline run not found" });

  const analysis = await query(
    `SELECT ar.*, ai.failure_reason, ai.explanation, ai.possible_root_cause, ai.suggested_fix,
      ai.suggested_fixes, ai.affected_files, ai.risk_score, ai.confidence_level, ai.insufficient_evidence
     FROM analysis_results ar
     LEFT JOIN ai_recommendations ai ON ai.analysis_result_id = ar.id
     WHERE ar.pipeline_run_id = $1
     ORDER BY ar.created_at DESC
     LIMIT 1`,
    [req.params.id]
  );

  res.json({ pipelineRun: run.rows[0], analysis: analysis.rows[0] || null });
}));

app.post("/api/pipeline-runs/:id/analyze", requireUser, asyncHandler(async (req, res) => {
  const run = await query("SELECT * FROM pipeline_runs WHERE id = $1 AND user_id = $2", [req.params.id, req.user.sub]);
  if (!run.rows[0]) return res.status(404).json({ error: "Pipeline run not found" });
  await publish("pipeline.analyze", {
    pipelineRunId: run.rows[0].id,
    userId: req.user.sub,
    owner: run.rows[0].owner,
    repo: run.rows[0].repo,
    githubRunId: run.rows[0].github_run_id
  });
  res.status(202).json({ queued: true });
}));

app.get("/api/dashboard/summary", requireUser, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT
      COUNT(*)::int AS total_runs,
      COUNT(*) FILTER (WHERE conclusion = 'success')::int AS passed_runs,
      COUNT(*) FILTER (WHERE conclusion = 'failure')::int AS failed_runs
     FROM pipeline_runs
     WHERE user_id = $1`,
    [req.user.sub]
  );
  const latest = await query(
    `SELECT id, owner, repo, workflow_name, branch, status, conclusion, created_at
     FROM pipeline_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [req.user.sub]
  );
  res.json({ summary: result.rows[0], latestRuns: latest.rows });
}));

app.use(errorMiddleware);
app.listen(port, () => {
  console.log(`dashboard-api listening on ${port}`);
  ensureSchema().catch((error) => {
    console.error("dashboard-api schema migration failed", error);
  });
});
