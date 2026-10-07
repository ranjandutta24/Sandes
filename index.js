const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const bcrypt = require("bcrypt");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// mongoose.connect("mongodb://127.0.0.1:27017/chatApp");
mongoose
  .connect("mongodb://127.0.0.1:27017/chatApp", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

const UserSchema = new mongoose.Schema({
  username: String,
  password: String, // hashed
});

const ChatSchema = new mongoose.Schema({
  sender: String,
  message: String,
  timestamp: { type: Date, default: Date.now },
});
const sessionMiddleware = session({
  secret: "supersecretkey",
  resave: false,
  saveUninitialized: false,
});
const User = mongoose.model("User", UserSchema);
const ChatMessage = mongoose.model("ChatMessage", ChatSchema);

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

  const user = await User.findOne({ username, password });
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
  const pastMessages = await ChatMessage.find().sort({ timestamp: 1 });
  socket.emit("past messages", pastMessages);

  // Handle new message
  socket.on("chat message", async (data) => {
    const msg = new ChatMessage({
      sender: username,
      message: data,
    });
    const savedMsg = await msg.save();
    io.emit("chat message", savedMsg);
  });
});

server.listen(9000, () => {
  console.log("Server is running on http://localhost:9000");
});
