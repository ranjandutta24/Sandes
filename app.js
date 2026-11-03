const express = require("express");
const pool = require("./db");
const session = require("express-session");
const http = require("http");
const util = require("util");
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

// Profile pictures: the browser already crops them to a small square, so they stay tiny
const AVATAR_DIR = path.join(UPLOAD_DIR, "avatars");
fs.mkdirSync(AVATAR_DIR, { recursive: true });
const AVATAR_FILE = /^[a-f0-9-]{36}\.(png|jpg|gif|webp)$/;
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 8 * 1024 * 1024 } });

// Real image type from the first bytes (never trust the name or the browser's mime type)
function imageKind(buf) {
    if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return "png";
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
    if (buf.length > 6 && buf.toString("ascii", 0, 4) === "GIF8") return "gif";
    if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
    return null;
}
const AVATAR_MIME = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const avatarUrl = (image) => (image ? `/avatars/${image}` : null);
const removeAvatarFile = (image) => image && AVATAR_FILE.test(image) && fs.unlink(path.join(AVATAR_DIR, image), () => {});

// ------------------------------------------------------------------
// Passwords: scrypt hashes ("scrypt$salt$hash"). Old plain-text passwords still work
// and are replaced with a hash the next time that person signs in.
// ------------------------------------------------------------------
const scrypt = util.promisify(crypto.scrypt);

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password, salt, 64);
    return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function checkPassword(password, stored) {
    if (typeof stored !== "string") return { ok: false };
    if (stored.startsWith("scrypt$")) {
        const [, salt, hash] = stored.split("$");
        const want = Buffer.from(hash || "", "hex");
        if (!salt || !want.length) return { ok: false };
        const got = await scrypt(password, Buffer.from(salt, "hex"), want.length);
        return { ok: crypto.timingSafeEqual(got, want) };
    }
    const a = Buffer.from(String(password)), b = Buffer.from(stored);
    return { ok: a.length === b.length && crypto.timingSafeEqual(a, b), legacy: true };
}

const USERNAME_RE = /^[\p{L}\p{N}._-]{2,40}$/u;
const USER_ID_RE = /^[A-Za-z0-9_-]{3,30}$/;
const MIN_PASSWORD = 6;
const passwordProblem = (p) =>
    typeof p !== "string" || p.length < MIN_PASSWORD
        ? `Use at least ${MIN_PASSWORD} characters for the password`
        : p.length > 200 ? "That password is too long" : null;

/** Usernames and user IDs share one namespace, so "log in with either" is never ambiguous. */
async function nameTaken(value, exceptId = 0) {
    const { rows } = await pool.query(
        "SELECT 1 FROM users WHERE id <> $2 AND (lower(username) = lower($1) OR lower(user_id) = lower($1))",
        [value, exceptId],
    );
    return rows.length > 0;
}

// ------------------------------------------------------------------
// Settings (sandes.settings), cached in memory. Admins change them, everyone gets "settings".
// ------------------------------------------------------------------
const SETTING_KEYS = [
    "crackers_enabled", "board_enabled", "attachments_enabled",
    "direct_messages_enabled", "users_can_change_username", "users_can_change_picture",
    "message_effects_enabled", "users_can_create_groups", "festival_theme",
];
// Settings that pick one of a few values (all the others are on/off)
const SETTING_CHOICES = {
    festival_theme: ["none", "diwali", "holi", "durga_puja", "christmas"],
};
const settings = Object.fromEntries(SETTING_KEYS.map((k) => [k, SETTING_CHOICES[k] ? SETTING_CHOICES[k][0] : true]));

/** Is this a valid value for that setting? */
const settingOk = (key, value) =>
    SETTING_CHOICES[key] ? SETTING_CHOICES[key].includes(value) : typeof value === "boolean";

async function loadSettings() {
    const { rows } = await pool.query("SELECT key, value FROM settings");
    for (const r of rows) if (SETTING_KEYS.includes(r.key) && settingOk(r.key, r.value)) settings[r.key] = r.value;
}

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
// index: false -> "/" goes through the sign-in check below instead of serving index.html directly
app.use(express.static(path.join(__dirname, "public"), { index: false }));

const USER_COLUMNS = "id, user_id, username, role, status, image, created_at";

async function loadUser(id) {
    const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    return rows[0];
}

/** What a browser gets to know about a user */
const publicUser = (u) => ({
    id: u.id, user_id: u.user_id, username: u.username, role: u.role,
    status: u.status, image: avatarUrl(u.image), created_at: u.created_at,
});

// Every request re-reads the user, so renames, role changes and "inactive" apply at once
async function requireUser(req, res, next) {
    const id = req.session.user && req.session.user.id;
    if (!id) return res.status(401).json({ message: "Not signed in" });
    const u = await loadUser(id);
    if (!u || u.status !== "active") {
        req.session.destroy(() => {});
        return res.status(401).json({ message: u ? "Your account has been turned off" : "Not signed in" });
    }
    req.session.user = { id: u.id, username: u.username };
    req.user = u;
    next();
}

function requireAdmin(req, res, next) {
    return requireUser(req, res, () => {
        if (req.user.role !== "admin") return res.status(403).json({ message: "Only admins can do that" });
        next();
    });
}

// Live sockets per user, so account changes reach every open tab
const userSockets = new Map(); // user id -> Set(socket)
const socketsOf = (id) => [...(userSockets.get(id) || [])];

/** Tell everyone about a changed name/picture, and the user themself about the rest */
function userChanged(u) {
    for (const s of socketsOf(u.id)) {
        s.user.username = u.username;
        s.user.role = u.role;
        s.emit("profile", publicUser(u));
    }
    io.emit("user:updated", { id: u.id, username: u.username, image: avatarUrl(u.image) });
    if (u.status !== "active") {
        for (const s of socketsOf(u.id)) {
            s.emit("account:disabled");
            s.disconnect(true);
        }
    }
}

// ------------------------------------------------------------------
// Data helpers
// ------------------------------------------------------------------
let MAIN_ROOM_ID = null;

// Names and pictures come from the users table, so a rename shows on old messages too
// Each message also carries: the message it replies to, reactions, and its poll (if any)
const MESSAGE_SELECT = `
    SELECT m.id, m.conversation_id, COALESCE(u.username, m.sender) AS sender, m.sender_id,
           CASE WHEN m.deleted_at IS NULL THEN m.message END AS message,
           m.kind, m.effect, m.edited_at, m.deleted_at,
           CASE WHEN u.image IS NOT NULL THEN '/avatars/' || u.image END AS sender_image,
           m.created_at AS "timestamp",
           (SELECT json_build_object(
                       'id', r.id, 'sender', COALESCE(ru.username, r.sender), 'sender_id', r.sender_id,
                       'message', CASE WHEN r.deleted_at IS NULL THEN left(r.message, 240) END,
                       'kind', r.kind, 'deleted', r.deleted_at IS NOT NULL,
                       'has_attachments', EXISTS (SELECT 1 FROM attachments ra WHERE ra.message_id = r.id))
            FROM chat_messages r LEFT JOIN users ru ON ru.id = r.sender_id
            WHERE r.id = m.reply_to) AS reply_to,
           (SELECT COALESCE(json_agg(json_build_object('emoji', x.emoji, 'users', x.users) ORDER BY x.first), '[]')
            FROM (SELECT emoji, json_agg(user_id ORDER BY created_at) AS users, min(created_at) AS first
                  FROM message_reactions WHERE message_id = m.id GROUP BY emoji) x) AS reactions,
           (SELECT json_build_object(
                       'question', p.question, 'options', p.options, 'multi', p.multi,
                       'closed', p.closed_at IS NOT NULL,
                       'votes', (SELECT COALESCE(json_agg(json_build_object('user_id', v.user_id, 'option', v.option_index)), '[]')
                                 FROM poll_votes v WHERE v.message_id = p.message_id))
            FROM polls p WHERE p.message_id = m.id) AS poll,
           COALESCE(
               json_agg(json_build_object(
                   'id', a.id, 'file_name', a.file_name,
                   'mime_type', a.mime_type, 'size_bytes', a.size_bytes,
                   'url', '/attachments/' || a.id
               ) ORDER BY a.id) FILTER (WHERE a.id IS NOT NULL),
               '[]'
           ) AS attachments
    FROM chat_messages m
    LEFT JOIN users u ON u.id = m.sender_id
    LEFT JOIN attachments a ON a.message_id = m.id`;

async function getMessage(id) {
    const { rows } = await pool.query(`${MESSAGE_SELECT} WHERE m.id = $1 GROUP BY m.id, u.id`, [id]);
    return rows[0];
}

/**
 * Messages of a conversation, oldest first.
 *   default      -> the latest `limit`
 *   { before }   -> `limit` older than that message id (scrolling up)
 *   { from }     -> 30 before that id and everything after it (jump to a search result)
 */
async function getHistory(conversationId, { limit = 200, before = null, from = null } = {}) {
    if (from) {
        const { rows } = await pool.query(
            `SELECT * FROM (
                 ${MESSAGE_SELECT} WHERE m.conversation_id = $1 AND m.id < $2
                 GROUP BY m.id, u.id ORDER BY m.id DESC LIMIT 30
             ) older
             UNION ALL
             SELECT * FROM (
                 ${MESSAGE_SELECT} WHERE m.conversation_id = $1 AND m.id >= $2
                 GROUP BY m.id, u.id ORDER BY m.id ASC LIMIT 2000
             ) newer
             ORDER BY id ASC`,
            [conversationId, from],
        );
        return rows;
    }
    const { rows } = await pool.query(
        `SELECT * FROM (
             ${MESSAGE_SELECT} WHERE m.conversation_id = $1 ${before ? "AND m.id < $3" : ""}
             GROUP BY m.id, u.id ORDER BY m.id DESC LIMIT $2
         ) t ORDER BY id ASC`,
        before ? [conversationId, limit, before] : [conversationId, limit],
    );
    return rows;
}

async function canAccess(userId, conversationId) {
    return (await accessType(userId, conversationId)) !== null;
}

/** 'room' / 'direct' if the user may use this conversation, otherwise null */
async function accessType(userId, conversationId) {
    if (!Number.isInteger(conversationId)) return null;
    const { rows } = await pool.query(
        `SELECT c.type FROM conversations c
         WHERE c.id = $1 AND (
             c.is_public OR EXISTS (
                 SELECT 1 FROM conversation_members cm
                 WHERE cm.conversation_id = c.id AND cm.user_id = $2
             )
         )`,
        [conversationId, userId],
    );
    return rows[0] ? rows[0].type : null;
}

/**
 * Can this user write in the conversation? Returns { type } or { error }.
 * Main room: everyone. Groups/channels/direct: members only (public channels: join first).
 */
async function postAccess(userId, conversationId) {
    if (!Number.isInteger(conversationId)) return { error: "You're not part of this conversation" };
    const { rows } = await pool.query(
        `SELECT c.type, c.slug, c.is_public,
                EXISTS (SELECT 1 FROM conversation_members cm
                        WHERE cm.conversation_id = c.id AND cm.user_id = $2) AS member
         FROM conversations c WHERE c.id = $1`,
        [conversationId, userId],
    );
    const c = rows[0];
    if (!c) return { error: "You're not part of this conversation" };
    if (c.slug === "main" || c.member) return { type: c.type };
    return { error: c.is_public ? "Join this channel to write in it" : "You're not part of this conversation" };
}

/** Why this user can't post here right now (settings), or null if they can */
function postBlocked(type, hasFiles) {
    if (type === "direct" && !settings.direct_messages_enabled) return "Direct messages are turned off by the admin";
    if (hasFiles && !settings.attachments_enabled) return "Sending files is turned off by the admin";
    return null;
}

/** Sign-in lookup: username or user ID (case-insensitive for the ID) */
async function findLogin(login) {
    const { rows } = await pool.query(
        `SELECT ${USER_COLUMNS}, password FROM users
         WHERE username = $1 OR lower(user_id) = lower($1)
         ORDER BY (username = $1) DESC LIMIT 1`,
        [String(login || "").trim()],
    );
    return rows[0];
}

/** Check a sign-in; upgrades plain-text passwords to a hash. Returns { user } or { error } */
async function signIn(login, password) {
    const u = await findLogin(login);
    const check = u ? await checkPassword(String(password || ""), u.password) : { ok: false };
    if (!check.ok) return { error: "credentials" };
    if (u.status !== "active") return { error: "inactive" };
    if (check.legacy) await pool.query("UPDATE users SET password = $1 WHERE id = $2", [await hashPassword(String(password)), u.id]);
    delete u.password;
    return { user: u };
}

const EFFECTS = ["confetti", "rangoli", "hearts", "petals"];
const MENTION_RE = /@([\p{L}\p{N}._-]{2,40})/gu;

/**
 * Store @mentions of people who can see this conversation. "@all" mentions every member.
 * Returns the ids of the people mentioned (never the sender).
 */
async function saveMentions(db, messageId, conversationId, text, senderId) {
    const names = [...new Set([...(text || "").matchAll(MENTION_RE)].map((m) => m[1].toLowerCase()))];
    if (!names.length) return [];
    const all = names.includes("all");
    const { rows } = await db.query(
        `SELECT u.id FROM users u, conversations c
         WHERE c.id = $1 AND u.status = 'active' AND u.id <> $3
           AND ($4 OR lower(u.username) = ANY($2))
           AND (c.slug = 'main' OR EXISTS (SELECT 1 FROM conversation_members cm
                                           WHERE cm.conversation_id = c.id AND cm.user_id = u.id))`,
        [conversationId, names, senderId, all],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length) {
        await db.query(
            `INSERT INTO message_mentions (message_id, user_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
            [messageId, ids],
        );
    }
    return ids;
}

/** You've obviously read what you just sent: move your read marker and tell the chat */
async function markRead(userId, conversationId, messageId) {
    const { rows } = await pool.query(
        `INSERT INTO conversation_reads (conversation_id, user_id, last_read_id, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (conversation_id, user_id) DO UPDATE
             SET last_read_id = GREATEST(conversation_reads.last_read_id, EXCLUDED.last_read_id), updated_at = NOW()
         RETURNING last_read_id`,
        [conversationId, userId, messageId],
    );
    io.to(`conv:${conversationId}`).emit("read", { conversationId, userId, lastReadId: rows[0].last_read_id });
    return rows[0].last_read_id;
}

/**
 * Save a message (+ optional uploaded files, reply, poll, effect) and broadcast it.
 *   kind 'system' messages are short notes like "priya added rahul"
 */
async function createMessage({ conversationId, user, text, files = [], replyTo = null, kind = "text", effect = null, poll = null }) {
    const client = await pool.connect();
    let messageId, mentioned = [];
    try {
        await client.query("BEGIN");
        // a reply must point at a message in the same conversation
        let reply = null;
        if (replyTo) {
            const r = await client.query("SELECT id FROM chat_messages WHERE id = $1 AND conversation_id = $2", [replyTo, conversationId]);
            reply = r.rows[0] ? r.rows[0].id : null;
        }
        const fx = effect && EFFECTS.includes(effect) && settings.message_effects_enabled ? effect : null;
        const { rows } = await client.query(
            `INSERT INTO chat_messages (conversation_id, sender, sender_id, message, kind, reply_to, effect)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [conversationId, user.username, user.id, text || null, kind, reply, fx],
        );
        messageId = rows[0].id;
        for (const f of files) {
            await client.query(
                `INSERT INTO attachments (message_id, file_name, stored_name, mime_type, size_bytes)
                 VALUES ($1, $2, $3, $4, $5)`,
                [messageId, f.originalname, f.filename, f.mimetype || "application/octet-stream", f.size],
            );
        }
        if (poll) {
            await client.query(
                "INSERT INTO polls (message_id, question, options, multi) VALUES ($1, $2, $3, $4)",
                [messageId, poll.question, JSON.stringify(poll.options), !!poll.multi],
            );
        }
        if (kind !== "system") mentioned = await saveMentions(client, messageId, conversationId, text, user.id);
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
    if (conversationId === MAIN_ROOM_ID && kind === "text") io.emit("chat message", msg);
    for (const uid of mentioned) {
        for (const s of socketsOf(uid)) s.emit("mention", { conversationId, message: msg });
    }
    if (kind !== "system") await markRead(user.id, conversationId, messageId);
    return msg;
}

function removeFiles(files = []) {
    for (const f of files) fs.unlink(f.path, () => {});
}

// ------------------------------------------------------------------
// Pages & auth
// ------------------------------------------------------------------
/** Page guard: signed in + active (and admin, if asked), otherwise back to the login page */
const pageFor = (file, adminOnly = false) => async (req, res) => {
    const u = req.session.user && (await loadUser(req.session.user.id));
    if (!u || u.status !== "active") {
        const inactive = u && u.status !== "active";
        return req.session.destroy(() => res.redirect(inactive ? "/login?error=inactive" : "/login"));
    }
    if (adminOnly && u.role !== "admin") return res.redirect("/");
    res.sendFile(path.join(__dirname, "public", file));
};

app.get("/", pageFor("index.html"));
app.get("/admin", pageFor("admin.html", true));

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

/** Start a fresh session for this user (new session id on every sign-in) */
const startSession = (req, user) =>
    new Promise((resolve, reject) =>
        req.session.regenerate((err) => {
            if (err) return reject(err);
            req.session.user = { id: user.id, username: user.username };
            resolve();
        }),
    );

app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const r = await signIn(username, password);
    if (r.error) return res.redirect(`/login?error=${r.error === "inactive" ? "inactive" : "1"}`);
    await startSession(req, r.user);
    res.redirect("/");
});

app.post("/login_app", async (req, res) => {
    const { username, password } = req.body;
    const r = await signIn(username, password);
    if (r.error === "inactive") return res.status(403).json({ message: "Your account has been turned off" });
    if (r.error) return res.status(401).json({ message: "Invalid credentials" });
    await startSession(req, r.user);
    return res.status(200).json({ user: { id: r.user.id, username: r.user.username, user_id: r.user.user_id, role: r.user.role } });
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/login"));
});

app.get("/me", requireUser, (req, res) => {
    res.json({ ...publicUser(req.user), settings });
});

// ------------------------------------------------------------------
// Profile pictures
// ------------------------------------------------------------------
app.get("/avatars/:file", requireUser, (req, res) => {
    const name = req.params.file;
    if (!AVATAR_FILE.test(name)) return res.status(404).send("Not found");
    res.setHeader("Content-Type", AVATAR_MIME[name.split(".").pop()]);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable"); // names are never reused
    res.sendFile(path.join(AVATAR_DIR, name), (err) => {
        if (err && !res.headersSent) res.status(404).send("Not found");
    });
});

/** Store an uploaded picture for a user (replacing the old one). Returns the updated user. */
/** Save an uploaded picture into uploads/avatars. Returns { name } or { error } */
async function saveAvatarFile(file) {
    const kind = file && imageKind(file.buffer);
    if (!kind) return { error: "Choose a PNG, JPG, GIF or WebP picture" };
    const name = `${crypto.randomUUID()}.${kind}`;
    await fs.promises.writeFile(path.join(AVATAR_DIR, name), file.buffer);
    return { name };
}

async function setAvatar(userId, file) {
    const saved = await saveAvatarFile(file);
    if (saved.error) return saved;
    const name = saved.name;
    const old = await loadUser(userId);
    await pool.query("UPDATE users SET image = $1, updated_at = NOW() WHERE id = $2", [name, userId]);
    removeAvatarFile(old && old.image);
    return { user: await loadUser(userId) };
}

async function clearAvatar(userId) {
    const old = await loadUser(userId);
    await pool.query("UPDATE users SET image = NULL, updated_at = NOW() WHERE id = $1", [userId]);
    removeAvatarFile(old && old.image);
    return loadUser(userId);
}

/** Run the avatar upload middleware and report its errors as JSON */
const readAvatar = (req, res) =>
    new Promise((resolve) =>
        avatarUpload.single("image")(req, res, (err) => {
            if (err) {
                res.status(400).json({ message: err.code === "LIMIT_FILE_SIZE" ? "That picture is too big (8 MB max)" : "Upload failed" });
                return resolve(null);
            }
            if (!req.file) {
                res.status(400).json({ message: "Choose a picture first" });
                return resolve(null);
            }
            resolve(req.file);
        }),
    );

// ------------------------------------------------------------------
// Your own profile: username, password, picture
// ------------------------------------------------------------------
app.put("/api/profile/username", requireUser, async (req, res) => {
    if (!settings.users_can_change_username && req.user.role !== "admin") {
        return res.status(403).json({ message: "Changing usernames is turned off by the admin" });
    }
    const username = String(req.body.username || "").trim();
    if (!USERNAME_RE.test(username)) {
        return res.status(400).json({ message: "Use 2 to 40 letters, numbers, dots, dashes or underscores (no spaces)" });
    }
    if (username === req.user.username) return res.json(publicUser(req.user));
    if (await nameTaken(username, req.user.id)) return res.status(409).json({ message: "That name is already taken" });
    await pool.query("UPDATE users SET username = $1, updated_at = NOW() WHERE id = $2", [username, req.user.id]);
    const u = await loadUser(req.user.id);
    req.session.user.username = u.username;
    userChanged(u);
    res.json(publicUser(u));
});

app.put("/api/profile/password", requireUser, async (req, res) => {
    const { current, password } = req.body;
    const { rows } = await pool.query("SELECT password FROM users WHERE id = $1", [req.user.id]);
    if (!(await checkPassword(String(current || ""), rows[0].password)).ok) {
        return res.status(400).json({ message: "Your current password isn't right" });
    }
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ message: problem });
    await pool.query("UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2", [await hashPassword(password), req.user.id]);
    res.json({ ok: true });
});

app.post("/api/profile/image", requireUser, async (req, res) => {
    if (!settings.users_can_change_picture && req.user.role !== "admin") {
        return res.status(403).json({ message: "Changing profile pictures is turned off by the admin" });
    }
    const file = await readAvatar(req, res);
    if (!file) return;
    const r = await setAvatar(req.user.id, file);
    if (r.error) return res.status(400).json({ message: r.error });
    userChanged(r.user);
    res.json(publicUser(r.user));
});

app.delete("/api/profile/image", requireUser, async (req, res) => {
    if (!settings.users_can_change_picture && req.user.role !== "admin") {
        return res.status(403).json({ message: "Changing profile pictures is turned off by the admin" });
    }
    const u = await clearAvatar(req.user.id);
    userChanged(u);
    res.json(publicUser(u));
});

// ------------------------------------------------------------------
// Admin: users + settings
// ------------------------------------------------------------------
app.get("/api/admin/users", requireAdmin, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT ${USER_COLUMNS},
                (SELECT count(*)::int FROM chat_messages m WHERE m.sender_id = users.id) AS messages
         FROM users ORDER BY (role = 'admin') DESC, lower(username)`,
    );
    res.json(rows.map((u) => ({ ...publicUser(u), messages: u.messages })));
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
    const username = String(req.body.username || "").trim();
    const userId = String(req.body.user_id || "").trim();
    const role = req.body.role === "admin" ? "admin" : "user";
    const { password } = req.body;
    if (!USERNAME_RE.test(username)) {
        return res.status(400).json({ message: "Username: use 2 to 40 letters, numbers, dots, dashes or underscores (no spaces)" });
    }
    if (userId && !USER_ID_RE.test(userId)) {
        return res.status(400).json({ message: "User ID: use 3 to 30 letters, numbers, dashes or underscores" });
    }
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ message: problem });
    if (await nameTaken(username)) return res.status(409).json({ message: "That username is already taken" });
    if (userId && (await nameTaken(userId))) return res.status(409).json({ message: "That user ID is already taken" });
    if (userId && userId.toLowerCase() === username.toLowerCase()) {
        return res.status(400).json({ message: "Make the user ID different from the username" });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO users (username, password, user_id, role) VALUES ($1, $2, $3, $4) RETURNING ${USER_COLUMNS}`,
            [username, await hashPassword(password), userId || null, role],
        );
        res.status(201).json({ ...publicUser(rows[0]), messages: 0 });
    } catch (err) {
        if (err.code === "23505") return res.status(409).json({ message: "That username or user ID is already taken" });
        throw err;
    }
});

async function activeAdmins(exceptId) {
    const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1",
        [exceptId],
    );
    return rows[0].n;
}

// Change username / role / status of a user
app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const target = Number.isInteger(id) && (await loadUser(id));
    if (!target) return res.status(404).json({ message: "That user doesn't exist" });
    const sets = [], vals = [];

    if (req.body.username !== undefined) {
        const username = String(req.body.username).trim();
        if (!USERNAME_RE.test(username)) {
            return res.status(400).json({ message: "Username: use 2 to 40 letters, numbers, dots, dashes or underscores (no spaces)" });
        }
        if (username !== target.username) {
            if (await nameTaken(username, id)) return res.status(409).json({ message: "That username is already taken" });
            vals.push(username);
            sets.push(`username = $${vals.length}`);
        }
    }
    for (const [field, allowed] of [["role", ["admin", "user"]], ["status", ["active", "inactive"]]]) {
        if (req.body[field] === undefined || req.body[field] === target[field]) continue;
        if (!allowed.includes(req.body[field])) return res.status(400).json({ message: `Unknown ${field}` });
        // never lock everyone out: the last active admin stays an active admin
        const losesAdmin = (field === "role" && req.body.role !== "admin") || (field === "status" && req.body.status !== "active");
        if (losesAdmin && target.role === "admin") {
            if (id === req.user.id) return res.status(400).json({ message: "You can't remove your own admin access or turn yourself off" });
            if ((await activeAdmins(id)) === 0) return res.status(400).json({ message: "Keep at least one active admin" });
        }
        vals.push(req.body[field]);
        sets.push(`${field} = $${vals.length}`);
    }
    if (!sets.length) return res.json(publicUser(target));
    vals.push(id);
    try {
        await pool.query(`UPDATE users SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${vals.length}`, vals);
    } catch (err) {
        if (err.code === "23505") return res.status(409).json({ message: "That username is already taken" });
        throw err;
    }
    const u = await loadUser(id);
    userChanged(u);
    res.json(publicUser(u));
});

app.put("/api/admin/users/:id/password", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await loadUser(id))) return res.status(404).json({ message: "That user doesn't exist" });
    const problem = passwordProblem(req.body.password);
    if (problem) return res.status(400).json({ message: problem });
    await pool.query("UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2", [await hashPassword(req.body.password), id]);
    res.json({ ok: true });
});

app.post("/api/admin/users/:id/image", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await loadUser(id))) return res.status(404).json({ message: "That user doesn't exist" });
    const file = await readAvatar(req, res);
    if (!file) return;
    const r = await setAvatar(id, file);
    if (r.error) return res.status(400).json({ message: r.error });
    userChanged(r.user);
    res.json(publicUser(r.user));
});

app.delete("/api/admin/users/:id/image", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await loadUser(id))) return res.status(404).json({ message: "That user doesn't exist" });
    const u = await clearAvatar(id);
    userChanged(u);
    res.json(publicUser(u));
});

app.get("/api/admin/settings", requireAdmin, (req, res) => res.json(settings));

app.put("/api/admin/settings", requireAdmin, async (req, res) => {
    const changes = Object.entries(req.body || {}).filter(([k, v]) => SETTING_KEYS.includes(k) && settingOk(k, v));
    if (!changes.length) return res.status(400).json({ message: "Nothing to change" });
    for (const [key, value] of changes) {
        await pool.query(
            `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
            [key, JSON.stringify(value), req.user.id],
        );
        settings[key] = value;
    }
    if (!settings.board_enabled) closeAllBoards();
    io.emit("settings", settings);
    res.json(settings);
});

// ------------------------------------------------------------------
// API: users & conversations
// ------------------------------------------------------------------

// Everyone you can start a direct chat with
app.get("/api/users", requireUser, async (req, res) => {
    const { rows } = await pool.query(
        "SELECT id, username, image FROM users WHERE id <> $1 AND status = 'active' ORDER BY lower(username)",
        [req.session.user.id],
    );
    res.json(rows.map((u) => ({ id: u.id, username: u.username, image: avatarUrl(u.image) })));
});

// Main room + your groups, channels and direct chats, with unread counts
async function listConversations(userId, onlyId = null) {
    const { rows } = await pool.query(
        `SELECT c.id, c.type, c.slug, c.is_public, c.description,
                CASE WHEN c.type = 'direct' THEN other.username ELSE c.name END AS name,
                other.id AS other_user_id,
                CASE WHEN c.type = 'direct' THEN
                         CASE WHEN other.image IS NOT NULL THEN '/avatars/' || other.image END
                     ELSE CASE WHEN c.image IS NOT NULL THEN '/avatars/' || c.image END
                END AS image,
                my.role AS my_role,
                (SELECT count(*)::int FROM conversation_members cm2 WHERE cm2.conversation_id = c.id) AS member_count,
                last.message AS last_message,
                last.kind AS last_kind,
                last.deleted AS last_deleted,
                last.has_attachments AS last_has_attachments,
                last.sender AS last_sender,
                COALESCE(last.created_at, c.created_at) AS last_activity,
                COALESCE(r.last_read_id, 0) AS last_read_id,
                (SELECT count(*)::int FROM chat_messages m
                 WHERE m.conversation_id = c.id AND m.id > COALESCE(r.last_read_id, 0)
                   AND m.created_at > me.created_at AND m.sender_id IS DISTINCT FROM $1
                   AND m.deleted_at IS NULL AND m.kind <> 'system') AS unread,
                EXISTS (SELECT 1 FROM message_mentions mm JOIN chat_messages m ON m.id = mm.message_id
                        WHERE mm.user_id = $1 AND m.conversation_id = c.id
                          AND m.id > COALESCE(r.last_read_id, 0) AND m.deleted_at IS NULL) AS mentioned
         FROM conversations c
         JOIN users me ON me.id = $1
         LEFT JOIN conversation_members my ON my.conversation_id = c.id AND my.user_id = $1
         LEFT JOIN conversation_reads r ON r.conversation_id = c.id AND r.user_id = $1
         LEFT JOIN LATERAL (
             SELECT u.id, u.username, u.image FROM conversation_members cm
             JOIN users u ON u.id = cm.user_id
             WHERE cm.conversation_id = c.id AND cm.user_id <> $1
             LIMIT 1
         ) other ON c.type = 'direct'
         LEFT JOIN LATERAL (
             SELECT CASE WHEN m.deleted_at IS NULL THEN m.message END AS message, m.kind,
                    m.deleted_at IS NOT NULL AS deleted,
                    COALESCE(su.username, m.sender) AS sender, m.created_at,
                    EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id) AS has_attachments
             FROM chat_messages m LEFT JOIN users su ON su.id = m.sender_id
             WHERE m.conversation_id = c.id
             ORDER BY m.id DESC LIMIT 1
         ) last ON TRUE
         WHERE (c.slug = 'main' OR my.user_id IS NOT NULL) ${onlyId ? "AND c.id = $2" : ""}
         ORDER BY (c.slug = 'main') DESC NULLS LAST, last_activity DESC`,
        onlyId ? [userId, onlyId] : [userId],
    );
    return rows;
}

app.get("/api/conversations", requireUser, async (req, res) => {
    res.json(await listConversations(req.session.user.id));
});

// Open (or create) a direct chat with another user
app.post("/api/conversations/direct", requireUser, async (req, res) => {
    const me = req.session.user.id;
    const other = Number(req.body.userId);
    if (!settings.direct_messages_enabled) return res.status(403).json({ message: "Direct messages are turned off by the admin" });
    if (!Number.isInteger(other) || !other || other === me) return res.status(400).json({ message: "Choose someone else to message" });

    const { rows: users } = await pool.query("SELECT id, username, image FROM users WHERE id = $1 AND status = 'active'", [other]);
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
    for (const s of socketsOf(other)) s.emit("conversations:changed");

    res.json({ id: conversationId, type: "direct", name: users[0].username, other_user_id: other, image: avatarUrl(users[0].image) });
});

app.get("/api/conversations/:id/messages", requireUser, async (req, res) => {
    const id = Number(req.params.id);
    if (!(await canAccess(req.session.user.id, id))) {
        return res.status(403).json({ message: "You're not part of this conversation" });
    }
    const before = Number(req.query.before) || null;
    const from = Number(req.query.from) || null;
    res.json(await getHistory(id, { before, from }));
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
            const access = await postAccess(req.session.user.id, id);
            if (access.error) {
                removeFiles(files);
                return res.status(403).json({ message: access.error });
            }
            const blocked = postBlocked(access.type, files.length > 0);
            if (blocked) {
                removeFiles(files);
                return res.status(403).json({ message: blocked });
            }
            const text = (req.body.message || "").trim();
            if (!text && files.length === 0) {
                removeFiles(files);
                return res.status(400).json({ message: "Write a message or attach a file" });
            }
            if (text.length > 4000) {
                removeFiles(files);
                return res.status(400).json({ message: "That message is too long (4000 characters max)" });
            }
            const msg = await createMessage({
                conversationId: id, user: req.session.user, text, files,
                replyTo: Number(req.body.replyTo) || null, effect: req.body.effect || null,
            });
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
            if (!settings.crackers_enabled || boardIsOn(conversationId)) return; // off, or the board is open
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
            if (!settings.crackers_enabled || boardIsOn(conversationId)) return;
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
        if (event === "cracker:ignite" && (!settings.crackers_enabled || boardIsOn(entry.conv))) return;
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
// Shared drawing board (one per conversation, saved in board_items, split into pages).
//   board:status {conversationId}               -> ack { viewers }      (is anyone on the board?)
//   board:join   {conversationId}               -> ack { pages, items, viewers }
//   board:leave  {conversationId}
//   board:add    {conversationId, item}         -> saved, sent to everyone on the board
//   board:update {conversationId, item}         -> moved / resized / edited shape
//   board:remove {conversationId, ids}          -> erased / undone
//   board:clear  {conversationId, page}         -> wipes one page
//   board:page:add / rename / delete            -> pages, broadcast as board:pages
//   board:live   {conversationId, page, x, y, d} -> cursor + shape being drawn (not saved)
//   board:presence {conversationId, viewers} goes to every member of the chat, so they
//   can see the board is open. While anyone is on it, crackers are off in that chat.
// ------------------------------------------------------------------
const BOARD_W = 1600;
const BOARD_H = 1000;
const BOARD_MAX_ITEMS = 5000;
const BOARD_MAX_PAGES = 20;
const BOARD_ITEM_ID = /^[a-f0-9]{8,32}$/i;
const BOARD_POINTS = {
    pen: [2, 8000], line: [4, 4], arrow: [4, 4], rect: [4, 4], ellipse: [4, 4], text: [2, 2],
    sticky: [4, 4], shape: [4, 4],
};
// ready-made diagram shapes
const BOARD_SHAPES = ["db", "server", "user", "cloud", "diamond", "doc", "laptop", "phone", "queue", "lock"];
const boardViewers = new Map(); // conversation id -> Map(socket id -> username)

const boardIsOn = (conversationId) => (boardViewers.get(conversationId)?.size || 0) > 0;
const viewerNames = (conversationId) => [...new Set((boardViewers.get(conversationId) || new Map()).values())];

function cleanBoardItem(it, { draft = false } = {}) {
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
    const page = Number(it.page);
    if (Number.isInteger(page) && page > 0) out.page = page;
    const text = typeof it.s === "string" ? it.s.replace(/\s+$/, "").slice(0, 1000) : "";
    if (it.t === "text") {
        if (!text.trim() && !draft) return null;
        if (text) out.s = text;
    }
    if ((it.t === "sticky" || it.t === "shape") && text) out.s = text;
    if (it.t === "shape") {
        if (!BOARD_SHAPES.includes(it.k)) return null;
        out.k = it.k;
    }
    if ((it.t === "rect" || it.t === "ellipse" || it.t === "shape") && it.f) out.f = true;
    return { id: String(it.id), data: out };
}

function sendPresence(conversationId) {
    io.to(`conv:${conversationId}`).emit("board:presence", { conversationId, viewers: viewerNames(conversationId) });
}

async function boardPages(conversationId) {
    let { rows } = await pool.query("SELECT id, name FROM board_pages WHERE conversation_id = $1 ORDER BY id", [conversationId]);
    if (!rows.length) {
        ({ rows } = await pool.query(
            "INSERT INTO board_pages (conversation_id, name) VALUES ($1, 'Page 1') RETURNING id, name",
            [conversationId],
        ));
    }
    return rows;
}

const boardSessions = new Set(); // one "leave everything" function per connected socket

/** Admin turned the board off: everyone leaves, crackers come back */
function closeAllBoards() {
    for (const leaveAll of boardSessions) leaveAll();
}

function registerBoard(socket) {
    const user = socket.user;
    const joined = new Set(); // conversation ids this socket has the board open for
    let bucket = 60, refill = Date.now(); // rate limit for saved changes

    const allow = () => {
        const t = Date.now();
        bucket = Math.min(60, bucket + ((t - refill) / 1000) * 30);
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
    const pageOf = async (conversationId, pageId) => {
        const { rows } = await pool.query("SELECT id FROM board_pages WHERE id = $1 AND conversation_id = $2", [pageId, conversationId]);
        return rows[0] ? rows[0].id : null;
    };
    const broadcastPages = async (id) => {
        io.to(`board:${id}`).emit("board:pages", { conversationId: id, pages: await boardPages(id) });
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
            if (!settings.board_enabled) return ack(cb, { error: "The board is turned off by the admin" });
            if (!(await canAccess(user.id, id))) return ack(cb, { error: "You're not part of this conversation" });
            const pages = await boardPages(id);
            const { rows } = await pool.query(
                `SELECT b.item_key AS id, b.data, b.page_id, u.username AS by
                 FROM board_items b LEFT JOIN users u ON u.id = b.author_id
                 WHERE b.conversation_id = $1 ORDER BY b.id`,
                [id],
            );
            joined.add(id);
            socket.join(`board:${id}`);
            if (!boardViewers.has(id)) boardViewers.set(id, new Map());
            boardViewers.get(id).set(socket.id, user.username);
            ack(cb, {
                pages,
                items: rows.map((r) => ({ ...r.data, id: r.id, page: r.page_id || pages[0].id, by: r.by })),
                viewers: viewerNames(id),
            });
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
            const page = await pageOf(id, item.data.page);
            if (!page) return ack(cb, { ok: false, gone: true });
            const { page: _p, ...data } = item.data;
            const { rowCount } = await pool.query(
                `INSERT INTO board_items (conversation_id, item_key, author_id, data, page_id)
                 SELECT $1, $2, $3, $4, $5
                 WHERE (SELECT count(*) FROM board_items WHERE conversation_id = $1) < ${BOARD_MAX_ITEMS}
                 ON CONFLICT (conversation_id, item_key) DO NOTHING`,
                [id, item.id, user.id, data, page],
            );
            if (!rowCount) return ack(cb, { ok: false, full: true });
            socket.to(`board:${id}`).emit("board:add", { conversationId: id, item: { ...data, id: item.id, page, by: user.username } });
            ack(cb, { ok: true });
        } catch (err) {
            console.error("board:add", err);
            ack(cb, { ok: false });
        }
    });

    // Anyone on the board may move, resize or retype any shape (it's a shared whiteboard)
    socket.on("board:update", async (d, cb) => {
        try {
            const id = onBoard(d);
            if (id == null || !allow()) return ack(cb, { ok: false });
            const item = cleanBoardItem(d.item);
            if (!item) return ack(cb, { ok: false });
            const { page: _p, ...data } = item.data;
            const { rows } = await pool.query(
                `UPDATE board_items SET data = $3, updated_at = NOW()
                 WHERE conversation_id = $1 AND item_key = $2
                 RETURNING page_id, (SELECT username FROM users WHERE id = author_id) AS by`,
                [id, item.id, data],
            );
            if (!rows[0]) return ack(cb, { ok: false, gone: true });
            socket.to(`board:${id}`).emit("board:update", {
                conversationId: id, item: { ...data, id: item.id, page: rows[0].page_id, by: rows[0].by },
            });
            ack(cb, { ok: true });
        } catch (err) {
            console.error("board:update", err);
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
            const page = await pageOf(id, Number(d.page));
            if (!page) return;
            await pool.query("DELETE FROM board_items WHERE conversation_id = $1 AND page_id = $2", [id, page]);
            socket.to(`board:${id}`).emit("board:clear", { conversationId: id, page, by: user.username });
        } catch (err) {
            console.error("board:clear", err);
        }
    });

    const pageName = (n) => (typeof n === "string" ? n.trim().slice(0, 60) : "");

    socket.on("board:page:add", async (d, cb) => {
        try {
            const id = onBoard(d);
            if (id == null || !allow()) return ack(cb, { ok: false });
            const pages = await boardPages(id);
            if (pages.length >= BOARD_MAX_PAGES) return ack(cb, { ok: false, message: `A board can have up to ${BOARD_MAX_PAGES} pages` });
            const { rows } = await pool.query(
                "INSERT INTO board_pages (conversation_id, name) VALUES ($1, $2) RETURNING id, name",
                [id, pageName(d.name) || `Page ${pages.length + 1}`],
            );
            await broadcastPages(id);
            ack(cb, { ok: true, page: rows[0] });
        } catch (err) {
            console.error("board:page:add", err);
            ack(cb, { ok: false });
        }
    });

    socket.on("board:page:rename", async (d, cb) => {
        try {
            const id = onBoard(d);
            const name = pageName(d && d.name);
            if (id == null || !allow() || !name) return ack(cb, { ok: false });
            await pool.query("UPDATE board_pages SET name = $3 WHERE id = $2 AND conversation_id = $1", [id, Number(d.page), name]);
            await broadcastPages(id);
            ack(cb, { ok: true });
        } catch (err) {
            console.error("board:page:rename", err);
            ack(cb, { ok: false });
        }
    });

    socket.on("board:page:delete", async (d, cb) => {
        try {
            const id = onBoard(d);
            if (id == null || !allow()) return ack(cb, { ok: false });
            const pages = await boardPages(id);
            if (pages.length <= 1) return ack(cb, { ok: false, message: "A board needs at least one page" });
            await pool.query("DELETE FROM board_pages WHERE id = $2 AND conversation_id = $1", [id, Number(d.page)]);
            await broadcastPages(id);
            ack(cb, { ok: true });
        } catch (err) {
            console.error("board:page:delete", err);
            ack(cb, { ok: false });
        }
    });

    // Cursor + the shape someone is in the middle of drawing. Not saved, may be dropped.
    socket.on("board:live", (d) => {
        const id = onBoard(d);
        if (id == null) return;
        const x = Number(d.x), y = Number(d.y);
        let draft = null;
        if (d.d && typeof d.d === "object") {
            const it = cleanBoardItem(d.d, { draft: true });
            if (it) draft = { ...it.data, id: it.id, o: Math.max(0, Math.floor(Number(d.d.o) || 0)) };
        } else if (d.d === false) draft = false;
        socket.volatile.to(`board:${id}`).emit("board:live", {
            conversationId: id, sid: socket.id, by: user.username, page: Number(d.page) || null,
            x: Number.isFinite(x) ? x : null, y: Number.isFinite(y) ? y : null, d: draft,
        });
    });

    const leaveAll = () => {
        for (const id of [...joined]) {
            socket.emit("board:closed", { conversationId: id });
            leave(id);
        }
    };
    boardSessions.add(leaveAll);

    socket.on("disconnect", () => {
        boardSessions.delete(leaveAll);
        for (const id of [...joined]) leave(id);
    });
}

// ------------------------------------------------------------------
// Chat features: reactions, edits, receipts, typing, groups, pins, polls, tasks, notes, search
// ------------------------------------------------------------------
const features = require("./features")({
    app, io, pool, settings, requireUser, requireAdmin, accessType, postAccess, postBlocked,
    createMessage, getMessage, markRead, saveMentions, listConversations, socketsOf, userSockets,
    readAvatar, saveAvatarFile, removeAvatarFile, avatarUrl, removeFiles, UPLOAD_DIR,
    mainRoomId: () => MAIN_ROOM_ID,
});

// ------------------------------------------------------------------
// Socket.io
// Accepts either: mobile app (io({ auth: { username } }), username or user ID) or browser (session cookie)
// ------------------------------------------------------------------
io.use(async (socket, next) => {
    try {
        const session = socket.request.session;
        let u = null;
        if (session && session.user && session.user.id) {
            u = await loadUser(session.user.id);
        } else if (socket.handshake.auth && socket.handshake.auth.username) {
            u = await findLogin(socket.handshake.auth.username);
        }
        if (!u) return next(new Error("Unauthorized"));
        if (u.status !== "active") return next(new Error("Account turned off"));
        // one mutable object per socket: renames/role changes are applied to it in place
        socket.user = { id: u.id, username: u.username, role: u.role };
        next();
    } catch (err) {
        next(err);
    }
});

io.on("connection", async (socket) => {
    const user = socket.user;
    // Presence: online while at least one tab is connected
    if (!userSockets.has(user.id)) {
        userSockets.set(user.id, new Set());
        io.emit("presence", { id: user.id, online: true });
    }
    userSockets.get(user.id).add(socket);
    socket.on("disconnect", async () => {
        const set = userSockets.get(user.id);
        if (!set) return;
        set.delete(socket);
        if (set.size) return;
        userSockets.delete(user.id);
        try {
            const { rows } = await pool.query("UPDATE users SET last_seen = NOW() WHERE id = $1 RETURNING last_seen", [user.id]);
            // a new tab may have connected while we were saving
            if (!userSockets.has(user.id)) io.emit("presence", { id: user.id, online: false, last_seen: rows[0] && rows[0].last_seen });
        } catch (err) {
            console.error("presence", err);
        }
    });
    registerCrackers(socket);
    registerBoard(socket);
    features.registerSocket(socket);

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
            const access = await postAccess(user.id, conversationId);
            if (access.error) return socket.emit("error", access.error);
            const blocked = postBlocked(access.type, false);
            if (blocked) return socket.emit("error", blocked);
            if (text.length > 4000) return socket.emit("error", "That message is too long (4000 characters max)");
            // the name always comes from the account (legacy clients may send their own "sender")
            await createMessage({
                conversationId, user, text: text.trim(),
                replyTo: (data && Number(data.replyTo)) || null,
                effect: (data && typeof data.effect === "string" && data.effect) || null,
            });
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
    .then(loadSettings)
    .then(() => pool.query("SELECT id FROM conversations WHERE slug = 'main'"))
    .then(({ rows }) => {
        MAIN_ROOM_ID = rows[0].id;
        server.listen(9000, () => {
            console.log("Server is running on http://localhost:9000");
        });
    });
