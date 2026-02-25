import { Server as SocketIOServer, Socket } from "socket.io";

interface ConnectedUser {
  id: string;
  name: string;
  socket: Socket;
}

const connectedUsers: Map<string, ConnectedUser> = new Map();

export const initializeSocket = (io: SocketIOServer) => {
  io.on("connection", (socket: Socket) => {
    console.log(`User connected: ${socket.id}`);

    // User joins with their profile
    socket.on("user:join", (user: any) => {
      connectedUsers.set(user.id, {
        id: user.id,
        name: user.name,
        socket,
      });
      console.log(`${user.name} joined. Total users: ${connectedUsers.size}`);

      // Broadcast presence
      io.emit("presence:update", {
        onlineUsers: Array.from(connectedUsers.values()).map((u) => ({
          id: u.id,
          name: u.name,
        })),
      });
    });

    // Handle messages
    socket.on("message:send", (message: any, callback) => {
      try {
        const messageId = `msg-${Date.now()}`;
        const enrichedMessage = {
          ...message,
          id: messageId,
          timestamp: new Date().toISOString(),
        };

        console.log(`Message from ${message.userId}: ${message.content}`);

        // Broadcast to all clients
        io.emit("message:new", enrichedMessage);

        // Acknowledge with server-generated ID
        if (callback) {
          callback({
            success: true,
            id: messageId,
          });
        }
      } catch (error: any) {
        console.error("Error sending message:", error);
        if (callback) {
          callback({
            error: error.message,
          });
        }
      }
    });

    // Handle typing indicator
    socket.on("user:typing", (data: any) => {
      const user = connectedUsers.get(data.userId);
      if (user) {
        socket.broadcast.emit("user:typing", {
          userId: data.userId,
          userName: user.name,
          channel: data.channel,
        });
      }
    });

    // Handle typing stopped
    socket.on("user:typing:stop", (data: any) => {
      socket.broadcast.emit("user:typing:stop", {
        userId: data.userId,
      });
    });

    // Handle disconnect
    socket.on("disconnect", () => {
      // Find and remove user
      for (const [userId, user] of connectedUsers.entries()) {
        if (user.socket.id === socket.id) {
          connectedUsers.delete(userId);
          console.log(`${user.name} disconnected. Total users: ${connectedUsers.size}`);

          // Broadcast updated presence
          io.emit("presence:update", {
            onlineUsers: Array.from(connectedUsers.values()).map((u) => ({
              id: u.id,
              name: u.name,
            })),
          });
          break;
        }
      }
    });
  });
};

export const getConnectedUsers = () => {
  return Array.from(connectedUsers.values()).map((u) => ({
    id: u.id,
    name: u.name,
  }));
};
