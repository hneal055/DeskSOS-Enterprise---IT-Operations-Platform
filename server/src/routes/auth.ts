import { Router } from "express";
import jwt from "jsonwebtoken";
import config from "../config";

const router = Router();

// POST /api/auth/login - User login
router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body;

    // Mock validation - replace with database lookup
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Mock user data
    const user = {
      id: "user-1",
      name: "Alice Johnson",
      email: email,
      role: "admin",
    };

    // Generate JWT token
    const token = jwt.sign(user, config.jwtSecret, { expiresIn: "7d" });

    res.json({
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Login failed" });
  }
});

// POST /api/auth/register - User registration
router.post("/register", (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }

    // Mock registration - replace with database insert
    const user = {
      id: `user-${Date.now()}`,
      name,
      email,
      role: "user",
    };

    // Generate JWT token
    const token = jwt.sign(user, config.jwtSecret, { expiresIn: "7d" });

    res.json({
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Registration failed" });
  }
});

// POST /api/auth/logout - User logout
router.post("/logout", (req, res) => {
  res.json({
    message: "Logged out successfully",
  });
});

export default router;
