import crypto from "crypto";
import jwt from "jsonwebtoken";
import { requireEnv } from "./config.js";

export function signSession(user) {
  return jwt.sign(
    { sub: user.id, githubUserId: user.github_user_id, username: user.username },
    requireEnv("JWT_SECRET"),
    { expiresIn: "8h" }
  );
}

export function verifySession(token) {
  return jwt.verify(token, requireEnv("JWT_SECRET"));
}

export function requireUser(req, res, next) {
  const bearer = req.headers.authorization?.replace("Bearer ", "");
  const cookieToken = req.cookies?.pipelineiq_session;
  const token = bearer || cookieToken;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.user = verifySession(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid session" });
  }
}

export function verifyGitHubSignature(secret, rawBody, signatureHeader) {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}

export function encryptToken(token) {
  const key = Buffer.from(requireEnv("TOKEN_ENCRYPTION_KEY"), "base64");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptToken(payload) {
  const key = Buffer.from(requireEnv("TOKEN_ENCRYPTION_KEY"), "base64");
  const data = Buffer.from(payload, "base64");
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

