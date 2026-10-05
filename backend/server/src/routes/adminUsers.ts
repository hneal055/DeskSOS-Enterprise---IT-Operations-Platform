import { Router, Request, Response } from "express";
import {
  countActiveAdmins, createUser, findUserByEmail, generatePassword, getUser, listUsers,
  resetPassword, updateUser, User,
} from "../users";
import { validate } from "../middleware/validate";
import { createUserBody, updateUserBody, userIdParams } from "../validation";

// Mounted at /api/admin/users behind requireAuth + requireRole("admin").
const router = Router();

function adminView(u: User) {
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, active: u.active,
    mustChangePassword: u.mustChangePassword, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
  };
}

// GET /api/admin/users
router.get("/", (_req: Request, res: Response) => {
  res.json(listUsers().map(adminView));
});

// POST /api/admin/users  { email, name, role }
// The server picks a temporary password, returned once, which the new user
// must change at first sign-in. Admins never choose users' passwords.
router.post("/", validate({ body: createUserBody }), (req: Request, res: Response) => {
  const { email, name, role } = req.body;
  if (findUserByEmail(email)) return res.status(409).json({ error: "A user with this email already exists" });
  const temporaryPassword = generatePassword();
  const user = createUser({ email, name, role, password: temporaryPassword, mustChangePassword: true });
  res.status(201).json({ user: adminView(user), temporaryPassword });
});

// PATCH /api/admin/users/:id  { name?, role?, active? }
router.patch("/:id", validate({ params: userIdParams, body: updateUserBody }), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const target = getUser(id);
  if (!target) return res.status(404).json({ error: "User not found" });
  const { role, active } = req.body;

  const isSelf = id === req.user!.id;
  if (isSelf && active === false) return res.status(400).json({ error: "You can't deactivate your own account" });
  if (isSelf && role && role !== "admin") return res.status(400).json({ error: "You can't remove your own admin role" });

  // Never leave the system without an active admin. With the self rules above
  // this can't trigger through normal use (the acting admin is always another
  // active admin); it's a backstop in case those rules ever change.
  const losesAdmin = target.role === "admin" && target.active && ((role && role !== "admin") || active === false);
  if (losesAdmin && countActiveAdmins() <= 1) {
    return res.status(400).json({ error: "At least one active admin is required" });
  }

  res.json(adminView(updateUser(id, req.body)));
});

// POST /api/admin/users/:id/reset-password
// Issues a new temporary password (returned once) and ends the user's sessions.
router.post("/:id/reset-password", validate({ params: userIdParams }), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!getUser(id)) return res.status(404).json({ error: "User not found" });
  const temporaryPassword = resetPassword(id);
  res.json({ user: adminView(getUser(id)!), temporaryPassword });
});

export default router;
