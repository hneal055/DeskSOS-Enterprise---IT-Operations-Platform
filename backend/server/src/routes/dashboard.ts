import { Router } from "express";

const router = Router();

// GET /api/dashboard - Dashboard data with team status and queue metrics
router.get("/", (req, res) => {
  try {
    // Mock data - replace with database queries
    const teamStatus = [
      {
        id: "user-1",
        name: "Alice Johnson",
        status: "online",
        currentTickets: 5,
        resolvedToday: 12,
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Alice",
      },
      {
        id: "user-2",
        name: "Bob Smith",
        status: "away",
        currentTickets: 3,
        resolvedToday: 8,
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Bob",
      },
      {
        id: "user-3",
        name: "Carol Davis",
        status: "online",
        currentTickets: 7,
        resolvedToday: 15,
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Carol",
      },
    ];

    const queueMetrics = {
      new: 23,
      open: 45,
      inProgress: 18,
      pending: 12,
      resolved: 156,
      overdue: 3,
    };

    res.json({
      data: {
        teamStatus,
        queueMetrics,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

// GET /api/dashboard/metrics - Detailed metrics
router.get("/metrics", (req, res) => {
  try {
    const slaMetrics = {
      critical: 98,
      high: 87,
      medium: 94,
      low: 99,
    };

    const metrics = [
      { priority: "Critical", total: 45 },
      { priority: "High", total: 78 },
      { priority: "Medium", total: 120 },
      { priority: "Low", total: 89 },
      { priority: "Info", total: 34 },
    ];

    const dailyTrends = [
      { date: "Mon", count: 45 },
      { date: "Tue", count: 52 },
      { date: "Wed", count: 48 },
      { date: "Thu", count: 61 },
      { date: "Fri", count: 55 },
      { date: "Sat", count: 38 },
      { date: "Sun", count: 42 },
    ];

    const activityFeed = [
      {
        id: "act-1",
        user: "Alice Johnson",
        action: "resolved ticket",
        ticketId: "#TK-1234",
        status: "resolved",
        timestamp: "2 minutes ago",
      },
      {
        id: "act-2",
        user: "Bob Smith",
        action: "assigned to self",
        ticketId: "#TK-1235",
        status: "assigned",
        timestamp: "5 minutes ago",
      },
      {
        id: "act-3",
        user: "Carol Davis",
        action: "escalated ticket",
        ticketId: "#TK-1236",
        status: "escalated",
        timestamp: "12 minutes ago",
      },
    ];

    res.json({
      data: {
        slaMetrics,
        metrics,
        dailyTrends,
        activityFeed,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch metrics" });
  }
});

export default router;
