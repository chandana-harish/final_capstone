import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import {
  asyncHandler,
  encryptToken,
  errorMiddleware,
  health,
  optionalEnv,
  query,
  requireEnv,
  requireUser,
  signSession
} from "@pipelineiq/shared";

const app = express();
const port = process.env.PORT || 8081;

app.use(cors({ origin: optionalEnv("FRONTEND_URL"), credentials: true }));
app.use(express.json());
app.use(cookieParser());
health(app, "auth-service");

app.get("/api/auth/github", (req, res) => {
  const params = new URLSearchParams({
    client_id: requireEnv("GITHUB_CLIENT_ID"),
    redirect_uri: requireEnv("GITHUB_CALLBACK_URL"),
    scope: "read:user user:email repo workflow",
    allow_signup: "true"
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

app.get("/api/auth/github/callback", asyncHandler(async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).json({ error: "Missing GitHub OAuth code" });

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: requireEnv("GITHUB_CLIENT_ID"),
      client_secret: requireEnv("GITHUB_CLIENT_SECRET"),
      redirect_uri: requireEnv("GITHUB_CALLBACK_URL"),
      code
    })
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok || tokenBody.error) {
    return res.status(401).json({ error: tokenBody.error_description || "GitHub OAuth failed" });
  }

  const accessToken = tokenBody.access_token;
  const profileResponse = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" }
  });
  const profile = await profileResponse.json();

  const emailResponse = await fetch("https://api.github.com/user/emails", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" }
  });
  const emails = emailResponse.ok ? await emailResponse.json() : [];
  const primaryEmail = emails.find((email) => email.primary)?.email || profile.email || null;

  const userResult = await query(
    `INSERT INTO users (github_user_id, username, email, avatar_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (github_user_id)
     DO UPDATE SET username = EXCLUDED.username, email = EXCLUDED.email, avatar_url = EXCLUDED.avatar_url
     RETURNING *`,
    [profile.id, profile.login, primaryEmail, profile.avatar_url]
  );
  const user = userResult.rows[0];

  await query(
    `INSERT INTO github_accounts (user_id, encrypted_access_token, scopes, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET encrypted_access_token = EXCLUDED.encrypted_access_token, scopes = EXCLUDED.scopes, updated_at = NOW()`,
    [user.id, encryptToken(accessToken), tokenBody.scope || ""]
  );

  const jwt = signSession(user);
  res.cookie("pipelineiq_session", jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  });
  res.redirect(optionalEnv("FRONTEND_URL", "http://localhost:5173"));
}));

app.get("/api/auth/me", requireUser, asyncHandler(async (req, res) => {
  const result = await query("SELECT id, github_user_id, username, email, avatar_url FROM users WHERE id = $1", [req.user.sub]);
  res.json({ user: result.rows[0] || null });
}));

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("pipelineiq_session");
  res.json({ ok: true });
});

app.use(errorMiddleware);
app.listen(port, () => console.log(`auth-service listening on ${port}`));

