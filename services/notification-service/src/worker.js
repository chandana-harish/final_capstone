import nodemailer from "nodemailer";
import { consume, optionalEnv, query } from "@pipelineiq/shared";

function mailConfigured() {
  return optionalEnv("SMTP_HOST") && optionalEnv("SMTP_USER") && optionalEnv("SMTP_PASSWORD");
}

function transporter() {
  return nodemailer.createTransport({
    host: optionalEnv("SMTP_HOST"),
    port: Number(optionalEnv("SMTP_PORT", "587")),
    secure: false,
    auth: {
      user: optionalEnv("SMTP_USER"),
      pass: optionalEnv("SMTP_PASSWORD")
    }
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmail({ user, run, analysis, recommendation }) {
  const appUrl = optionalEnv("FRONTEND_URL", "https://www.aasikdevops.website");
  const repoName = `${run.owner}/${run.repo}`;
  const conclusion = run.conclusion || run.status || "unknown";
  const statusLabel = conclusion.toLowerCase() === "success" ? "completed" : "failed";
  const subject = `[PipelineIQ] Pipeline ${statusLabel}: ${repoName}`;
  const greetingName = user.username || user.email || "there";
  const failureReason = recommendation?.failure_reason || analysis?.error_summary || "PipelineIQ detected a failed workflow run.";
  const suggestedFix = recommendation?.suggested_fix || "Open PipelineIQ to review the generated remediation steps.";
  const details = [
    ["Repository", repoName],
    ["Workflow", run.workflow_name || run.workflow_id],
    ["Branch", run.branch],
    ["Status", conclusion],
    ["Failed job", analysis?.failed_job],
    ["Failed step", analysis?.failed_step],
    ["Category", analysis?.category],
    ["Confidence", recommendation?.confidence_level],
    ["Risk score", recommendation?.risk_score != null ? `${recommendation.risk_score}/100` : null]
  ].filter(([, value]) => value);

  const textDetails = details.map(([label, value]) => `${label}: ${value}`).join("\n");
  const text = `Hi ${greetingName},

PipelineIQ detected a pipeline ${statusLabel}.

${textDetails}

Failure Summary:
${failureReason}

Recommended Fix:
${suggestedFix}

Open PipelineIQ:
${appUrl}

Regards,
PipelineIQ`;

  const detailRows = details.map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px;color:#64748b;border-bottom:1px solid #e2e8f0;">${escapeHtml(label)}</td>
      <td style="padding:8px 12px;color:#0f172a;border-bottom:1px solid #e2e8f0;font-weight:600;">${escapeHtml(value)}</td>
    </tr>
  `).join("");

  const html = `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #dbeafe;border-radius:8px;overflow:hidden;">
        <div style="background:#0f766e;color:#ffffff;padding:20px 24px;">
          <div style="font-size:13px;letter-spacing:2px;font-weight:700;">PIPELINEIQ</div>
          <h1 style="margin:10px 0 0;font-size:24px;">Pipeline ${escapeHtml(statusLabel)}</h1>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 16px;">Hi ${escapeHtml(greetingName)},</p>
          <p style="margin:0 0 20px;">PipelineIQ detected a GitHub Actions workflow that needs attention.</p>
          <table style="width:100%;border-collapse:collapse;margin:0 0 22px;background:#f8fafc;border:1px solid #e2e8f0;">
            ${detailRows}
          </table>
          <h2 style="font-size:16px;margin:0 0 8px;">Failure Summary</h2>
          <p style="margin:0 0 18px;line-height:1.5;">${escapeHtml(failureReason)}</p>
          <h2 style="font-size:16px;margin:0 0 8px;">Recommended Fix</h2>
          <p style="margin:0 0 24px;line-height:1.5;">${escapeHtml(suggestedFix)}</p>
          <a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700;">Open PipelineIQ</a>
        </div>
      </div>
    </div>
  `;

  return { subject, text, html };
}

async function notify(payload) {
  const userResult = await query("SELECT email, username FROM users WHERE id = $1", [payload.userId]);
  const user = userResult.rows[0];
  if (!user?.email || !mailConfigured()) {
    await query(
      "INSERT INTO notifications (user_id, pipeline_run_id, channel, recipient, status, error) VALUES ($1, $2, 'email', $3, 'skipped', $4)",
      [payload.userId, payload.pipelineRunId, user?.email || null, "SMTP not configured or user email unavailable"]
    );
    return;
  }

  const runResult = await query(
    `SELECT
       pr.owner, pr.repo, pr.workflow_id, pr.workflow_name, pr.branch, pr.status, pr.conclusion,
       ar.failed_job, ar.failed_step, ar.category, ar.error_summary,
       ai.failure_reason, ai.suggested_fix, ai.confidence_level, ai.risk_score
     FROM pipeline_runs pr
     LEFT JOIN LATERAL (
       SELECT *
       FROM analysis_results
       WHERE pipeline_run_id = pr.id
       ORDER BY created_at DESC
       LIMIT 1
     ) ar ON TRUE
     LEFT JOIN LATERAL (
       SELECT *
       FROM ai_recommendations
       WHERE analysis_result_id = ar.id
       ORDER BY created_at DESC
       LIMIT 1
     ) ai ON TRUE
     WHERE pr.id = $1`,
    [payload.pipelineRunId]
  );
  const run = runResult.rows[0];
  if (!run) {
    await query(
      "INSERT INTO notifications (user_id, pipeline_run_id, channel, recipient, status, error) VALUES ($1, $2, 'email', $3, 'skipped', $4)",
      [payload.userId, payload.pipelineRunId, user.email, "Pipeline run not found"]
    );
    return;
  }
  const { subject, text, html } = buildEmail({
    user,
    run,
    analysis: run,
    recommendation: run
  });

  try {
    await transporter().sendMail({
      from: optionalEnv("SMTP_FROM", "PipelineIQ <no-reply@pipelineiq.local>"),
      to: user.email,
      subject,
      text,
      html
    });
    await query(
      "INSERT INTO notifications (user_id, pipeline_run_id, channel, recipient, status) VALUES ($1, $2, 'email', $3, 'sent')",
      [payload.userId, payload.pipelineRunId, user.email]
    );
  } catch (error) {
    await query(
      "INSERT INTO notifications (user_id, pipeline_run_id, channel, recipient, status, error) VALUES ($1, $2, 'email', $3, 'failed', $4)",
      [payload.userId, payload.pipelineRunId, user.email, error.message]
    );
  }
}

await consume("pipeline.notify", notify);
console.log("notification-service consuming pipeline.notify");
