import cookieParser from "cookie-parser";
import cors from "cors";
import crypto from "crypto";
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
  signSession,
  verifySession
} from "@pipelineiq/shared";

const app = express();
const port = process.env.PORT || 8081;
const authProvider = optionalEnv("AUTH_PROVIDER", "github");

app.use(cors({ origin: optionalEnv("FRONTEND_URL"), credentials: true }));
app.use(express.json());
app.use(cookieParser());
health(app, "auth-service");

async function ensureSchema() {
  await query("ALTER TABLE users ALTER COLUMN github_user_id DROP NOT NULL");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS entra_user_id TEXT UNIQUE");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'github'");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ");
}

function getSessionUser(req) {
  const bearer = req.headers.authorization?.replace("Bearer ", "");
  const cookieToken = req.cookies?.pipelineiq_session;
  const token = bearer || cookieToken;
  if (!token) return null;
  try {
    return verifySession(token);
  } catch {
    return null;
  }
}

function setSessionCookie(res, user) {
  const jwt = signSession(user);
  res.cookie("pipelineiq_session", jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: Number(optionalEnv("SESSION_COOKIE_MAX_AGE_MS", String(8 * 60 * 60 * 1000)))
  });
}

function decodeJwtPayload(token) {
  const payload = token?.split(".")[1];
  if (!payload) throw new Error("Missing token payload");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

app.get("/api/auth/entra", (req, res) => {
  const state = crypto.randomUUID();
  res.cookie("pipelineiq_entra_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60 * 1000
  });

  const tenantId = requireEnv("ENTRA_TENANT_ID");
  const params = new URLSearchParams({
    client_id: requireEnv("ENTRA_CLIENT_ID"),
    response_type: "code",
    redirect_uri: requireEnv("ENTRA_CALLBACK_URL"),
    response_mode: "query",
    scope: "openid profile email User.Read",
    state
  });

  res.redirect(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`);
});

app.get("/api/auth/entra/callback", asyncHandler(async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  if (!code) return res.status(400).json({ error: "Missing Microsoft Entra OAuth code" });
  if (!state || state !== req.cookies?.pipelineiq_entra_state) {
    return res.status(400).json({ error: "Invalid Microsoft Entra OAuth state" });
  }

  const tenantId = requireEnv("ENTRA_TENANT_ID");
  const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("ENTRA_CLIENT_ID"),
      client_secret: requireEnv("ENTRA_CLIENT_SECRET"),
      code,
      redirect_uri: requireEnv("ENTRA_CALLBACK_URL"),
      grant_type: "authorization_code"
    })
  });

  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok || tokenBody.error) {
    return res.status(401).json({ error: tokenBody.error_description || "Microsoft Entra login failed" });
  }

  const claims = decodeJwtPayload(tokenBody.id_token);
  if (claims.tid !== tenantId || claims.aud !== requireEnv("ENTRA_CLIENT_ID")) {
    return res.status(401).json({ error: "Microsoft Entra token was not issued for this tenant/application" });
  }
  if (claims.exp && Date.now() / 1000 > claims.exp) {
    return res.status(401).json({ error: "Microsoft Entra token expired" });
  }

  const email = claims.preferred_username || claims.email || null;
  const displayName = claims.name || email || "PipelineIQ user";
  const userResult = await query(
    `INSERT INTO users (entra_user_id, auth_provider, username, display_name, email, last_login_at)
     VALUES ($1, 'entra', $2, $3, $4, NOW())
     ON CONFLICT (entra_user_id)
     DO UPDATE SET username = EXCLUDED.username, display_name = EXCLUDED.display_name,
       email = EXCLUDED.email, auth_provider = 'entra', last_login_at = NOW()
     RETURNING *`,
    [claims.oid || claims.sub, displayName, displayName, email]
  );

  res.clearCookie("pipelineiq_entra_state");
  setSessionCookie(res, userResult.rows[0]);
  res.redirect(optionalEnv("FRONTEND_URL", "http://localhost:5173"));
}));

app.get("/api/auth/github", (req, res) => {
  if (authProvider === "entra" && !getSessionUser(req)) {
    return res.status(401).json({ error: "Login with Microsoft Entra ID before connecting GitHub" });
  }

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

  let user;
  if (authProvider === "entra") {
    const sessionUser = getSessionUser(req);
    if (!sessionUser) {
      return res.status(401).json({ error: "Login with Microsoft Entra ID before connecting GitHub" });
    }
    const userResult = await query(
      `UPDATE users
       SET github_user_id = $1, avatar_url = $2
       WHERE id = $3
       RETURNING *`,
      [profile.id, profile.avatar_url, sessionUser.sub]
    );
    user = userResult.rows[0];
  } else {
    const userResult = await query(
      `INSERT INTO users (github_user_id, auth_provider, username, email, avatar_url, last_login_at)
       VALUES ($1, 'github', $2, $3, $4, NOW())
       ON CONFLICT (github_user_id)
       DO UPDATE SET username = EXCLUDED.username, email = EXCLUDED.email,
         avatar_url = EXCLUDED.avatar_url, auth_provider = 'github', last_login_at = NOW()
       RETURNING *`,
      [profile.id, profile.login, primaryEmail, profile.avatar_url]
    );
    user = userResult.rows[0];
  }

  await query(
    `INSERT INTO github_accounts (user_id, encrypted_access_token, scopes, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET encrypted_access_token = EXCLUDED.encrypted_access_token, scopes = EXCLUDED.scopes, updated_at = NOW()`,
    [user.id, encryptToken(accessToken), tokenBody.scope || ""]
  );

  setSessionCookie(res, user);
  res.redirect(optionalEnv("FRONTEND_URL", "http://localhost:5173"));
}));

app.get("/api/auth/me", requireUser, asyncHandler(async (req, res) => {
  const result = await query(
    "SELECT id, github_user_id, entra_user_id, auth_provider, username, display_name, email, avatar_url FROM users WHERE id = $1",
    [req.user.sub]
  );
  res.json({ user: result.rows[0] || null });
}));

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("pipelineiq_session");
  res.json({ ok: true });
});

app.use(errorMiddleware);
app.listen(port, () => {
  console.log(`auth-service listening on ${port}`);
  ensureSchema().catch((error) => {
    console.error("auth-service schema migration failed", error);
  });
});
