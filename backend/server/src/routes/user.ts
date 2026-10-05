import { Router } from "express";

const router = Router();

// GET /api/user/me - the signed-in user (mounted behind requireAuth)
router.get("/me", (req, res) => {
  const u = req.user!;
  res.json({ data: { id: u.id, name: u.name, email: u.email, role: u.role } });
});

export default router;
