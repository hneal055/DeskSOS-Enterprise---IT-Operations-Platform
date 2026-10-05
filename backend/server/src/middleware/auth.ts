import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import config from "../config";
import { getUser, Role, User } from "../users";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export const TOKEN_TTL = "8h";

interface TokenPayload {
  sub: string;
  role: Role;
  tv: number; // token_version at issue time
}

export function signToken(user: User): string {
  const payload: TokenPayload = { sub: String(user.id), role: user.role, tv: user.tokenVersion };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: TOKEN_TTL, algorithm: "HS256" });
}

// Resolves a token to an active user, or null. Rejects tokens issued before a
// password change or deactivation (token_version mismatch), so those take
// effect immediately rather than when the token expires.
export function userFromToken(token: string | undefined): User | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] }) as TokenPayload;
    const user = getUser(Number(payload.sub));
    if (!user || !user.active || user.tokenVersion !== payload.tv) return null;
    return user;
  } catch {
    return null;
  }
}

function bearerToken(req: Request): string | undefined {
  const header = req.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : undefined;
}

// Requires a valid sign-in. While an account must change its password, only
// routes that opt in with allowPasswordChangePending can be used.
export function requireAuth(opts: { allowPasswordChangePending?: boolean } = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = userFromToken(bearerToken(req));
    if (!user) return res.status(401).json({ error: "Authentication required" });
    if (user.mustChangePassword && !opts.allowPasswordChangePending) {
      return res.status(403).json({ error: "Password change required", code: "PASSWORD_CHANGE_REQUIRED" });
    }
    req.user = user;
    next();
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Insufficient permissions" });
    next();
  };
}
