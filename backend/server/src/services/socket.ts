import { Server as SocketIOServer, Socket } from "socket.io";
import { userFromToken } from "../middleware/auth";
import { User } from "../users";

interface ConnectedUser {
  id: string;
  name: string;
  socket: Socket;
}

const connectedUsers: Map<string, ConnectedUser> = new Map();

// Every open socket per user id, so revoking a session (deactivation, role
// change, password change or reset) can close that user's live connections.
// The handshake checks the token only once; without this an open socket
// would keep receiving events after the user's access was revoked.
const socketsByUser: Map<number, Set<Socket>> = new Map();

export function disconnectUser(userId: number): number {
  const sockets = socketsByUser.get(userId);
  if (!sockets) return 0;
  const count = sockets.size;
  for (const s of Array.from(sockets)) s.disconnect(true);
  return count;
}

function presence() {
  return {
    onlineUsers: Array.from(connectedUsers.values()).map((u) => ({ id: u.id, name: u.name })),
  };
}

export const initializeSocket = (io: SocketIOServer) => {
  // Every connection must present a valid token (handshake auth: { token }).
  // Accounts with a pending password change can't connect until they change it.
  io.use((socket, next) => {
    const user = userFromToken((socket.handshake.auth as { token?: string } | undefined)?.token);
    if (!user) return next(new Error("Authentication required"));
    if (user.mustChangePassword) return next(new Error("Password change required"));
    socket.data.user = user;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const me = socket.data.user as User;
    console.log(`User connected: ${me.email} (${socket.id})`);

    if (!socketsByUser.has(me.id)) socketsByUser.set(me.id, new Set());
    socketsByUser.get(me.id)!.add(socket);

    // Presence uses the signed-in identity, never what the client claims
    socket.on("user:join", () => {
      connectedUsers.set(String(me.id), { id: String(me.id), name: me.name, socket });
      console.log(`${me.name} joined. Total users: ${connectedUsers.size}`);
      io.emit("presence:update", presence());
    });

    socket.on("message:send", (message: any, callback) => {
      try {
        if (me.role === "viewer") throw new Error("Insufficient permissions");
        const messageId = `msg-${Date.now()}`;
        const enrichedMessage = {
          ...message,
          // Sender fields come from the session, overriding anything sent
          userId: String(me.id),
          userName: me.name,
          id: messageId,
          timestamp: new Date().toISOString(),
        };
        io.emit("message:new", enrichedMessage);
        if (callback) callback({ success: true, id: messageId });
      } catch (error: any) {
        if (callback) callback({ error: error.message });
      }
    });

    socket.on("user:typing", (data: any) => {
      socket.broadcast.emit("user:typing", { userId: String(me.id), userName: me.name, channel: data?.channel });
    });

    socket.on("user:typing:stop", () => {
      socket.broadcast.emit("user:typing:stop", { userId: String(me.id) });
    });

    socket.on("disconnect", () => {
      const mine = socketsByUser.get(me.id);
      mine?.delete(socket);
      if (mine && mine.size === 0) socketsByUser.delete(me.id);

      const entry = connectedUsers.get(String(me.id));
      if (entry && entry.socket.id === socket.id) {
        connectedUsers.delete(String(me.id));
        console.log(`${me.name} disconnected. Total users: ${connectedUsers.size}`);
        io.emit("presence:update", presence());
      }
    });
  });
};

export const getConnectedUsers = () => presence().onlineUsers;
