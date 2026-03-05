const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const mongoose   = require("mongoose");
const cors       = require("cors");
const dotenv     = require("dotenv");
const path       = require("path");

dotenv.config();

// ── App Setup ─────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// ── MongoDB Connection ────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI || "mongodb://localhost:27017/nexus-chat")
  .then(() => console.log("✅  MongoDB connected"))
  .catch((err) => console.error("❌  MongoDB error:", err));

// ── Mongoose Schemas ──────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  color:     { type: String, default: "#4D96FF" },
  socketId:  String,
  createdAt: { type: Date, default: Date.now },
});

const messageSchema = new mongoose.Schema({
  room:      { type: String, required: true, index: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  userName:  String,
  userColor: String,
  text:      { type: String, required: true },
  createdAt: { type: Date, default: Date.now, index: true },
});

const User    = mongoose.model("User",    userSchema);
const Message = mongoose.model("Message", messageSchema);

// ── REST Routes ───────────────────────────────────────────────────

// Get last 50 messages for a room
app.get("/api/rooms/:room/messages", async (req, res) => {
  try {
    const msgs = await Message.find({ room: req.params.room })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json(msgs.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all rooms
app.get("/api/rooms", (_req, res) => {
  res.json(["general", "tech-talk", "random", "design", "announcements"]);
});

// Register or find a user
app.post("/api/users", async (req, res) => {
  try {
    const { name, color } = req.body;
    const user = await User.findOneAndUpdate(
      { name },
      { name, color },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve React build in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/build")));
  app.get("*", (_req, res) =>
    res.sendFile(path.join(__dirname, "../client/build/index.html"))
  );
}

// ── Socket.io Real-Time Logic ─────────────────────────────────────
const roomUsers = {}; // { roomName: Map<socketId, userObject> }

io.on("connection", (socket) => {
  console.log(`🔌  Socket connected: ${socket.id}`);

  // User joins a room
  socket.on("join_room", async ({ room, user }) => {
    socket.join(room);
    socket.data.room = room;
    socket.data.user = user;

    if (!roomUsers[room]) roomUsers[room] = new Map();
    roomUsers[room].set(socket.id, user);

    // Send updated user list to everyone in the room
    io.to(room).emit("room_users", [...roomUsers[room].values()]);

    // Announce join
    io.to(room).emit("system_message", {
      type: "join",
      text: `${user.name} joined #${room}`,
      ts:   Date.now(),
    });

    console.log(`👤  ${user.name} joined #${room}`);
  });

  // User sends a message
  socket.on("send_message", async ({ room, user, text }) => {
    if (!text?.trim()) return;

    // Save to MongoDB
    const msg = await Message.create({
      room,
      userId:    user._id,
      userName:  user.name,
      userColor: user.color,
      text:      text.trim(),
    });

    // Broadcast to everyone in the room
    io.to(room).emit("receive_message", {
      _id:       msg._id,
      room,
      userId:    user._id,
      userName:  user.name,
      userColor: user.color,
      text:      msg.text,
      createdAt: msg.createdAt,
    });
  });

  // Typing events
  socket.on("typing_start", ({ room, userName }) => {
    socket.to(room).emit("user_typing", { userName, typing: true });
  });
  socket.on("typing_stop", ({ room, userName }) => {
    socket.to(room).emit("user_typing", { userName, typing: false });
  });

  // User leaves a room manually
  socket.on("leave_room", ({ room }) => leaveRoom(socket, room));

  // User disconnects
  socket.on("disconnect", () => {
    if (socket.data.room) leaveRoom(socket, socket.data.room);
    console.log(`🔌  Socket disconnected: ${socket.id}`);
  });
});

function leaveRoom(socket, room) {
  const user = socket.data.user;
  if (roomUsers[room]) {
    roomUsers[room].delete(socket.id);
    io.to(room).emit("room_users", [...roomUsers[room].values()]);
  }
  if (user) {
    io.to(room).emit("system_message", {
      type: "leave",
      text: `${user.name} left #${room}`,
      ts:   Date.now(),
    });
  }
  socket.leave(room);
}

// ── Start Server ──────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀  Server running at http://localhost:${PORT}`);
});
