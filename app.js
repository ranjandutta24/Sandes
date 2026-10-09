const express = require("express");
const pool = require("./db");
const session = require("express-session");
const bcrypt = require("bcrypt");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
// Big uploads can take a while: don't cut off slow requests (Node defaults to 5 min)
server.requestTimeout = 0;
server.timeout = 0;
const io = new Server(server);

// ------------------------------------------------------------------
// Attachments: stored on disk in ./uploads with random names
// ------------------------------------------------------------------
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// No file-size limit (LAN use). Only the number of files per message is capped.
const MAX_FILES = 20;

const upload = multer({
    storage: multer.diskStorage({
        destination: UPLOAD_DIR,
        filename: (req, file, cb) =>
            cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
    }),
    limits: { files: MAX_FILES },
});

// ------------------------------------------------------------------
// Middleware
// ------------------------------------------------------------------
const sessionMiddleware = session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false,
});

app.use(sessionMiddleware);
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function requireUser(req, res, next) {
    if (!req.session.user) return res.status(401).json({ message: "Not signed in" });
    next();
}

// ------------------------------------------------------------------
// Data helpers
// ------------------------------------------------------------------
let MAIN_ROOM_ID = null;

const MESSAGE_SELECT = `
    SELECT m.id, m.conversation_id, m.sender, m.sender_id, m.message,
           m.created_at AS "timestamp",
           COALESCE(
               json_agg(json_build_object(
                   'id', a.id, 'file_name', a.file_name,
                   'mime_type', a.mime_type, 'size_bytes', a.size_bytes,
                   'url', '/attachments/' || a.id
               ) ORDER BY a.id) FILTER (WHERE a.id IS NOT NULL),
               '[]'
           ) AS attachments
    FROM chat_messages m
    LEFT JOIN attachments a ON a.message_id = m.id`;

async function getMessage(id) {
    const { rows } = await pool.query(`${MESSAGE_SELECT} WHERE m.id = $1 GROUP BY m.id`, [id]);
    return rows[0];
}

async function getHistory(conversationId, limit = 200) {
    const { rows } = await pool.query(
        `SELECT * FROM (
             ${MESSAGE_SELECT} WHERE m.conversation_id = $1
             GROUP BY m.id ORDER BY m.created_at DESC LIMIT $2
         ) t ORDER BY "timestamp" ASC`,
        [conversationId, limit],
    );
    return rows;
}

async function canAccess(userId, conversationId) {
    const { rows } = await pool.query(
        `SELECT 1 FROM conversations c
         WHERE c.id = $1 AND (
             c.is_public OR EXISTS (
                 SELECT 1 FROM conversation_members cm
                 WHERE cm.conversation_id = c.id AND cm.user_id = $2
             )
         )`,
        [conversationId, userId],
    );
    return rows.length > 0;
}

async function findUserByName(username) {
    const { rows } = await pool.query("SELECT id, username FROM users WHERE username = $1", [username]);
    return rows[0];
}

/** Save a message (+ optional uploaded files) and broadcast it. */
async function createMessage({ conversationId, user, senderName, text, files = [] }) {
    const client = await pool.connect();
    let messageId;
    try {
        await client.query("BEGIN");
        const { rows } = await client.query(
            `INSERT INTO chat_messages (conversation_id, sender, sender_id, message)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [conversationId, senderName || user.username, user.id, text || null],
        );
        messageId = rows[0].id;
        for (const f of files) {
            await client.query(
                `INSERT INTO attachments (message_id, file_name, stored_name, mime_type, size_bytes)
                 VALUES ($1, $2, $3, $4, $5)`,
                [messageId, f.originalname, f.filename, f.mimetype || "application/octet-stream", f.size],
            );
        }
        await client.query("COMMIT");
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }

    const msg = await getMessage(messageId);
    io.to(`conv:${conversationId}`).emit("message", msg);
    // Legacy event for older clients (mobile app) that only know the main room
    if (conversationId === MAIN_ROOM_ID) io.emit("chat message", msg);
    return msg;
}

function removeFiles(files = []) {
    for (const f of files) fs.unlink(f.path, () => {});
}

// ------------------------------------------------------------------
// Pages & auth
// ------------------------------------------------------------------
app.get("/", (req, res) => {
    if (req.session.user) {
        res.sendFile(path.join(__dirname, "public", "index.html"));
    } else {
        res.redirect("/login");
    }
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const { rows } = await pool.query(
        "SELECT id, username FROM users WHERE username = $1 AND password = $2",
        [username, password],
    );
    const user = rows[0];
    if (!user) return res.redirect("/login?error=1");
    req.session.user = user;
    res.redirect("/");
});

app.post("/login_app", async (req, res) => {
    const { username, password } = req.body;
    const { rows } = await pool.query(
        "SELECT id, username FROM users WHERE username = $1 AND password = $2",
        [username, password],
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ message: "Invalid credentials" });
    req.session.user = user;
    return res.status(200).json({ user });
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/login"));
});

app.get("/me", requireUser, (req, res) => {
    res.json({ id: req.session.user.id, username: req.session.user.username });
});

// ------------------------------------------------------------------
// API: users & conversations
// ------------------------------------------------------------------

// Everyone you can start a direct chat with
app.get("/api/users", requireUser, async (req, res) => {
    const { rows } = await pool.query(
        "SELECT id, username FROM users WHERE id <> $1 ORDER BY username",
        [req.session.user.id],
    );
    res.json(rows);
});

// Main room + your direct chats, most recent first
app.get("/api/conversations", requireUser, async (req, res) => {
    const me = req.session.user.id;
    const { rows } = await pool.query(
        `SELECT c.id, c.type,
                CASE WHEN c.type = 'direct' THEN other.username ELSE c.name END AS name,
                other.id AS other_user_id,
                c.slug,
                last.message AS last_message,
                last.has_attachments AS last_has_attachments,
                last.sender AS last_sender,
                COALESCE(last.created_at, c.created_at) AS last_activity
         FROM conversations c
         LEFT JOIN LATERAL (
             SELECT u.id, u.username FROM conversation_members cm
             JOIN users u ON u.id = cm.user_id
             WHERE cm.conversation_id = c.id AND cm.user_id <> $1
             LIMIT 1
         ) other ON c.type = 'direct'
         LEFT JOIN LATERAL (
             SELECT m.message, m.sender, m.created_at,
                    EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id) AS has_attachments
             FROM chat_messages m WHERE m.conversation_id = c.id
             ORDER BY m.created_at DESC LIMIT 1
         ) last ON TRUE
         WHERE c.is_public
            OR EXISTS (SELECT 1 FROM conversation_members cm
                       WHERE cm.conversation_id = c.id AND cm.user_id = $1)
         ORDER BY (c.slug = 'main') DESC NULLS LAST, last_activity DESC`,
        [me],
    );
    res.json(rows);
});

// Open (or create) a direct chat with another user
app.post("/api/conversations/direct", requireUser, async (req, res) => {
    const me = req.session.user.id;
    const other = Number(req.body.userId);
    if (!other || other === me) return res.status(400).json({ message: "Choose someone else to message" });

    const { rows: users } = await pool.query("SELECT id, username FROM users WHERE id = $1", [other]);
    if (!users[0]) return res.status(404).json({ message: "That user doesn't exist" });

    const key = `${Math.min(me, other)}:${Math.max(me, other)}`;
    const client = await pool.connect();
    let conversationId;
    try {
        await client.query("BEGIN");
        const { rows } = await client.query(
            `INSERT INTO conversations (type, direct_key, created_by)
             VALUES ('direct', $1, $2)
             ON CONFLICT (direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key
             RETURNING id`,
            [key, me],
        );
        conversationId = rows[0].id;
        await client.query(
            `INSERT INTO conversation_members (conversation_id, user_id)
             VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING`,
            [conversationId, me, other],
        );
        await client.query("COMMIT");
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }

    // Make both users' open sockets join the new chat
    io.in(`user:${me}`).socketsJoin(`conv:${conversationId}`);
    io.in(`user:${other}`).socketsJoin(`conv:${conversationId}`);

    res.json({ id: conversationId, type: "direct", name: users[0].username, other_user_id: other });
});

app.get("/api/conversations/:id/messages", requireUser, async (req, res) => {
    const id = Number(req.params.id);
    if (!(await canAccess(req.session.user.id, id))) {
        return res.status(403).json({ message: "You're not part of this conversation" });
    }
    res.json(await getHistory(id));
});

// Send a message with attachments (multipart/form-data: message, files[])
app.post("/api/conversations/:id/messages", requireUser, (req, res) => {
    upload.array("files", MAX_FILES)(req, res, async (err) => {
        const files = req.files || [];
        if (err) {
            removeFiles(files);
            const message =
                err.code === "LIMIT_FILE_COUNT"
                      ? `You can attach up to ${MAX_FILES} files at once`
                      : "Upload failed";
            return res.status(400).json({ message });
        }
        try {
            const id = Number(req.params.id);
            if (!(await canAccess(req.session.user.id, id))) {
                removeFiles(files);
                return res.status(403).json({ message: "You're not part of this conversation" });
            }
            const text = (req.body.message || "").trim();
            if (!text && files.length === 0) {
                return res.status(400).json({ message: "Write a message or attach a file" });
            }
            const msg = await createMessage({ conversationId: id, user: req.session.user, text, files });
            res.status(201).json(msg);
        } catch (e) {
            removeFiles(files);
            console.error("Error saving message:", e);
            res.status(500).json({ message: "Message not sent. Try again." });
        }
    });
});

// Download / view an attachment (only for people in that conversation)
app.get("/attachments/:id", requireUser, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT a.file_name, a.stored_name, a.mime_type, m.conversation_id
         FROM attachments a JOIN chat_messages m ON m.id = a.message_id
         WHERE a.id = $1`,
        [Number(req.params.id)],
    );
    const a = rows[0];
    if (!a || !(await canAccess(req.session.user.id, a.conversation_id))) {
        return res.status(404).send("File not found");
    }
    // Only show safe types inline; SVG/HTML etc. always download (they can contain scripts)
    const inline =
        (/^(image|video|audio)\//.test(a.mime_type) && a.mime_type !== "image/svg+xml") ||
        a.mime_type === "application/pdf";
    res.setHeader("Content-Type", a.mime_type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
        "Content-Disposition",
        `${inline && !req.query.download ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.file_name)}`,
    );
    res.sendFile(path.join(UPLOAD_DIR, a.stored_name), (err) => {
        // File deleted from disk (or download aborted) - answer cleanly instead of crashing the request
        if (err && !res.headersSent) res.status(404).send("File not found");
    });
});

// ------------------------------------------------------------------
// Crackers (Diwali fun). Live events only, nothing is stored.
//   cracker:place  -> someone puts a cracker down in a conversation
//   cracker:stick  -> where their dhoop kathi (incense stick) is
//   cracker:ignite -> fuse lit, everyone plays the blast
//   cracker:remove -> cancelled (or the user disconnected)
//   cracker:throw  -> rosun bomb thrown at a spot (no fuse, bursts on landing)
// A lit phuljhuri (sparkler) keeps sending cracker:stick while it's waved around.
// ------------------------------------------------------------------
const CRACKER_KINDS = new Set([
    "kalipotka", "bomb", "dodoma", "ladi", "rocket", "skyshot", "udan",
    "anar", "chakri", "phuljhuri", "mashal", "saap",
]);
const THROWN_KINDS = new Set(["rosun"]);
const HELD_KINDS = new Set(["phuljhuri"]);
const HELD_MS = 9000;
const MAX_UNLIT_CRACKERS = 3;
const CRACKER_ID = /^[a-f0-9]{8,32}$/i;
const unit = (n) => Math.min(1, Math.max(0, Number(n) || 0));

function registerCrackers(socket) {
    const user = socket.user;
    const unlit = new Map(); // cracker id -> { conv, kind }
    const held = new Map();  // lit phuljhuri id -> conversation id
    let lastThrow = 0;

    socket.on("cracker:place", async (d) => {
        try {
            if (!d || !CRACKER_KINDS.has(d.kind) || !CRACKER_ID.test(String(d.id))) return;
            if (unlit.size >= MAX_UNLIT_CRACKERS || unlit.has(d.id)) return;
            const conversationId = Number(d.conversationId);
            if (boardIsOn(conversationId)) return; // no crackers while the board is open
            if (!(await canAccess(user.id, conversationId))) return;
            unlit.set(d.id, { conv: conversationId, kind: d.kind });
            socket.to(`conv:${conversationId}`).emit("cracker:place", {
                id: d.id, kind: d.kind, x: unit(d.x), y: unit(d.y), conversationId, by: user.username,
            });
        } catch (err) {
            console.error("cracker:place", err);
        }
    });

    socket.on("cracker:throw", async (d) => {
        try {
            if (!d || !THROWN_KINDS.has(d.kind) || !CRACKER_ID.test(String(d.id))) return;
            const t = Date.now();
            if (t - lastThrow < 250) return;
            lastThrow = t;
            const conversationId = Number(d.conversationId);
            if (boardIsOn(conversationId)) return;
            if (!(await canAccess(user.id, conversationId))) return;
            socket.to(`conv:${conversationId}`).emit("cracker:throw", {
                id: d.id, kind: d.kind, x: unit(d.x), y: unit(d.y), conversationId, by: user.username,
            });
        } catch (err) {
            console.error("cracker:throw", err);
        }
    });

    socket.on("cracker:stick", (d) => {
        if (!d) return;
        const conv = unlit.get(d.id)?.conv ?? held.get(d.id);
        if (!conv) return;
        socket.volatile.to(`conv:${conv}`).emit("cracker:stick", { id: d.id, x: unit(d.x), y: unit(d.y), by: user.username });
    });

    const finish = (event) => (d) => {
        const entry = d && unlit.get(d.id);
        if (!entry) return;
        unlit.delete(d.id);
        // the board opened while this one was waiting: everyone already cleared it, just drop it
        if (event === "cracker:ignite" && boardIsOn(entry.conv)) return;
        if (event === "cracker:ignite" && HELD_KINDS.has(entry.kind)) {
            held.set(d.id, entry.conv);
            setTimeout(() => held.delete(d.id), HELD_MS);
        }
        socket.to(`conv:${entry.conv}`).emit(event, { id: d.id });
    };
    socket.on("cracker:ignite", finish("cracker:ignite"));
    socket.on("cracker:remove", finish("cracker:remove"));

    socket.on("disconnect", () => {
        for (const [id, { conv }] of unlit) socket.to(`conv:${conv}`).emit("cracker:remove", { id });
        held.clear();
    });
}

// ------------------------------------------------------------------
// Shared drawing board (one per conversation, saved in board_items).
//   board:status {conversationId}        -> ack { viewers }      (is anyone on the board?)
//   board:join   {conversationId}        -> ack { items, viewers }
//   board:leave  {conversationId}
//   board:add    {conversationId, item}  -> saved, sent to everyone on the board
//   board:remove {conversationId, ids}   -> erased / undone
//   board:clear  {conversationId}
//   board:live   {conversationId, x, y, d} -> cursor + shape being drawn (not saved)
//   board:presence {conversationId, viewers} goes to every member of the chat, so they
//   can see the board is open. While anyone is on it, crackers are off in that chat.
// ------------------------------------------------------------------
const BOARD_W = 1600;
const BOARD_H = 1000;
const BOARD_MAX_ITEMS = 5000;
const BOARD_ITEM_ID = /^[a-f0-9]{8,32}$/i;
const BOARD_POINTS = { pen: [2, 8000], line: [4, 4], arrow: [4, 4], rect: [4, 4], ellipse: [4, 4], text: [2, 2] };
const boardViewers = new Map(); // conversation id -> Map(socket id -> username)

const boardIsOn = (conversationId) => (boardViewers.get(conversationId)?.size || 0) > 0;
const viewerNames = (conversationId) => [...new Set((boardViewers.get(conversationId) || new Map()).values())];

function cleanBoardItem(it) {
    if (!it || typeof it !== "object" || !BOARD_ITEM_ID.test(String(it.id))) return null;
    const range = BOARD_POINTS[it.t];
    if (!range || typeof it.c !== "string" || !/^#[0-9a-f]{6}$/i.test(it.c)) return null;
    const w = Number(it.w);
    if (!Number.isFinite(w) || w < 1 || w > 40) return null;
    if (!Array.isArray(it.p) || it.p.length < range[0] || it.p.length > range[1] || it.p.length % 2) return null;
    const p = [];
    for (const v of it.p) {
        const n = Number(v);
        if (!Number.isFinite(n)) return null;
        p.push(Math.round(Math.min(BOARD_W * 2, Math.max(-BOARD_W, n)) * 10) / 10);
    }
    const out = { t: it.t, c: it.c.toLowerCase(), w, p };
    if (it.t === "text") {
        const s = typeof it.s === "string" ? it.s.trim().slice(0, 1000) : "";
        if (!s) return null;
        out.s = s;
    }
    if ((it.t === "rect" || it.t === "ellipse") && it.f) out.f = true;
    return { id: String(it.id), data: out };
}

function sendPresence(conversationId) {
    io.to(`conv:${conversationId}`).emit("board:presence", { conversationId, viewers: viewerNames(conversationId) });
}

function registerBoard(socket) {
    const user = socket.user;
    const joined = new Set(); // conversation ids this socket has the board open for
    let bucket = 40, refill = Date.now(); // rate limit for saved changes

    const allow = () => {
        const t = Date.now();
        bucket = Math.min(40, bucket + ((t - refill) / 1000) * 20);
        refill = t;
        if (bucket < 1) return false;
        bucket -= 1;
        return true;
    };
    const ack = (cb, v) => typeof cb === "function" && cb(v);
    const onBoard = (d) => {
        const id = Number(d && d.conversationId);
        return joined.has(id) ? id : null;
    };

    function leave(conversationId) {
        if (!joined.delete(conversationId)) return;
        socket.leave(`board:${conversationId}`);
        const viewers = boardViewers.get(conversationId);
        if (viewers) {
            viewers.delete(socket.id);
            if (!viewers.size) boardViewers.delete(conversationId);
        }
        socket.to(`board:${conversationId}`).emit("board:live", { conversationId, sid: socket.id, gone: true });
        sendPresence(conversationId);
    }

    socket.on("board:status", async (d, cb) => {
        try {
            const id = Number(d && d.conversationId);
            if (!(await canAccess(user.id, id))) return ack(cb, { viewers: [] });
            ack(cb, { viewers: viewerNames(id) });
        } catch (err) {
            console.error("board:status", err);
            ack(cb, { viewers: [] });
        }
    });

    socket.on("board:join", async (d, cb) => {
        try {
            const id = Number(d && d.conversationId);
            if (!(await canAccess(user.id, id))) return ack(cb, { error: "You're not part of this conversation" });
            const { rows } = await pool.query(
                `SELECT b.item_key AS id, b.data, u.username AS by
                 FROM board_items b LEFT JOIN users u ON u.id = b.author_id
                 WHERE b.conversation_id = $1 ORDER BY b.id`,
                [id],
            );
            joined.add(id);
            socket.join(`board:${id}`);
            if (!boardViewers.has(id)) boardViewers.set(id, new Map());
            boardViewers.get(id).set(socket.id, user.username);
            ack(cb, { items: rows.map((r) => ({ ...r.data, id: r.id, by: r.by })), viewers: viewerNames(id) });
            sendPresence(id);
        } catch (err) {
            console.error("board:join", err);
            ack(cb, { error: "Couldn't open the board. Try again." });
        }
    });

    socket.on("board:leave", (d) => leave(Number(d && d.conversationId)));

    socket.on("board:add", async (d, cb) => {
        try {
            const id = onBoard(d);
            if (id == null || !allow()) return ack(cb, { ok: false });
            const item = cleanBoardItem(d.item);
            if (!item) return ack(cb, { ok: false });
            const { rowCount } = await pool.query(
                `INSERT INTO board_items (conversation_id, item_key, author_id, data)
                 SELECT $1, $2, $3, $4
                 WHERE (SELECT count(*) FROM board_items WHERE conversation_id = $1) < ${BOARD_MAX_ITEMS}
                 ON CONFLICT (conversation_id, item_key) DO NOTHING`,
                [id, item.id, user.id, item.data],
            );
            if (!rowCount) return ack(cb, { ok: false, full: true });
            socket.to(`board:${id}`).emit("board:add", { conversationId: id, item: { ...item.data, id: item.id, by: user.username } });
            ack(cb, { ok: true });
        } catch (err) {
            console.error("board:add", err);
            ack(cb, { ok: false });
        }
    });

    socket.on("board:remove", async (d) => {
        try {
            const id = onBoard(d);
            if (id == null || !allow() || !Array.isArray(d.ids)) return;
            const ids = d.ids.map(String).filter((k) => BOARD_ITEM_ID.test(k)).slice(0, 500);
            if (!ids.length) return;
            await pool.query("DELETE FROM board_items WHERE conversation_id = $1 AND item_key = ANY($2)", [id, ids]);
            socket.to(`board:${id}`).emit("board:remove", { conversationId: id, ids });
        } catch (err) {
            console.error("board:remove", err);
        }
    });

    socket.on("board:clear", async (d) => {
        try {
            const id = onBoard(d);
            if (id == null || !allow()) return;
            await pool.query("DELETE FROM board_items WHERE conversation_id = $1", [id]);
            socket.to(`board:${id}`).emit("board:clear", { conversationId: id, by: user.username });
        } catch (err) {
            console.error("board:clear", err);
        }
    });

    // Cursor + the shape someone is in the middle of drawing. Not saved, may be dropped.
    socket.on("board:live", (d) => {
        const id = onBoard(d);
        if (id == null) return;
        const x = Number(d.x), y = Number(d.y);
        let draft = null;
        if (d.d && typeof d.d === "object") {
            const it = cleanBoardItem({ ...d.d, s: d.d.t === "text" ? "x" : d.d.s, p: d.d.p });
            if (it) {
                draft = { ...it.data, id: it.id, o: Math.max(0, Math.floor(Number(d.d.o) || 0)) };
                if (draft.t === "text") delete draft.s;
            }
        } else if (d.d === false) draft = false;
        socket.volatile.to(`board:${id}`).emit("board:live", {
            conversationId: id, sid: socket.id, by: user.username,
            x: Number.isFinite(x) ? x : null, y: Number.isFinite(y) ? y : null, d: draft,
        });
    });

    socket.on("disconnect", () => {
        for (const id of [...joined]) leave(id);
    });
}

// ------------------------------------------------------------------
// Socket.io
// Accepts either: mobile app (io({ auth: { username } })) or browser (session cookie)
// ------------------------------------------------------------------
io.use(async (socket, next) => {
    try {
        const session = socket.request.session;
        if (session && session.user && session.user.id) {
            socket.user = session.user;
        } else if (socket.handshake.auth && socket.handshake.auth.username) {
            socket.user = await findUserByName(socket.handshake.auth.username);
        }
        if (socket.user) return next();
        next(new Error("Unauthorized"));
    } catch (err) {
        next(err);
    }
});

io.on("connection", async (socket) => {
    const user = socket.user;
    registerCrackers(socket);
    registerBoard(socket);

    // Rooms: personal room + main room + all your direct chats
    socket.join(`user:${user.id}`);
    socket.join(`conv:${MAIN_ROOM_ID}`);
    const { rows } = await pool.query(
        "SELECT conversation_id FROM conversation_members WHERE user_id = $1",
        [user.id],
    );
    rows.forEach((r) => socket.join(`conv:${r.conversation_id}`));

    // Legacy: older clients expect main-room history on connect
    socket.emit("past messages", await getHistory(MAIN_ROOM_ID));

    // Text message. Accepts:
    //   "hello"                                   -> main room (legacy browser)
    //   { sender, message }                       -> main room (legacy mobile app)
    //   { conversationId, message }               -> any conversation you're in
    socket.on("chat message", async (data) => {
        try {
            const text = (typeof data === "string" ? data : data && data.message) || "";
            if (!text.trim()) return;
            const conversationId = Number((data && data.conversationId) || MAIN_ROOM_ID);
            if (!(await canAccess(user.id, conversationId))) {
                return socket.emit("error", "You're not part of this conversation");
            }
            const senderName = (data && typeof data === "object" && data.sender) || user.username;
            await createMessage({ conversationId, user, senderName, text: text.trim() });
        } catch (err) {
            console.error("Error saving message:", err);
            socket.emit("error", "Message not sent. Try again.");
        }
    });
});

// ------------------------------------------------------------------
// Start
// ------------------------------------------------------------------
pool.ready
    .then(() => pool.query("SELECT id FROM conversations WHERE slug = 'main'"))
    .then(({ rows }) => {
        MAIN_ROOM_ID = rows[0].id;
        server.listen(9000, () => {
            console.log("Server is running on http://localhost:9000");
        });
    });
