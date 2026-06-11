import { consume, optionalEnv, publish, query } from "@pipelineiq/shared";

const githubServiceUrl = optionalEnv("GITHUB_SERVICE_URL", "http://github-integration-service:8082");

async function serviceJson(url) {
  const response = await fetch(url);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(typeof body === "string" ? body : body.error || "Service request failed");
  return body;
}

function classifyFailure(lines) {
  const joined = lines.join("\n").toLowerCase();
  if (joined.includes("sonar") && (joined.includes("token") || joined.includes("unauthorized") || joined.includes("not authorized") || joined.includes("authentication") || joined.includes("401"))) return "SonarQube token/authentication issue";
  if (joined.includes("aadsts") || joined.includes("azure/login") || joined.includes("az login") || joined.includes("authenticate interactively")) return "permission/authentication issue";
  if (joined.includes("npm err") || joined.includes("package-lock") || joined.includes("dependency") || joined.includes("pip install")) return "dependency issue";
  if (joined.includes("test failed") || joined.includes("expected") || joined.includes("assertion") || joined.includes("jest")) return "test failure";
  if (joined.includes("docker build") || joined.includes("dockerfile") || joined.includes("failed to solve")) return "Docker image build failure";
  if (joined.includes("kubectl") || joined.includes("helm") || joined.includes("deployment") || joined.includes("rollout")) return "deployment failure";
  if (joined.includes("secret") || joined.includes("environment variable") || joined.includes("env var") || joined.includes("not defined")) return "environment variable/secrets issue";
  if (joined.includes("timed out") || joined.includes("timeout") || joined.includes("cancelled")) return "timeout issue";
  if (joined.includes("permission denied") || joined.includes("unauthorized") || joined.includes("forbidden") || joined.includes("authentication") || joined.includes("authenticate")) return "permission/authentication issue";
  return "build failure";
}

function extractEvidence(logText) {
  const rawLines = logText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const errorPatterns = [
    /error/i,
    /failed/i,
    /exception/i,
    /fatal/i,
    /permission denied/i,
    /unauthorized/i,
    /timed out/i,
    /not found/i,
    /cannot find/i,
    /exit code/i
  ];

  const matches = [];
  for (let index = 0; index < rawLines.length; index += 1) {
    if (errorPatterns.some((pattern) => pattern.test(rawLines[index]))) {
      const context = rawLines.slice(Math.max(0, index - 2), Math.min(rawLines.length, index + 3));
      for (const line of context) {
        if (!matches.includes(line)) matches.push(line);
      }
    }
  }

  return matches.slice(0, 40);
}

async function analyze(payload) {
  const jobsPayload = await serviceJson(`${githubServiceUrl}/internal/users/${payload.userId}/repos/${payload.owner}/${payload.repo}/runs/${payload.githubRunId}/jobs`);
  const failedJob = jobsPayload.jobs?.find((job) => job.conclusion === "failure") || jobsPayload.jobs?.find((job) => job.status === "completed");
  if (!failedJob) {
    throw new Error("No failed GitHub Actions job found for failed workflow run");
  }

  await query(
    `INSERT INTO workflow_jobs (pipeline_run_id, github_job_id, name, status, conclusion, started_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [payload.pipelineRunId, failedJob.id, failedJob.name, failedJob.status, failedJob.conclusion, failedJob.started_at, failedJob.completed_at]
  );

  const failedStep = failedJob.steps?.find((step) => step.conclusion === "failure");
  const logText = await serviceJson(`${githubServiceUrl}/internal/users/${payload.userId}/repos/${payload.owner}/${payload.repo}/jobs/${failedJob.id}/logs`);
  const importantLogLines = extractEvidence(logText);
  const category = classifyFailure(importantLogLines);
  const errorSummary = importantLogLines.slice(0, 8).join("\n") || "No clear error lines found in the workflow log.";

  const result = await query(
    `INSERT INTO analysis_results (pipeline_run_id, failed_job, failed_step, category, error_summary, important_log_lines)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      payload.pipelineRunId,
      failedJob.name,
      failedStep?.name || "Unknown failed step",
      category,
      errorSummary,
      JSON.stringify(importantLogLines)
    ]
  );

  await publish("pipeline.ai", {
    analysisResultId: result.rows[0].id,
    pipelineRunId: payload.pipelineRunId,
    userId: payload.userId,
    owner: payload.owner,
    repo: payload.repo,
    githubRunId: payload.githubRunId,
    failedJob: failedJob.name,
    failedStep: failedStep?.name || "Unknown failed step",
    category,
    errorSummary,
    importantLogLines
  });
}

await consume("pipeline.analyze", analyze);
console.log("workflow-analyzer-service consuming pipeline.analyze");
