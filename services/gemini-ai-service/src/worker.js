import { consume, optionalEnv, publish, query, requireEnv } from "@pipelineiq/shared";

function buildPrompt(payload, run) {
  return `
You are PipelineIQ, a CI/CD failure analysis assistant.

Analyze only the evidence provided. Do not invent missing facts. If the logs are unclear, set insufficientEvidence to true and explain what is missing.

Return strict JSON only with this shape:
{
  "failureReason": "short reason",
  "explanation": "plain English explanation",
  "possibleRootCause": "likely root cause or insufficient evidence",
  "suggestedFix": "specific fix the developer should try",
  "riskScore": 0,
  "confidenceLevel": "low | medium | high",
  "insufficientEvidence": false
}

Repository: ${payload.owner}/${payload.repo}
Workflow: ${run.workflow_name || run.workflow_id}
Branch: ${run.branch}
Commit SHA: ${run.commit_sha || "unknown"}
Failed job: ${payload.failedJob}
Failed step: ${payload.failedStep}
Failure category from deterministic analyzer: ${payload.category}

Error summary:
${payload.errorSummary}

Important log lines:
${payload.importantLogLines.join("\n")}
`.trim();
}

function parseJsonResponse(text) {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

function normalizeRecommendation(value) {
  return {
    failureReason: String(value.failureReason || "Insufficient evidence"),
    explanation: String(value.explanation || "Gemini did not provide a detailed explanation."),
    possibleRootCause: String(value.possibleRootCause || ""),
    suggestedFix: String(value.suggestedFix || "Review the failed GitHub Actions logs manually."),
    riskScore: Math.max(0, Math.min(100, Number(value.riskScore ?? 50))),
    confidenceLevel: ["low", "medium", "high"].includes(value.confidenceLevel) ? value.confidenceLevel : "low",
    insufficientEvidence: Boolean(value.insufficientEvidence)
  };
}

async function callGemini(prompt) {
  const model = optionalEnv("GEMINI_MODEL", "gemini-1.5-pro");
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
    throw new Error(body.error?.message || "Gemini API request failed");
  }
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini response did not include text content");
  return normalizeRecommendation(parseJsonResponse(text));
}

async function analyzeWithGemini(payload) {
  const runResult = await query("SELECT * FROM pipeline_runs WHERE id = $1", [payload.pipelineRunId]);
  const run = runResult.rows[0];
  if (!run) throw new Error("Pipeline run not found for AI analysis");

  const recommendation = await callGemini(buildPrompt(payload, run));

  await query(
    `INSERT INTO ai_recommendations (
      analysis_result_id, failure_reason, explanation, possible_root_cause,
      suggested_fix, risk_score, confidence_level, insufficient_evidence
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      payload.analysisResultId,
      recommendation.failureReason,
      recommendation.explanation,
      recommendation.possibleRootCause,
      recommendation.suggestedFix,
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

await consume("pipeline.ai", analyzeWithGemini);
console.log("gemini-ai-service consuming pipeline.ai");

