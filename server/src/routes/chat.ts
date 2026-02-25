import { Router } from "express";

const router = Router();

// GET /api/chat/channels - Get all channels
router.get("/channels", (req, res) => {
  try {
    const channels = [
      {
        id: "channel-1",
        name: "general",
        type: "public",
        unreadCount: 0,
        lastMessage: "Welcome to general chat",
      },
      {
        id: "channel-2",
        name: "support-team",
        type: "public",
        unreadCount: 3,
        lastMessage: "Did we resolve the customer issue?",
      },
      {
        id: "channel-3",
        name: "announcements",
        type: "public",
        unreadCount: 0,
        lastMessage: "New feature released: Advanced reporting",
      },
    ];

    res.json({
      data: channels,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch channels" });
  }
});

// GET /api/chat/channels/:id/messages - Get message history for a channel
router.get("/channels/:channelId/messages", (req, res) => {
  try {
    const { channelId } = req.params;

    // Mock message history
    const messages = [
      {
        id: "msg-1",
        content: "Hey team, how is the ticket backlog looking?",
        userId: "user-1",
        userName: "Alice Johnson",
        userAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Alice",
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        mentions: [],
        channel: channelId,
      },
      {
        id: "msg-2",
        content: "Pretty good! We've resolved 156 tickets this week",
        userId: "user-2",
        userName: "Bob Smith",
        userAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Bob",
        timestamp: new Date(Date.now() - 3300000).toISOString(),
        mentions: ["user-1"],
        channel: channelId,
      },
      {
        id: "msg-3",
        content: "That\x27s great! Keep up the good work everyone",
        userId: "user-1",
        userName: "Alice Johnson",
        userAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Alice",
        timestamp: new Date(Date.now() - 3000000).toISOString(),
        mentions: [],
        channel: channelId,
      },
    ];

    res.json({
      data: messages,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

export default router;
