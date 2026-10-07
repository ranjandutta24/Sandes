const express = require("express");
const pool = require("./db");
const session = require("express-session");
const bcrypt = require("bcrypt");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const sessionMiddleware = session({
  secret: "supersecretkey",
  resave: false,
  saveUninitialized: false,
});

// Session middleware
app.use(sessionMiddleware);
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Login route
app.get("/", (req, res) => {
  if (req.session.user) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  } else {
    res.redirect("/login");
  }
});

// Login page
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Handle login
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const { rows } = await pool.query(
    "SELECT id, username FROM users WHERE username = $1 AND password = $2",
    [username, password],
  );
  const user = rows[0];
  if (!user) return res.send("Invalid credentials");

  // const valid = await bcrypt.compare(password, user.password);
  // if (!valid) return res.send("Invalid credentials");

  req.session.user = user;
  res.redirect("/");
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// Socket.io with authentication
io.use((socket, next) => {
  const req = socket.request;
  if (req.session && req.session.user) {
    next();
  } else {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", async (socket) => {
  const username = socket.request.session.user.username;

  // Send past messages
  const { rows: pastMessages } = await pool.query(
    'SELECT id, sender, message, created_at AS "timestamp" FROM chat_messages ORDER BY created_at ASC',
  );
  socket.emit("past messages", pastMessages);

  // Handle new message
  socket.on("chat message", async (data) => {
    const { rows } = await pool.query(
      'INSERT INTO chat_messages (sender, message) VALUES ($1, $2) RETURNING id, sender, message, created_at AS "timestamp"',
      [username, data],
    );
    const savedMsg = rows[0];
    io.emit("chat message", savedMsg);
  });
});

server.listen(9000, () => {
  console.log("Server is running on http://localhost:9000");
});
