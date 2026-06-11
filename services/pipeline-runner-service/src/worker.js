import { consume, optionalEnv, publish, query } from "@pipelineiq/shared";

const githubServiceUrl = optionalEnv("GITHUB_SERVICE_URL", "http://github-integration-service:8082");
const pollDelayMs = Number(optionalEnv("RUN_POLL_DELAY_MS", "10000"));
const maxPolls = Number(optionalEnv("RUN_MAX_POLLS", "90"));

async function serviceJson(url) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Service request failed");
  return body;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function findDispatchedRun(payload) {
  const dispatchedAt = new Date(payload.dispatchedAt || Date.now()).getTime();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const data = await serviceJson(
      `${githubServiceUrl}/internal/users/${payload.userId}/repos/${payload.owner}/${payload.repo}/runs?branch=${encodeURIComponent(payload.branch)}&workflow_id=${encodeURIComponent(payload.workflowId)}`
    );
    const candidate = data.workflow_runs?.find((run) => new Date(run.created_at).getTime() >= dispatchedAt - 30000);
    if (candidate) return candidate;
    await sleep(5000);
  }
  throw new Error("GitHub did not return a workflow run after dispatch");
}

async function monitor(payload) {
  let run = await findDispatchedRun(payload);
  await query(
    `UPDATE pipeline_runs
     SET github_run_id = $1, status = $2, conclusion = $3, commit_sha = $4, started_at = $5
     WHERE id = $6`,
    [run.id, run.status, run.conclusion, run.head_sha, run.run_started_at, payload.pipelineRunId]
  );

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    run = await serviceJson(`${githubServiceUrl}/internal/users/${payload.userId}/repos/${payload.owner}/${payload.repo}/runs/${run.id}`);
    await query(
      `UPDATE pipeline_runs
       SET status = $1, conclusion = $2, completed_at = $3
       WHERE id = $4`,
      [run.status, run.conclusion, run.updated_at, payload.pipelineRunId]
    );

    if (run.status === "completed") {
      if (run.conclusion === "failure") {
        await publish("pipeline.analyze", {
          pipelineRunId: payload.pipelineRunId,
          userId: payload.userId,
          owner: payload.owner,
          repo: payload.repo,
          githubRunId: run.id
        });
      }
      return;
    }

    await sleep(pollDelayMs);
  }

  await query("UPDATE pipeline_runs SET status = 'monitor_timeout' WHERE id = $1", [payload.pipelineRunId]);
}

await consume("pipeline.monitor", monitor);
console.log("pipeline-runner-service consuming pipeline.monitor");
