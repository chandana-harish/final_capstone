import { consume, optionalEnv, publish, query, requireEnv } from "@pipelineiq/shared";

async function ensureSchema() {
  await query("ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS suggested_fixes JSONB NOT NULL DEFAULT '[]'");
  await query("ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS affected_files JSONB NOT NULL DEFAULT '[]'");
}

function buildPrompt(payload, run) {
  const context = payload.repositoryContext || {};
  const changedFiles = (context.changedFiles || [])
    .map((file) => `- ${file.filename} (${file.status}, +${file.additions}/-${file.deletions})\n${file.patch || ""}`)
    .join("\n\n")
    .slice(0, 12000);
  const configFiles = (context.configFiles || [])
    .map((file) => `--- ${file.path} ---\n${file.content}`)
    .join("\n\n")
    .slice(0, 14000);

  return `
You are PipelineIQ, an AI DevOps failure analysis agent.

Analyze only the provided evidence: failed step logs, workflow YAML, commit details, changed files, and repository configuration snippets.
Do not invent secrets, cloud resources, file contents, test output, or code changes that are not supported by evidence.
If the evidence is weak or unclear, set insufficientEvidence to true and explain what extra evidence is needed.
Prefer actionable fixes that can make the next pipeline run pass.

Return strict JSON only with this shape:
{
  "failureReason": "short reason",
  "explanation": "plain English explanation",
  "possibleRootCause": "likely root cause or insufficient evidence",
  "suggestedFix": "specific fix the developer should try",
  "suggestedFixes": [
    {
      "type": "code change | configuration fix | dependency update | deployment correction | secret/token fix | workflow yaml fix | infrastructure fix",
      "title": "short fix title",
      "details": "specific actionable fix",
      "files": ["optional affected files"]
    }
  ],
  "affectedFiles": ["files likely involved"],
  "riskScore": 0,
  "confidenceLevel": "low | medium | high",
  "insufficientEvidence": false
}

Repository: ${payload.owner}/${payload.repo}
Workflow: ${run.workflow_name || run.workflow_id}
Branch: ${run.branch}
Commit SHA: ${run.commit_sha || "unknown"}
Commit message: ${context.commitMessage || "unknown"}
Failed job: ${payload.failedJob}
Failed step: ${payload.failedStep}
Failure category from deterministic analyzer: ${payload.category}
Workflow path: ${context.workflowPath || "unknown"}

Error summary:
${payload.errorSummary}

Important log lines:
${payload.importantLogLines.join("\n")}

Workflow YAML:
${context.workflowYaml || "not available"}

Changed files and patches:
${changedFiles || "not available"}

Relevant repository files:
${configFiles || "not available"}
`.trim();
}

function parseJsonResponse(text) {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

function normalizeRecommendation(value) {
  const suggestedFixes = Array.isArray(value.suggestedFixes)
    ? value.suggestedFixes.slice(0, 6).map((fix) => ({
      type: String(fix.type || "configuration fix"),
      title: String(fix.title || "Suggested fix"),
      details: String(fix.details || fix.suggestedFix || "Review the failed workflow evidence."),
      files: Array.isArray(fix.files) ? fix.files.map(String).slice(0, 8) : []
    }))
    : [];

  return {
    failureReason: String(value.failureReason || "Insufficient evidence"),
    explanation: String(value.explanation || "Gemini did not provide a detailed explanation."),
    possibleRootCause: String(value.possibleRootCause || ""),
    suggestedFix: String(value.suggestedFix || "Review the failed GitHub Actions logs manually."),
    suggestedFixes,
    affectedFiles: Array.isArray(value.affectedFiles) ? value.affectedFiles.map(String).slice(0, 12) : [],
    riskScore: Math.max(0, Math.min(100, Number(value.riskScore ?? 50))),
    confidenceLevel: ["low", "medium", "high"].includes(value.confidenceLevel) ? value.confidenceLevel : "low",
    insufficientEvidence: Boolean(value.insufficientEvidence)
  };
}

function evidenceBasedFallback(payload, error) {
  const evidence = `${payload.errorSummary}\n${payload.importantLogLines.join("\n")}`.toLowerCase();

  if (evidence.includes("sonar") && (evidence.includes("token") || evidence.includes("unauthorized") || evidence.includes("not authorized") || evidence.includes("authentication") || evidence.includes("401"))) {
    return {
      failureReason: "SonarQube authentication failed",
      explanation: "The workflow failed while running SonarQube analysis. The log evidence points to a missing, invalid, or unauthorized SonarQube token.",
      possibleRootCause: "The GitHub secret used for the SonarQube token is missing, expired, incorrect, or does not have permission for this SonarQube project.",
      suggestedFix: "Verify the SonarQube token secret in GitHub Actions, commonly SONAR_TOKEN. Regenerate the token in SonarQube if needed, update the GitHub repository secret, and confirm the workflow references the same secret name.",
      suggestedFixes: [
        {
          type: "secret/token fix",
          title: "Verify SonarQube token secret",
          details: "Confirm the GitHub Actions secret used by the workflow, commonly SONAR_TOKEN, exists and contains a valid SonarQube token.",
          files: []
        },
        {
          type: "configuration fix",
          title: "Check workflow secret reference",
          details: "Make sure the workflow references the same secret name configured in GitHub repository secrets.",
          files: [payload.repositoryContext?.workflowPath].filter(Boolean)
        }
      ],
      affectedFiles: [payload.repositoryContext?.workflowPath, "sonar-project.properties"].filter(Boolean),
      riskScore: 82,
      confidenceLevel: "high",
      insufficientEvidence: false
    };
  }

  if (evidence.includes("aadsts700016") || evidence.includes("application with identifier") || evidence.includes("azure/login")) {
    return {
      failureReason: "Azure login failed in GitHub Actions",
      explanation: "The workflow failed during the Azure login step before deployment could continue.",
      possibleRootCause: "The Azure client/application id configured for GitHub OIDC login was not found in the target Azure tenant, or the workflow is authenticating against the wrong tenant.",
      suggestedFix: "Verify the Azure federated identity credentials and GitHub secrets used by azure/login. Check AZURE_CLIENT_ID, AZURE_TENANT_ID, and AZURE_SUBSCRIPTION_ID, make sure the app registration exists in that tenant, and confirm the federated credential subject matches this repo, branch, and workflow.",
      suggestedFixes: [
        {
          type: "secret/token fix",
          title: "Verify Azure GitHub secrets",
          details: "Check AZURE_CLIENT_ID, AZURE_TENANT_ID, and AZURE_SUBSCRIPTION_ID in GitHub repository secrets.",
          files: []
        },
        {
          type: "deployment correction",
          title: "Fix Azure federated credential",
          details: "Ensure the Azure app registration exists in the tenant and has a federated credential matching this repository, branch, and workflow.",
          files: [payload.repositoryContext?.workflowPath].filter(Boolean)
        }
      ],
      affectedFiles: [payload.repositoryContext?.workflowPath].filter(Boolean),
      riskScore: 85,
      confidenceLevel: "high",
      insufficientEvidence: false
    };
  }

  if (payload.category === "permission/authentication issue") {
    return {
      failureReason: "Authentication or permission failure",
      explanation: "The workflow failed while authenticating or accessing a protected resource.",
      possibleRootCause: "A token, secret, service principal, federated credential, or permission assignment is missing or incorrect.",
      suggestedFix: "Review the failed authentication step and verify the required secrets, identities, tenant/subscription values, and role assignments. Re-run the workflow after correcting the credentials.",
      suggestedFixes: [
        {
          type: "secret/token fix",
          title: "Validate credentials and permissions",
          details: "Verify the secret values used in the failed step and confirm the identity has permission for the target resource.",
          files: [payload.repositoryContext?.workflowPath].filter(Boolean)
        }
      ],
      affectedFiles: [payload.repositoryContext?.workflowPath].filter(Boolean),
      riskScore: 80,
      confidenceLevel: "medium",
      insufficientEvidence: false
    };
  }

  return {
    failureReason: "AI analysis unavailable",
    explanation: "PipelineIQ detected the failed workflow, but Gemini could not run because the AI service is not configured correctly.",
    possibleRootCause: payload.category || "Unknown",
    suggestedFix: `Fix the PipelineIQ Gemini configuration first: ${error.message}. After GEMINI_API_KEY and GEMINI_MODEL are correct, rerun this pipeline so Gemini can analyze the actual failure evidence.`,
    suggestedFixes: [
      {
        type: "configuration fix",
        title: "Fix PipelineIQ AI configuration",
        details: `Resolve Gemini configuration error: ${error.message}`,
        files: []
      }
    ],
    affectedFiles: [],
    riskScore: 50,
    confidenceLevel: "low",
    insufficientEvidence: true
  };
}

async function callGemini(prompt) {
  const configuredModel = optionalEnv("GEMINI_MODEL", "gemini-2.5-flash");
  const models = [...new Set([configuredModel, "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-flash-latest"])];
  let lastError;

  for (const model of models) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${requireEnv("GEMINI_API_KEY")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    });

    const body = await response.json();
    if (!response.ok) {
      lastError = new Error(`${model}: ${body.error?.message || "Gemini API request failed"}`);
      console.error("Gemini model attempt failed", lastError.message);
      continue;
    }

    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      lastError = new Error(`${model}: Gemini response did not include text content`);
      continue;
    }

    return normalizeRecommendation(parseJsonResponse(text));
  }

  throw lastError || new Error("Gemini API request failed for all configured models");
}

async function analyzeWithGemini(payload) {
  const runResult = await query("SELECT * FROM pipeline_runs WHERE id = $1", [payload.pipelineRunId]);
  const run = runResult.rows[0];
  if (!run) throw new Error("Pipeline run not found for AI analysis");

  let recommendation;
  try {
    recommendation = await callGemini(buildPrompt(payload, run));
  } catch (error) {
    console.error("Gemini analysis failed", error);
    recommendation = evidenceBasedFallback(payload, error);
  }

  await query(
    `INSERT INTO ai_recommendations (
      analysis_result_id, failure_reason, explanation, possible_root_cause,
      suggested_fix, suggested_fixes, affected_files, risk_score, confidence_level, insufficient_evidence
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      payload.analysisResultId,
      recommendation.failureReason,
      recommendation.explanation,
      recommendation.possibleRootCause,
      recommendation.suggestedFix,
      JSON.stringify(recommendation.suggestedFixes || []),
      JSON.stringify(recommendation.affectedFiles || []),
      recommendation.riskScore,
      recommendation.confidenceLevel,
      recommendation.insufficientEvidence
    ]
  );

  await publish("pipeline.notify", {
    userId: payload.userId,
    pipelineRunId: payload.pipelineRunId,
    type: "analysis_completed"
  });
}

await ensureSchema();
await consume("pipeline.ai", analyzeWithGemini);
console.log("gemini-ai-service consuming pipeline.ai");
