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
    console.log(user);
    if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
    } else {
        req.session.user = user;
        res.redirect("/");
        // return res.status(200).json({ user });
    }
});
app.post("/login_app", async (req, res) => {
    const { username, password } = req.body;

    const { rows } = await pool.query(
        "SELECT id, username FROM users WHERE username = $1 AND password = $2",
        [username, password],
    );
    const user = rows[0];
    console.log(user);
    if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
    } else {
        req.session.user = user;
        // res.redirect("/");
        return res.status(200).json({ user });
    }
});

// Logout
app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/login");
    });
});

// Socket.io with authentication
io.use((socket, next) => {
    const username = socket.handshake.auth.username;
    if (username) {
        socket.username = username;
        next();
    } else {
        next(new Error("Unauthorized"));
    }
});

io.on("connection", async (socket) => {
    // const username = socket.request.session.user.username;
    const username = socket.username;

    // Send past messages
    const { rows: pastMessages } = await pool.query(
        'SELECT id, sender, message, created_at AS "timestamp" FROM chat_messages ORDER BY created_at ASC',
    );
    socket.emit("past messages", pastMessages);

    // Handle new message
    socket.on("chat message", async (data) => {
        try {
            const { rows } = await pool.query(
                'INSERT INTO chat_messages (sender, message) VALUES ($1, $2) RETURNING id, sender, message, created_at AS "timestamp"',
                [data.sender, data.message],
            );
            const savedMsg = rows[0];
            io.emit("chat message", savedMsg);
        } catch (err) {
            console.error("Error saving message:", err);
            socket.emit("error", "Server error occurred");
        }
    });
});

server.listen(9000, () => {
    console.log("Server is running on http://localhost:9000");
});
