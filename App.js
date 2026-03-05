import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import axios from "axios";

const SERVER_URL = process.env.REACT_APP_SERVER_URL || "http://localhost:5000";
const ROOMS  = ["general", "tech-talk", "random", "design", "announcements"];
const COLORS = ["#FF6B6B","#FFD93D","#6BCB77","#4D96FF","#FF922B","#CC5DE8","#20C997","#F06595"];

// ── Socket singleton ──────────────────────────────────────────────
let socket;
function getSocket() {
  if (!socket) socket = io(SERVER_URL, { transports: ["websocket"] });
  return socket;
}

// ── Helpers ───────────────────────────────────────────────────────
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── useChat hook ──────────────────────────────────────────────────
function useChat(user, activeRoom) {
  const [messages,    setMessages]    = useState([]);
  const [roomUsers,   setRoomUsers]   = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [connected,   setConnected]   = useState(false);

  useEffect(() => {
    if (!user || !activeRoom) return;
    const s = getSocket();

    const onConnect    = ()     => setConnected(true);
    const onDisconnect = ()     => setConnected(false);
    const onMessage    = (msg)  => setMessages((prev) => [...prev, msg]);
    const onRoomUsers  = (list) => setRoomUsers(list);
    const onTyping     = ({ userName, typing }) =>
      setTypingUsers((prev) =>
        typing
          ? [...new Set([...prev, userName])]
          : prev.filter((n) => n !== userName)
      );

    s.on("connect",         onConnect);
    s.on("disconnect",      onDisconnect);
    s.on("receive_message", onMessage);
    s.on("room_users",      onRoomUsers);
    s.on("user_typing",     onTyping);
    s.emit("join_room", { room: activeRoom, user });

    setConnected(s.connected);

    return () => {
      s.emit("leave_room", { room: activeRoom });
      s.off("connect",         onConnect);
      s.off("disconnect",      onDisconnect);
      s.off("receive_message", onMessage);
      s.off("room_users",      onRoomUsers);
      s.off("user_typing",     onTyping);
      setMessages([]);
      setRoomUsers([]);
      setTypingUsers([]);
    };
  }, [user, activeRoom]);

  // Load chat history when room changes
  useEffect(() => {
    if (!activeRoom) return;
    axios
      .get(`${SERVER_URL}/api/rooms/${activeRoom}/messages`)
      .then((r) => setMessages(r.data))
      .catch(() => {});
  }, [activeRoom]);

  const sendMessage = useCallback(
    (text) => {
      if (!text.trim() || !user) return;
      getSocket().emit("send_message", { room: activeRoom, user, text });
    },
    [activeRoom, user]
  );

  const sendTyping = useCallback(
    (typing) => {
      if (!user) return;
      getSocket().emit(typing ? "typing_start" : "typing_stop", {
        room: activeRoom,
        userName: user.name,
      });
    },
    [activeRoom, user]
  );

  return { messages, roomUsers, typingUsers, connected, sendMessage, sendTyping };
}

// ── Avatar ────────────────────────────────────────────────────────
function Avatar({ name, color, size = 36 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: color,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 700, fontSize: size * 0.42, color: "#0a0a0f",
      flexShrink: 0, fontFamily: "'Bebas Neue', cursive",
    }}>
      {name?.[0]?.toUpperCase()}
    </div>
  );
}

// ── Single Message ────────────────────────────────────────────────
function ChatMessage({ msg, isMe, sameUser }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: isMe ? "row-reverse" : "row",
      alignItems: "flex-end",
      gap: 8,
      padding: "2px 16px",
      marginTop: sameUser ? 0 : 12,
      animation: "fadeUp 0.2s ease",
    }}>
      {!sameUser
        ? <Avatar name={msg.userName} color={msg.userColor || "#4D96FF"} size={32} />
        : <div style={{ width: 32, flexShrink: 0 }} />
      }
      <div style={{
        display: "flex", flexDirection: "column",
        alignItems: isMe ? "flex-end" : "flex-start",
        maxWidth: "65%",
      }}>
        {!sameUser && (
          <div style={{
            fontSize: 11,
            color: msg.userColor || "#74C0FC",
            fontWeight: 600,
            marginBottom: 3,
            fontFamily: "'DM Mono', monospace",
          }}>
            {isMe ? "You" : msg.userName}
            <span style={{ color: "#4a4a6a", fontWeight: 400, marginLeft: 6 }}>
              {formatTime(msg.createdAt)}
            </span>
          </div>
        )}
        <div style={{
          background: isMe
            ? "linear-gradient(135deg, #1971c2 0%, #1864ab 100%)"
            : "#1a1a2e",
          color: isMe ? "#e8f4ff" : "#d0d0e8",
          padding: "9px 14px",
          borderRadius: isMe ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
          fontSize: 14,
          lineHeight: 1.5,
          border: isMe ? "none" : "1px solid #2a2a40",
          wordBreak: "break-word",
        }}>
          {msg.text}
        </div>
      </div>
    </div>
  );
}

// ── Typing Indicator ──────────────────────────────────────────────
function TypingIndicator({ users }) {
  if (!users.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 16px", opacity: 0.6 }}>
      <div style={{ display: "flex", gap: 3 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: "50%", background: "#74C0FC",
            animation: `bounce 1.2s ${i * 0.2}s ease-in-out infinite`,
          }} />
        ))}
      </div>
      <span style={{ fontSize: 12, color: "#74C0FC", fontFamily: "'DM Mono', monospace" }}>
        {users.join(", ")} {users.length === 1 ? "is" : "are"} typing...
      </span>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────
export default function App() {
  const [user,        setUser]        = useState(null);
  const [nameInput,   setNameInput]   = useState("");
  const [activeRoom,  setActiveRoom]  = useState("general");
  const [input,       setInput]       = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [unread,      setUnread]      = useState({});
  const [notification, setNotification] = useState(null);

  const inputRef      = useRef(null);
  const messagesEnd   = useRef(null);
  const typingTimeout = useRef(null);

  const { messages, roomUsers, typingUsers, connected, sendMessage, sendTyping } =
    useChat(user, activeRoom);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Register user via REST then connect socket
  const handleJoin = async () => {
    if (!nameInput.trim()) return;
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    try {
      const res = await axios.post(`${SERVER_URL}/api/users`, {
        name: nameInput.trim(),
        color,
      });
      setUser(res.data);
    } catch {
      // If server not available, create local user object
      setUser({ _id: Date.now().toString(), name: nameInput.trim(), color });
    }
  };

  const handleInput = (e) => {
    setInput(e.target.value);
    sendTyping(true);
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => sendTyping(false), 1500);
  };

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(input.trim());
    setInput("");
    sendTyping(false);
    inputRef.current?.focus();
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const switchRoom = (room) => {
    setActiveRoom(room);
    setUnread((prev) => ({ ...prev, [room]: 0 }));
    inputRef.current?.focus();
  };

  // Group consecutive messages from same user
  const grouped = messages.reduce((acc, msg, i) => {
    const prev     = messages[i - 1];
    const isMe     = msg.userName === user?.name;
    const sameUser =
      prev &&
      prev.userName === msg.userName &&
      new Date(msg.createdAt) - new Date(prev.createdAt) < 60000;
    acc.push({ ...msg, isMe, sameUser });
    return acc;
  }, []);

  // ── Login Screen ────────────────────────────────────────────────
  if (!user) {
    return (
      <>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #0a0a0f; }
          input:focus { outline: none !important; border-color: rgba(116,192,252,0.5) !important; box-shadow: 0 0 0 3px rgba(116,192,252,0.1) !important; }
          @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        `}</style>
        <div style={{
          minHeight: "100vh", background: "#0a0a0f",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "'DM Sans', sans-serif",
        }}>
          <div style={{
            background: "#0f0f1a",
            border: "1px solid #2a2a40",
            borderRadius: 20,
            padding: "48px 52px",
            textAlign: "center",
            width: 360,
            boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
          }}>
            <div style={{ fontSize: 56, marginBottom: 12, animation: "float 3s ease infinite" }}>⚡</div>
            <h1 style={{
              color: "#e8e8f0", fontSize: 32,
              fontFamily: "'Bebas Neue', cursive", letterSpacing: 3,
            }}>
              NEXUS CHAT
            </h1>
            <p style={{
              color: "#4a4a6a", fontSize: 12, margin: "8px 0 32px",
              fontFamily: "'DM Mono', monospace", letterSpacing: 1,
            }}>
              REAL-TIME · PERSISTENT · INSTANT
            </p>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="Enter your display name..."
              style={{
                width: "100%", background: "#16162a",
                border: "1px solid #2a2a40", borderRadius: 12,
                padding: "13px 16px", color: "#e8e8f0",
                fontSize: 14, fontFamily: "'DM Sans', sans-serif",
                marginBottom: 14, transition: "all 0.2s",
              }}
            />
            <button
              onClick={handleJoin}
              disabled={!nameInput.trim()}
              style={{
                width: "100%",
                background: nameInput.trim()
                  ? "linear-gradient(135deg, #1971c2 0%, #1864ab 100%)"
                  : "#1a1a2e",
                border: "none", borderRadius: 12, padding: "13px",
                color: nameInput.trim() ? "#fff" : "#4a4a6a",
                fontSize: 14, fontWeight: 600, cursor: nameInput.trim() ? "pointer" : "not-allowed",
                fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s",
                letterSpacing: 0.5,
              }}
            >
              Enter Chat →
            </button>
            <p style={{ color: "#2a2a4a", fontSize: 11, marginTop: 20, fontFamily: "'DM Mono', monospace" }}>
              MongoDB · Express · React · Node.js · Socket.io
            </p>
          </div>
        </div>
      </>
    );
  }

  // ── Chat UI ─────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0a0f; overflow: hidden; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 2px; }
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeUp { from{transform:translateY(6px);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes slideIn { from{transform:translateX(20px);opacity:0} to{transform:translateX(0);opacity:1} }
        .room-btn:hover  { background: rgba(116,192,252,0.08) !important; color: #aaccff !important; }
        .room-btn.active { background: rgba(116,192,252,0.14) !important; }
        .send-btn:hover  { background: #339af0 !important; transform: scale(1.04); }
        .send-btn:active { transform: scale(0.97); }
        input:focus      { outline: none; border-color: rgba(116,192,252,0.5) !important; box-shadow: 0 0 0 2px rgba(116,192,252,0.1); }
        .sidebar-toggle:hover { background: rgba(255,255,255,0.07) !important; }
      `}</style>

      <div style={{
        width: "100vw", height: "100vh",
        display: "flex", background: "#0a0a0f",
        fontFamily: "'DM Sans', sans-serif", color: "#e8e8f0", overflow: "hidden",
      }}>

        {/* ── Sidebar ── */}
        <div style={{
          width: sidebarOpen ? 230 : 0, minWidth: sidebarOpen ? 230 : 0,
          background: "#0f0f1a", borderRight: "1px solid #1e1e30",
          display: "flex", flexDirection: "column", overflow: "hidden",
          transition: "all 0.3s ease",
        }}>
          {/* Brand */}
          <div style={{ padding: "18px 16px 14px", borderBottom: "1px solid #1e1e30" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 9,
                background: "linear-gradient(135deg, #4D96FF 0%, #CC5DE8 100%)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
              }}>⚡</div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Bebas Neue', cursive", letterSpacing: 2 }}>
                  NEXUS
                </div>
                <div style={{ fontSize: 10, color: "#74C0FC", fontFamily: "'DM Mono', monospace", opacity: 0.7 }}>
                  real-time chat
                </div>
              </div>
            </div>
          </div>

          {/* Channels */}
          <div style={{ padding: "14px 8px 8px" }}>
            <div style={{
              fontSize: 10, color: "#4a4a6a",
              fontFamily: "'DM Mono', monospace", padding: "0 8px 8px", letterSpacing: 1,
            }}>CHANNELS</div>
            {ROOMS.map((room) => (
              <button
                key={room}
                className={`room-btn ${activeRoom === room ? "active" : ""}`}
                onClick={() => switchRoom(room)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: "transparent",
                  color: activeRoom === room ? "#74C0FC" : "#8888aa",
                  fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                  fontWeight: activeRoom === room ? 600 : 400,
                  marginBottom: 2, transition: "all 0.15s",
                }}
              >
                <span>#{room}</span>
                {unread[room] > 0 && (
                  <span style={{
                    background: "#4D96FF", color: "#fff",
                    borderRadius: 99, fontSize: 10, fontWeight: 700,
                    padding: "1px 6px", minWidth: 18, textAlign: "center",
                  }}>{unread[room]}</span>
                )}
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          {/* Online Users */}
          <div style={{ padding: "12px 8px 16px", borderTop: "1px solid #1e1e30" }}>
            <div style={{
              fontSize: 10, color: "#4a4a6a", fontFamily: "'DM Mono', monospace",
              padding: "0 8px 8px", letterSpacing: 1,
            }}>
              ONLINE — {roomUsers.length}
            </div>
            {roomUsers.map((u, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 8px", borderRadius: 8,
              }}>
                <div style={{ position: "relative" }}>
                  <Avatar name={u.name} color={u.color} size={28} />
                  <div style={{
                    position: "absolute", bottom: 0, right: 0,
                    width: 8, height: 8, borderRadius: "50%",
                    background: "#6BCB77", border: "2px solid #0f0f1a",
                  }} />
                </div>
                <span style={{ fontSize: 13, color: "#c0c0d8", fontWeight: 500 }}>{u.name}</span>
                {u.name === user.name && (
                  <span style={{ fontSize: 9, color: "#4a4a6a", marginLeft: "auto", fontFamily: "'DM Mono', monospace" }}>
                    you
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Main Chat Area ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

          {/* Header */}
          <div style={{
            background: "#0f0f1a", borderBottom: "1px solid #1e1e30",
            padding: "14px 20px", display: "flex", alignItems: "center", gap: 12,
          }}>
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarOpen((s) => !s)}
              style={{
                background: "transparent", border: "none", color: "#8888aa",
                cursor: "pointer", padding: "5px 7px", borderRadius: 7,
                fontSize: 17, transition: "background 0.15s",
              }}
            >☰</button>

            <div>
              <div style={{ fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ color: "#74C0FC", fontFamily: "'DM Mono', monospace" }}>#</span>
                {activeRoom}
              </div>
              <div style={{ fontSize: 11, color: "#4a4a6a", fontFamily: "'DM Mono', monospace" }}>
                {messages.length} messages
              </div>
            </div>

            <div style={{ flex: 1 }} />

            {/* Connection status */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                background: connected ? "#6BCB77" : "#FF6B6B",
                animation: "pulse 2s ease infinite",
              }} />
              <span style={{
                fontSize: 11, fontFamily: "'DM Mono', monospace",
                color: connected ? "#6BCB77" : "#FF6B6B",
              }}>
                {connected ? "LIVE" : "OFFLINE"}
              </span>
            </div>

            {/* Current user */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Avatar name={user.name} color={user.color} size={30} />
              <span style={{ fontSize: 13, fontWeight: 600, color: user.color }}>{user.name}</span>
            </div>
          </div>

          {/* Messages List */}
          <div style={{
            flex: 1, overflowY: "auto", padding: "16px 0 4px",
            display: "flex", flexDirection: "column", gap: 2,
          }}>
            {grouped.length === 0 && (
              <div style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                flexDirection: "column", gap: 12, opacity: 0.35,
              }}>
                <div style={{ fontSize: 40 }}>💬</div>
                <div style={{ fontSize: 13, fontFamily: "'DM Mono', monospace" }}>
                  No messages yet — start the conversation!
                </div>
              </div>
            )}
            {grouped.map((msg, i) => (
              <ChatMessage key={msg._id || i} msg={msg} isMe={msg.isMe} sameUser={msg.sameUser} />
            ))}
            <TypingIndicator users={typingUsers} />
            <div ref={messagesEnd} />
          </div>

          {/* Message Input */}
          <div style={{
            padding: "12px 16px 16px",
            borderTop: "1px solid #1e1e30",
            background: "#0f0f1a",
          }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                ref={inputRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKey}
                placeholder={`Message #${activeRoom}...`}
                style={{
                  flex: 1, background: "#16162a", border: "1px solid #2a2a40",
                  borderRadius: 12, padding: "11px 16px",
                  color: "#e8e8f0", fontSize: 14,
                  fontFamily: "'DM Sans', sans-serif",
                  transition: "border-color 0.2s, box-shadow 0.2s",
                }}
              />
              <button
                className="send-btn"
                onClick={handleSend}
                style={{
                  background: "#1971c2", border: "none", borderRadius: 10,
                  width: 44, height: 44, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, transition: "all 0.15s", flexShrink: 0,
                }}
              >➤</button>
            </div>
            <div style={{
              display: "flex", gap: 16, marginTop: 7, paddingLeft: 2,
              fontSize: 11, color: "#2a2a4a", fontFamily: "'DM Mono', monospace",
            }}>
              <span>↵ send</span>
              <span>shift+↵ newline</span>
              <span style={{ marginLeft: "auto" }}>Socket.io · MongoDB · Express · React</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
