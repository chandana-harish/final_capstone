import express from "express";
import {
  asyncHandler,
  decryptToken,
  errorMiddleware,
  githubRequest,
  health,
  query
} from "@pipelineiq/shared";

const app = express();
const port = process.env.PORT || 8082;

app.use(express.json());
health(app, "github-integration-service");

async function getToken(userId) {
  const result = await query("SELECT encrypted_access_token FROM github_accounts WHERE user_id = $1", [userId]);
  if (!result.rows[0]) {
    const error = new Error("GitHub account is not connected");
    error.status = 401;
    throw error;
  }
  return decryptToken(result.rows[0].encrypted_access_token);
}

app.get("/internal/users/:userId/repos", asyncHandler(async (req, res) => {
  const token = await getToken(req.params.userId);
  const repos = await githubRequest(token, "/user/repos?per_page=100&sort=updated");
  const saved = [];
  for (const repo of repos) {
    const result = await query(
      `INSERT INTO repositories (user_id, github_repo_id, owner, name, full_name, private, default_branch, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id, github_repo_id)
       DO UPDATE SET owner = EXCLUDED.owner, name = EXCLUDED.name, full_name = EXCLUDED.full_name,
         private = EXCLUDED.private, default_branch = EXCLUDED.default_branch, updated_at = NOW()
       RETURNING *`,
      [req.params.userId, repo.id, repo.owner.login, repo.name, repo.full_name, repo.private, repo.default_branch]
    );
    saved.push(result.rows[0]);
  }
  res.json({ repositories: saved });
}));

app.get("/internal/users/:userId/repos/:owner/:repo/workflows", asyncHandler(async (req, res) => {
  const token = await getToken(req.params.userId);
  const workflows = await githubRequest(token, `/repos/${req.params.owner}/${req.params.repo}/actions/workflows?per_page=100`);
  res.json(workflows);
}));

app.get("/internal/users/:userId/repos/:owner/:repo/branches", asyncHandler(async (req, res) => {
  const token = await getToken(req.params.userId);
  const branches = await githubRequest(token, `/repos/${req.params.owner}/${req.params.repo}/branches?per_page=100`);
  res.json({ branches });
}));

app.post("/internal/users/:userId/repos/:owner/:repo/workflows/:workflowId/dispatches", asyncHandler(async (req, res) => {
  const token = await getToken(req.params.userId);
  await githubRequest(
    token,
    `/repos/${req.params.owner}/${req.params.repo}/actions/workflows/${req.params.workflowId}/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({ ref: req.body.branch, inputs: req.body.inputs || {} }),
      headers: { "Content-Type": "application/json" }
    }
  );
  res.status(202).json({ dispatched: true });
}));

app.get("/internal/users/:userId/repos/:owner/:repo/runs", asyncHandler(async (req, res) => {
  const token = await getToken(req.params.userId);
  const params = new URLSearchParams();
  if (req.query.branch) params.set("branch", req.query.branch);
  params.set("per_page", req.query.per_page || "20");
  const path = req.query.workflow_id
    ? `/repos/${req.params.owner}/${req.params.repo}/actions/workflows/${req.query.workflow_id}/runs?${params.toString()}`
    : `/repos/${req.params.owner}/${req.params.repo}/actions/runs?${params.toString()}`;
  const runs = await githubRequest(token, path);
  res.json(runs);
}));

app.get("/internal/users/:userId/repos/:owner/:repo/runs/:runId", asyncHandler(async (req, res) => {
  const token = await getToken(req.params.userId);
  const run = await githubRequest(token, `/repos/${req.params.owner}/${req.params.repo}/actions/runs/${req.params.runId}`);
  res.json(run);
}));

app.get("/internal/users/:userId/repos/:owner/:repo/runs/:runId/jobs", asyncHandler(async (req, res) => {
  const token = await getToken(req.params.userId);
  const jobs = await githubRequest(token, `/repos/${req.params.owner}/${req.params.repo}/actions/runs/${req.params.runId}/jobs?per_page=100`);
  res.json(jobs);
}));

app.get("/internal/users/:userId/repos/:owner/:repo/jobs/:jobId/logs", asyncHandler(async (req, res) => {
  const token = await getToken(req.params.userId);
  const logs = await githubRequest(token, `/repos/${req.params.owner}/${req.params.repo}/actions/jobs/${req.params.jobId}/logs`);
  res.type("text/plain").send(logs);
}));

app.get("/internal/users/:userId/repos/:owner/:repo/commits/:sha", asyncHandler(async (req, res) => {
  const token = await getToken(req.params.userId);
  const commit = await githubRequest(token, `/repos/${req.params.owner}/${req.params.repo}/commits/${req.params.sha}`);
  res.json(commit);
}));

app.get("/internal/users/:userId/repos/:owner/:repo/contents", asyncHandler(async (req, res) => {
  const token = await getToken(req.params.userId);
  const path = req.query.path;
  const ref = req.query.ref;
  if (!path) return res.status(400).json({ error: "path query parameter is required" });

  const params = new URLSearchParams();
  if (ref) params.set("ref", ref);

  try {
    const content = await githubRequest(
      token,
      `/repos/${req.params.owner}/${req.params.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?${params.toString()}`
    );
    res.json(content);
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ error: "File not found" });
    throw error;
  }
}));

app.use(errorMiddleware);
app.listen(port, () => console.log(`github-integration-service listening on ${port}`));
