import express from "express";
import { errorMiddleware, health, publish, query, requireEnv, verifyGitHubSignature } from "@pipelineiq/shared";

const app = express();
const port = process.env.PORT || 8087;

app.use("/api/webhooks/github", express.raw({ type: "*/*" }));
health(app, "webhook-service");

app.post("/api/webhooks/github", async (req, res, next) => {
  try {
    const signature = req.headers["x-hub-signature-256"];
    if (!verifyGitHubSignature(requireEnv("GITHUB_WEBHOOK_SECRET"), req.body, signature)) {
      return res.status(401).json({ error: "Invalid GitHub webhook signature" });
    }

    const eventType = req.headers["x-github-event"] || "unknown";
    const deliveryId = req.headers["x-github-delivery"] || null;
    const payload = JSON.parse(req.body.toString("utf8"));

    await query(
      "INSERT INTO webhook_events (event_type, delivery_id, payload) VALUES ($1, $2, $3)",
      [eventType, deliveryId, JSON.stringify(payload)]
    );

    if (eventType === "workflow_run" && payload.workflow_run?.conclusion === "failure") {
      await publish("pipeline.webhook.failure", payload);
    }

    res.json({ received: true });
  } catch (error) {
    next(error);
  }
});

app.use(errorMiddleware);
app.listen(port, () => console.log(`webhook-service listening on ${port}`));

