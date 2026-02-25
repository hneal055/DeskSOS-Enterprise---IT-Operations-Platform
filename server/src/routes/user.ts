import { Router } from "express";

const router = Router();

// GET /api/user/me - Get current user
router.get("/me", (req, res) => {
  try {
    // In a real app, get from JWT token
    const user = {
      id: "user-1",
      name: "Alice Johnson",
      email: "alice@example.com",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Alice",
      role: "admin",
      status: "online",
    };

    res.json({
      data: user,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch current user" });
  }
});

export default router;
