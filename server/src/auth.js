import jwt from "jsonwebtoken";
import { config } from "./config.js";

export function createToken(user) {
  return jwt.sign({ sub: user.id, organizationId: user.organization_id, email: user.email }, config.jwtSecret, { expiresIn: "7d", issuer: "execution-ai" });
}
export function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || "").split(" ");
  if (scheme !== "Bearer" || !token) return res.status(401).json({ error: "Authentication required" });
  try { req.auth = jwt.verify(token, config.jwtSecret, { issuer: "execution-ai" }); next(); }
  catch { res.status(401).json({ error: "Invalid or expired token" }); }
}

export function createIntegrationState(auth) {
  return jwt.sign({ sub: auth.sub, organizationId: auth.organizationId, purpose: "github-installation" }, config.jwtSecret, { expiresIn: "15m", issuer: "execution-ai" });
}

export function verifyIntegrationState(token, auth) {
  try {
    const state = jwt.verify(token, config.jwtSecret, { issuer: "execution-ai" });
    if (state.purpose !== "github-installation" || state.sub !== auth.sub || state.organizationId !== auth.organizationId) throw new Error();
    return state;
  } catch {
    const error = new Error("Invalid or expired GitHub installation state"); error.status = 400; throw error;
  }
}

