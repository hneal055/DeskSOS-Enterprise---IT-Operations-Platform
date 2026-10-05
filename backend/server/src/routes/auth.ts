import { Router, Request, Response } from "express";
import { authenticate, checkPasswordStrength, setPassword, verifyPasswordFor, User } from "../users";
import { requireAuth, signToken } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { loginBody, changePasswordBody } from "../validation";
import { disconnectUser } from "../services/socket";

const router = Router();

function publicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword };
}

// POST /api/auth/login
router.post("/login", validate({ body: loginBody }), (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = authenticate(email, password);
  // Same response for unknown email, wrong password and deactivated account
  if (!user) return res.status(401).json({ error: "Invalid email or password" });
  res.json({ token: signToken(user), user: publicUser(user) });
});

// POST /api/auth/logout
// Tokens are stateless; the client discards its token. Kept for API symmetry.
router.post("/logout", (_req: Request, res: Response) => {
  res.status(204).end();
});

// GET /api/auth/me
router.get("/me", requireAuth({ allowPasswordChangePending: true }), (req: Request, res: Response) => {
  res.json(publicUser(req.user!));
});

// POST /api/auth/change-password
// Allowed while a password change is pending (first sign-in). Returns a new
// token, because changing the password invalidates every earlier token.
router.post(
  "/change-password",
  requireAuth({ allowPasswordChangePending: true }),
  validate({ body: changePasswordBody }),
  (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body;
    if (!verifyPasswordFor(req.user!.id, currentPassword)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    const weak = checkPasswordStrength(newPassword);
    if (weak) return res.status(400).json({ error: weak });
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: "New password must be different from the current one" });
    }
    const user = setPassword(req.user!.id, newPassword);
    // Close this user's open live connections: other tabs or devices still
    // hold the old token. Done after the response so this tab can store its
    // new token first; it then reconnects with it.
    res.on("finish", () => disconnectUser(user.id));
    res.json({ token: signToken(user), user: publicUser(user) });
  }
);

export default router;
