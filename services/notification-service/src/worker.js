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

  const runResult = await query("SELECT owner, repo, workflow_name, branch, conclusion FROM pipeline_runs WHERE id = $1", [payload.pipelineRunId]);
  const run = runResult.rows[0];
  const subject = `PipelineIQ analysis ready: ${run.owner}/${run.repo}`;
  const text = `PipelineIQ completed analysis for ${run.owner}/${run.repo} on branch ${run.branch}. Open PipelineIQ to review the Gemini fix suggestion.`;

  try {
    await transporter().sendMail({
      from: optionalEnv("SMTP_FROM", "PipelineIQ <no-reply@pipelineiq.local>"),
      to: user.email,
      subject,
      text
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

