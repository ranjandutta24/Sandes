/* Sandes · chat features (server side)
 *
 *   presence + typing ........ "presence", "typing"
 *   read receipts ............ "read", conversation_reads
 *   reactions ................ "react" -> "reactions"
 *   edit / delete ............ "message:edit" / "message:delete" -> "message:update"
 *   pins ..................... "pin" -> "pins"
 *   polls .................... "poll:create" / "poll:vote" / "poll:close" -> "poll"
 *   tasks .................... "tasks:list" / "task:add" / "task:update" / "task:delete" -> "tasks"
 *   shared notes ............. "notes:open" / "notes:op" / "notes:close" (live, operational transform)
 *   groups & channels ........ /api/groups...
 *   search ................... /api/search
 *
 * app.js passes in what's shared (database pool, socket.io, auth helpers, createMessage...).
 */
const fs = require("fs");
const path = require("path");

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "🎉", "👏", "✅"];
const MAX_PINS = 20;
const MAX_TASKS = 500;
const NOTE_MAX = 100000;
const NOTE_LOG = 500;

/**
 * Shift edit `a` so it can be applied after edit `b` (both were made on the same text).
 * Each edit is { from, to, text }: replace from..to with text. `aIsLater` breaks ties
 * (the server applied b first). public/panels.js has the same function: keep them identical.
 *   - an edit inside a range someone else replaced is dropped (their replacement wins)
 *   - overlapping edits keep their parts outside the other edit
 *   - two inserts at the same spot: the earlier one goes first
 */
function noteTransform(a, b, aIsLater) {
    const bLen = b.text.length;
    if (b.from === b.to) {
        const q = b.from;
        const map = (p, isStart) => {
            if (p < q) return p;
            if (p > q) return p + bLen;
            if (a.from === a.to) return aIsLater ? p + bLen : p;
            return isStart ? p + bLen : p;
        };
        const from = map(a.from, true);
        return { from, to: Math.max(from, map(a.to, false)), text: a.text };
    }
    const sameRange = a.from === b.from && a.to === b.to;
    const insertAtEdge = a.from === a.to && (a.from === b.from || a.from === b.to);
    if (b.from <= a.from && a.to <= b.to && !insertAtEdge && !(sameRange && aIsLater)) {
        const p = b.from + bLen;
        return { from: p, to: p, text: "" };
    }
    const delta = bLen - (b.to - b.from);
    const map = (p, isStart) => (p <= b.from ? p : p >= b.to ? p + delta : isStart ? b.from + bLen : b.from);
    const from = map(a.from, true);
    return { from, to: Math.max(from, map(a.to, false)), text: a.text };
}

module.exports = function features(ctx) {
    const {
        app, io, pool, settings, requireUser, accessType, postAccess, postBlocked,
        createMessage, getMessage, markRead, saveMentions, listConversations, socketsOf, userSockets,
        readAvatar, saveAvatarFile, removeAvatarFile, avatarUrl, UPLOAD_DIR, mainRoomId,
    } = ctx;

    const ack = (cb, v) => typeof cb === "function" && cb(v);
    const int = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
    const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const isOnline = (id) => userSockets.has(id);

    /** Wrap an async socket handler: errors are logged and answered instead of crashing */
    const safe = (name, fn) => async (d, cb) => {
        try {
            await fn(d || {}, cb);
        } catch (err) {
            console.error(name, err);
            ack(cb, { ok: false, message: "Something went wrong. Try again." });
        }
    };

    // ------------------------------------------------------------------
    // Groups: who may manage what
    // ------------------------------------------------------------------
    async function groupInfo(userId, conversationId) {
        if (!conversationId) return null;
        const { rows } = await pool.query(
            `SELECT c.id, c.type, c.slug, c.name, c.is_public, c.image,
                    cm.role AS my_role, u.role AS app_role
             FROM conversations c
             JOIN users u ON u.id = $2
             LEFT JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $2
             WHERE c.id = $1`,
            [conversationId, userId],
        );
        const g = rows[0];
        if (!g) return null;
        g.member = g.slug === "main" || g.my_role != null;
        g.canManage = g.app_role === "admin" || (g.type === "room" && g.my_role === "owner");
        return g;
    }

    const changed = (conversationId) => io.to(`conv:${conversationId}`).emit("conversations:changed");
    const tellUsers = (ids, event, data) => {
        for (const id of ids) for (const s of socketsOf(id)) s.emit(event, data);
    };

    /** The newest message id, so people added to a group don't see its history as unread */
    async function startReadAt(conversationId, userIds) {
        await pool.query(
            `INSERT INTO conversation_reads (conversation_id, user_id, last_read_id)
             SELECT $1, unnest($2::int[]), COALESCE((SELECT max(id) FROM chat_messages WHERE conversation_id = $1), 0)
             ON CONFLICT (conversation_id, user_id) DO NOTHING`,
            [conversationId, userIds],
        );
    }

    const system = (conversationId, user, text) => createMessage({ conversationId, user, text, kind: "system" });
    const actor = (req) => ({ id: req.user.id, username: req.user.username });
    const names = (list) =>
        list.length <= 2 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;

    async function activeUsers(ids) {
        const clean = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))].slice(0, 500);
        if (!clean.length) return [];
        const { rows } = await pool.query(
            "SELECT id, username FROM users WHERE id = ANY($1) AND status = 'active' ORDER BY lower(username)",
            [clean],
        );
        return rows;
    }

    // ------------------------------------------------------------------
    // People + presence
    // ------------------------------------------------------------------
    app.get("/api/directory", requireUser, async (req, res) => {
        const { rows } = await pool.query(
            "SELECT id, username, image, role, status, last_seen FROM users ORDER BY lower(username)",
        );
        res.json(rows.map((u) => ({ ...u, image: avatarUrl(u.image), online: isOnline(u.id) })));
    });

    // One conversation (sidebar row), e.g. after being added to a group
    app.get("/api/conversations/:id", requireUser, async (req, res) => {
        const rows = await listConversations(req.user.id, int(req.params.id));
        if (!rows[0]) return res.status(404).json({ message: "That chat doesn't exist" });
        res.json(rows[0]);
    });

    // Everything a chat needs besides its messages
    app.get("/api/conversations/:id/state", requireUser, async (req, res) => {
        const id = int(req.params.id);
        if (!id || !(await accessType(req.user.id, id))) return res.status(403).json({ message: "You're not part of this conversation" });
        const g = await groupInfo(req.user.id, id);
        const [reads, pins, members, tasks] = await Promise.all([
            pool.query("SELECT user_id, last_read_id FROM conversation_reads WHERE conversation_id = $1", [id]),
            pinList(id),
            memberList(g),
            pool.query("SELECT count(*)::int AS n FROM tasks WHERE conversation_id = $1 AND NOT done", [id]),
        ]);
        res.json({
            reads: reads.rows, pins, members,
            open_tasks: tasks.rows[0].n,
            member: g.member, can_manage: g.canManage, my_role: g.my_role,
        });
    });

    async function memberList(g) {
        const { rows } = g.slug === "main"
            ? await pool.query("SELECT id, username, image, NULL AS role FROM users WHERE status = 'active' ORDER BY lower(username)")
            : await pool.query(
                  `SELECT u.id, u.username, u.image, cm.role FROM conversation_members cm
                   JOIN users u ON u.id = cm.user_id
                   WHERE cm.conversation_id = $1 ORDER BY (cm.role = 'owner') DESC, lower(u.username)`,
                  [g.id],
              );
        return rows.map((u) => ({ ...u, image: avatarUrl(u.image), online: isOnline(u.id) }));
    }

    // ------------------------------------------------------------------
    // Search: full-text over every chat you can read
    // ------------------------------------------------------------------
    app.get("/api/search", requireUser, async (req, res) => {
        const words = (String(req.query.q || "").toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []).slice(0, 8);
        if (!words.length) return res.json([]);
        const query = words.map((w) => `${w}:*`).join(" & "); // prefix match: "dep" finds "deploy"
        const only = int(req.query.conversation);
        const { rows } = await pool.query(
            `SELECT m.id, m.conversation_id, m.created_at, m.sender_id,
                    COALESCE(u.username, m.sender) AS sender,
                    CASE WHEN u.image IS NOT NULL THEN '/avatars/' || u.image END AS sender_image,
                    ts_headline('simple', m.message, to_tsquery('simple', $2),
                                'StartSel=⟦, StopSel=⟧, MaxWords=26, MinWords=10, ShortWord=1, MaxFragments=1') AS snippet,
                    c.type AS conversation_type,
                    CASE WHEN c.type = 'direct' THEN other.username ELSE c.name END AS conversation_name
             FROM chat_messages m
             JOIN conversations c ON c.id = m.conversation_id
             LEFT JOIN users u ON u.id = m.sender_id
             LEFT JOIN LATERAL (
                 SELECT ou.username FROM conversation_members cm JOIN users ou ON ou.id = cm.user_id
                 WHERE cm.conversation_id = c.id AND cm.user_id <> $1 LIMIT 1
             ) other ON c.type = 'direct'
             WHERE m.search_doc @@ to_tsquery('simple', $2)
               AND m.deleted_at IS NULL AND m.kind <> 'system'
               AND (c.slug = 'main' OR EXISTS (SELECT 1 FROM conversation_members cm
                                               WHERE cm.conversation_id = c.id AND cm.user_id = $1))
               AND ($3::int IS NULL OR m.conversation_id = $3)
             ORDER BY m.id DESC LIMIT 60`,
            [req.user.id, query, only],
        );
        res.json(rows);
    });

    // ------------------------------------------------------------------
    // Groups & channels
    // ------------------------------------------------------------------
    const GROUP_NAME = (n) => str(n, 60);

    app.get("/api/groups/browse", requireUser, async (req, res) => {
        const { rows } = await pool.query(
            `SELECT c.id, c.name, c.description, c.image,
                    (SELECT count(*)::int FROM conversation_members cm WHERE cm.conversation_id = c.id) AS member_count,
                    EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = c.id AND cm.user_id = $1) AS joined
             FROM conversations c
             WHERE c.type = 'room' AND c.is_public AND c.slug IS DISTINCT FROM 'main'
             ORDER BY lower(c.name)`,
            [req.user.id],
        );
        res.json(rows.map((c) => ({ ...c, image: avatarUrl(c.image) })));
    });

    app.post("/api/groups", requireUser, async (req, res) => {
        if (!settings.users_can_create_groups && req.user.role !== "admin") {
            return res.status(403).json({ message: "Creating groups is turned off by the admin" });
        }
        const name = GROUP_NAME(req.body.name);
        if (!name) return res.status(400).json({ message: "Give the group a name" });
        const description = str(req.body.description, 300) || null;
        const isPublic = !!req.body.is_public;
        const members = (await activeUsers(req.body.members)).filter((u) => u.id !== req.user.id);
        const client = await pool.connect();
        let id;
        try {
            await client.query("BEGIN");
            const { rows } = await client.query(
                `INSERT INTO conversations (type, name, description, is_public, created_by)
                 VALUES ('room', $1, $2, $3, $4) RETURNING id`,
                [name, description, isPublic, req.user.id],
            );
            id = rows[0].id;
            await client.query(
                "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')",
                [id, req.user.id],
            );
            if (members.length) {
                await client.query(
                    "INSERT INTO conversation_members (conversation_id, user_id) SELECT $1, unnest($2::int[])",
                    [id, members.map((u) => u.id)],
                );
            }
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
        const everyone = [req.user.id, ...members.map((u) => u.id)];
        for (const uid of everyone) io.in(`user:${uid}`).socketsJoin(`conv:${id}`);
        await system(id, actor(req), members.length
            ? `${req.user.username} created ${isPublic ? "the channel" : "the group"} and added ${names(members.map((u) => u.username))}`
            : `${req.user.username} created ${isPublic ? "the channel" : "the group"}`);
        tellUsers(everyone, "conversations:changed");
        res.status(201).json((await listConversations(req.user.id, id))[0]);
    });

    app.get("/api/groups/:id", requireUser, async (req, res) => {
        const g = await groupInfo(req.user.id, int(req.params.id));
        if (!g || g.type !== "room" || (!g.member && !g.is_public)) return res.status(404).json({ message: "That group doesn't exist" });
        const { rows } = await pool.query("SELECT description FROM conversations WHERE id = $1", [g.id]);
        res.json({
            id: g.id, name: g.name, slug: g.slug, description: rows[0].description, is_public: g.is_public,
            image: avatarUrl(g.image), my_role: g.my_role, member: g.member, can_manage: g.canManage,
            members: await memberList(g),
        });
    });

    app.patch("/api/groups/:id", requireUser, async (req, res) => {
        const g = await groupInfo(req.user.id, int(req.params.id));
        if (!g || g.type !== "room") return res.status(404).json({ message: "That group doesn't exist" });
        if (!g.canManage) return res.status(403).json({ message: g.slug === "main" ? "Only admins can change the main room" : "Only the group's owners can change it" });
        const sets = [], vals = [g.id];
        let renamed = null;
        if (req.body.name !== undefined) {
            const name = GROUP_NAME(req.body.name);
            if (!name) return res.status(400).json({ message: "Give the group a name" });
            if (name !== g.name) renamed = name;
            vals.push(name);
            sets.push(`name = $${vals.length}`);
        }
        if (req.body.description !== undefined) {
            vals.push(str(req.body.description, 300) || null);
            sets.push(`description = $${vals.length}`);
        }
        if (req.body.is_public !== undefined && g.slug !== "main") {
            vals.push(!!req.body.is_public);
            sets.push(`is_public = $${vals.length}`);
        }
        if (sets.length) await pool.query(`UPDATE conversations SET ${sets.join(", ")} WHERE id = $1`, vals);
        if (renamed) await system(g.id, actor(req), `${req.user.username} renamed this to “${renamed}”`);
        changed(g.id);
        res.json((await listConversations(req.user.id, g.id))[0] || { id: g.id });
    });

    app.post("/api/groups/:id/image", requireUser, async (req, res) => {
        const g = await groupInfo(req.user.id, int(req.params.id));
        if (!g || g.type !== "room") return res.status(404).json({ message: "That group doesn't exist" });
        if (!g.canManage) return res.status(403).json({ message: "Only the group's owners can change its picture" });
        const file = await readAvatar(req, res);
        if (!file) return;
        const saved = await saveAvatarFile(file);
        if (saved.error) return res.status(400).json({ message: saved.error });
        await pool.query("UPDATE conversations SET image = $1 WHERE id = $2", [saved.name, g.id]);
        removeAvatarFile(g.image);
        changed(g.id);
        res.json({ image: avatarUrl(saved.name) });
    });

    app.delete("/api/groups/:id/image", requireUser, async (req, res) => {
        const g = await groupInfo(req.user.id, int(req.params.id));
        if (!g || g.type !== "room") return res.status(404).json({ message: "That group doesn't exist" });
        if (!g.canManage) return res.status(403).json({ message: "Only the group's owners can change its picture" });
        await pool.query("UPDATE conversations SET image = NULL WHERE id = $1", [g.id]);
        removeAvatarFile(g.image);
        changed(g.id);
        res.json({ image: null });
    });

    app.post("/api/groups/:id/members", requireUser, async (req, res) => {
        const g = await groupInfo(req.user.id, int(req.params.id));
        if (!g || g.type !== "room" || g.slug === "main") return res.status(404).json({ message: "That group doesn't exist" });
        // owners can always add; in public channels any member can bring people in
        if (!g.canManage && !(g.is_public && g.member)) return res.status(403).json({ message: "Only the group's owners can add people" });
        const people = await activeUsers(req.body.user_ids);
        const { rows } = people.length
            ? await pool.query(
                  `INSERT INTO conversation_members (conversation_id, user_id)
                   SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING RETURNING user_id`,
                  [g.id, people.map((u) => u.id)],
              )
            : { rows: [] };
        const added = people.filter((u) => rows.some((r) => r.user_id === u.id));
        if (!added.length) return res.json({ added: [] });
        await startReadAt(g.id, added.map((u) => u.id));
        for (const u of added) io.in(`user:${u.id}`).socketsJoin(`conv:${g.id}`);
        await system(g.id, actor(req), `${req.user.username} added ${names(added.map((u) => u.username))}`);
        changed(g.id);
        res.json({ added: added.map((u) => u.id) });
    });

    app.post("/api/groups/:id/join", requireUser, async (req, res) => {
        const g = await groupInfo(req.user.id, int(req.params.id));
        if (!g || g.type !== "room" || !g.is_public || g.slug === "main") return res.status(404).json({ message: "That channel doesn't exist" });
        if (!g.member) {
            await pool.query("INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [g.id, req.user.id]);
            await startReadAt(g.id, [req.user.id]);
            io.in(`user:${req.user.id}`).socketsJoin(`conv:${g.id}`);
            await system(g.id, actor(req), `${req.user.username} joined`);
            changed(g.id);
        }
        res.json((await listConversations(req.user.id, g.id))[0]);
    });

    // Remove someone (owners) or leave (yourself)
    app.delete("/api/groups/:id/members/:userId", requireUser, async (req, res) => {
        const g = await groupInfo(req.user.id, int(req.params.id));
        const uid = int(req.params.userId);
        if (!g || g.type !== "room" || g.slug === "main" || !uid) return res.status(404).json({ message: "That group doesn't exist" });
        const self = uid === req.user.id;
        if (!self && !g.canManage) return res.status(403).json({ message: "Only the group's owners can remove people" });
        const { rows } = await pool.query(
            `DELETE FROM conversation_members cm USING users u
             WHERE cm.conversation_id = $1 AND cm.user_id = $2 AND u.id = cm.user_id
             RETURNING u.username, cm.role`,
            [g.id, uid],
        );
        if (!rows[0]) return res.json({ ok: true });
        io.in(`user:${uid}`).socketsLeave(`conv:${g.id}`);
        tellUsers([uid], "conversation:removed", { id: g.id });
        const left = await pool.query(
            "SELECT user_id, role FROM conversation_members WHERE conversation_id = $1 ORDER BY joined_at",
            [g.id],
        );
        if (!left.rows.length) {
            // last person out: the group goes away
            await pool.query("DELETE FROM conversations WHERE id = $1", [g.id]);
            removeAvatarFile(g.image);
            return res.json({ ok: true, deleted: true });
        }
        if (rows[0].role === "owner" && !left.rows.some((m) => m.role === "owner")) {
            // never leave a group without an owner: the longest-standing member takes over
            await pool.query("UPDATE conversation_members SET role = 'owner' WHERE conversation_id = $1 AND user_id = $2", [g.id, left.rows[0].user_id]);
        }
        await system(g.id, actor(req), self ? `${rows[0].username} left` : `${req.user.username} removed ${rows[0].username}`);
        changed(g.id);
        res.json({ ok: true });
    });

    app.patch("/api/groups/:id/members/:userId", requireUser, async (req, res) => {
        const g = await groupInfo(req.user.id, int(req.params.id));
        const uid = int(req.params.userId);
        if (!g || g.type !== "room" || g.slug === "main" || !uid) return res.status(404).json({ message: "That group doesn't exist" });
        if (!g.canManage) return res.status(403).json({ message: "Only the group's owners can do that" });
        const role = req.body.role === "owner" ? "owner" : "member";
        if (role === "member") {
            const { rows } = await pool.query(
                "SELECT count(*)::int AS n FROM conversation_members WHERE conversation_id = $1 AND role = 'owner' AND user_id <> $2",
                [g.id, uid],
            );
            if (!rows[0].n) return res.status(400).json({ message: "A group needs at least one owner" });
        }
        await pool.query("UPDATE conversation_members SET role = $3 WHERE conversation_id = $1 AND user_id = $2", [g.id, uid, role]);
        changed(g.id);
        res.json({ ok: true });
    });

    app.delete("/api/groups/:id", requireUser, async (req, res) => {
        const g = await groupInfo(req.user.id, int(req.params.id));
        if (!g || g.type !== "room" || g.slug === "main") return res.status(404).json({ message: "That group doesn't exist" });
        if (!g.canManage) return res.status(403).json({ message: "Only the group's owners can delete it" });
        io.to(`conv:${g.id}`).emit("conversation:removed", { id: g.id });
        io.in(`conv:${g.id}`).socketsLeave(`conv:${g.id}`);
        // files of the group's messages go too
        const { rows } = await pool.query(
            `SELECT a.stored_name FROM attachments a JOIN chat_messages m ON m.id = a.message_id WHERE m.conversation_id = $1`,
            [g.id],
        );
        await pool.query("DELETE FROM conversations WHERE id = $1", [g.id]);
        for (const r of rows) fs.unlink(path.join(UPLOAD_DIR, r.stored_name), () => {});
        removeAvatarFile(g.image);
        res.json({ ok: true });
    });

    // ------------------------------------------------------------------
    // Pins, reactions, polls, tasks: shared queries
    // ------------------------------------------------------------------
    async function pinList(conversationId) {
        const { rows } = await pool.query(
            `SELECT p.message_id, p.pinned_at, pu.username AS pinned_by,
                    COALESCE(u.username, m.sender) AS sender, left(m.message, 300) AS message, m.kind,
                    EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id) AS has_attachments
             FROM pinned_messages p
             JOIN chat_messages m ON m.id = p.message_id
             LEFT JOIN users u ON u.id = m.sender_id
             LEFT JOIN users pu ON pu.id = p.pinned_by
             WHERE p.conversation_id = $1 ORDER BY p.pinned_at DESC`,
            [conversationId],
        );
        return rows;
    }

    async function reactionsOf(messageId) {
        const { rows } = await pool.query(
            `SELECT emoji, json_agg(user_id ORDER BY created_at) AS users
             FROM message_reactions WHERE message_id = $1 GROUP BY emoji ORDER BY min(created_at)`,
            [messageId],
        );
        return rows;
    }

    async function pollOf(messageId) {
        const { rows } = await pool.query(
            `SELECT p.question, p.options, p.multi, p.closed_at IS NOT NULL AS closed,
                    (SELECT COALESCE(json_agg(json_build_object('user_id', v.user_id, 'option', v.option_index)), '[]')
                     FROM poll_votes v WHERE v.message_id = p.message_id) AS votes
             FROM polls p WHERE p.message_id = $1`,
            [messageId],
        );
        return rows[0] || null;
    }

    async function taskList(conversationId) {
        const { rows } = await pool.query(
            `SELECT t.id, t.title, t.done, t.message_id, t.created_at, t.done_at,
                    t.assignee_id, au.username AS assignee,
                    t.created_by, cu.username AS created_by_name, du.username AS done_by_name
             FROM tasks t
             LEFT JOIN users au ON au.id = t.assignee_id
             LEFT JOIN users cu ON cu.id = t.created_by
             LEFT JOIN users du ON du.id = t.done_by
             WHERE t.conversation_id = $1
             ORDER BY t.done, CASE WHEN t.done THEN t.done_at END DESC, t.created_at`,
            [conversationId],
        );
        return rows;
    }

    const emitTasks = async (conversationId) =>
        io.to(`conv:${conversationId}`).emit("tasks", { conversationId, tasks: await taskList(conversationId) });

    /** The message + whether this user may write in its chat */
    async function messageFor(user, messageId) {
        const { rows } = await pool.query(
            "SELECT id, conversation_id, sender_id, kind, deleted_at FROM chat_messages WHERE id = $1",
            [messageId],
        );
        const m = rows[0];
        if (!m) return { error: "That message doesn't exist" };
        const access = await postAccess(user.id, m.conversation_id);
        if (access.error) return { error: access.error };
        return { m, type: access.type };
    }

    // ------------------------------------------------------------------
    // Shared notes (one live document per chat)
    //   Every change is one "replace from..to with text" operation on a known version.
    //   If others changed the document meanwhile, the server shifts the operation over
    //   their changes (operational transform), so everyone ends up with the same text.
    // ------------------------------------------------------------------
    const docs = new Map(); // conversation id -> Promise<doc>
    const noteEditors = new Map(); // conversation id -> Map(socket id -> username)

    function loadDoc(id) {
        if (!docs.has(id)) {
            docs.set(id, (async () => {
                const { rows } = await pool.query(
                    `SELECT n.body, n.version, n.updated_at, u.username AS updated_by
                     FROM notes n LEFT JOIN users u ON u.id = n.updated_by WHERE n.conversation_id = $1`,
                    [id],
                );
                const r = rows[0] || { body: "", version: 0, updated_at: null, updated_by: null };
                return { id, text: r.body, version: r.version, log: [], updatedAt: r.updated_at, updatedBy: r.updated_by, userId: null, timer: null };
            })());
            docs.get(id).catch(() => docs.delete(id));
        }
        return docs.get(id);
    }

    function saveDocSoon(doc) {
        clearTimeout(doc.timer);
        doc.timer = setTimeout(async () => {
            try {
                await pool.query(
                    `INSERT INTO notes (conversation_id, body, version, updated_by, updated_at)
                     VALUES ($1, $2, $3, $4, NOW())
                     ON CONFLICT (conversation_id) DO UPDATE
                         SET body = EXCLUDED.body, version = EXCLUDED.version,
                             updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
                    [doc.id, doc.text, doc.version, doc.userId],
                );
            } catch (err) {
                console.error("notes save", err);
            }
        }, 700);
    }

    const transform = noteTransform;

    const editorNames = (id) => [...new Set((noteEditors.get(id) || new Map()).values())];
    const sendEditors = (id) => io.to(`notes:${id}`).emit("notes:editors", { conversationId: id, editors: editorNames(id) });

    // ------------------------------------------------------------------
    // Sockets
    // ------------------------------------------------------------------
    function registerSocket(socket) {
        const user = socket.user;
        const inRoom = (id) => socket.rooms.has(`conv:${id}`);
        const notesOpen = new Set();

        // typing… (not stored; the client repeats it every few seconds while typing)
        socket.on("typing", (d) => {
            const id = int(d && d.conversationId);
            if (!id || !inRoom(id)) return;
            socket.to(`conv:${id}`).emit("typing", { conversationId: id, userId: user.id, username: user.username, on: !!d.on });
        });

        // read receipts: "I've seen everything up to this message"
        socket.on("read", safe("read", async (d) => {
            const id = int(d.conversationId), mid = int(d.messageId);
            if (!id || !mid || !inRoom(id)) return;
            const { rows } = await pool.query(
                "SELECT COALESCE(max(id), 0) AS top FROM chat_messages WHERE conversation_id = $1 AND id <= $2",
                [id, mid],
            );
            if (rows[0].top) await markRead(user.id, id, rows[0].top);
        }));

        socket.on("react", safe("react", async (d, cb) => {
            const mid = int(d.messageId);
            if (!mid || !REACTIONS.includes(d.emoji)) return ack(cb, { ok: false });
            const found = await messageFor(user, mid);
            if (found.error) return ack(cb, { ok: false, message: found.error });
            if (found.m.deleted_at || found.m.kind === "system") return ack(cb, { ok: false });
            const del = await pool.query(
                "DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3",
                [mid, user.id, d.emoji],
            );
            if (!del.rowCount) {
                await pool.query("INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [mid, user.id, d.emoji]);
            }
            io.to(`conv:${found.m.conversation_id}`).emit("reactions", {
                conversationId: found.m.conversation_id, messageId: mid, reactions: await reactionsOf(mid),
            });
            ack(cb, { ok: true });
        }));

        socket.on("message:edit", safe("message:edit", async (d, cb) => {
            const mid = int(d.id);
            const text = typeof d.message === "string" ? d.message.trim() : "";
            if (!mid || text.length > 4000) return ack(cb, { ok: false, message: "That message is too long" });
            const { rows } = await pool.query(
                `SELECT m.conversation_id, m.sender_id, m.kind, m.deleted_at, m.message,
                        EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id) AS has_files
                 FROM chat_messages m WHERE m.id = $1`,
                [mid],
            );
            const m = rows[0];
            if (!m || m.sender_id !== user.id || m.kind !== "text" || m.deleted_at) {
                return ack(cb, { ok: false, message: "You can only edit your own messages" });
            }
            if (!text && !m.has_files) return ack(cb, { ok: false, message: "A message can't be empty. Delete it instead." });
            if (text === (m.message || "")) return ack(cb, { ok: true });
            await pool.query("UPDATE chat_messages SET message = $2, edited_at = NOW() WHERE id = $1", [mid, text || null]);
            const before = new Set((await pool.query("SELECT user_id FROM message_mentions WHERE message_id = $1", [mid])).rows.map((r) => r.user_id));
            const now = await saveMentions(pool, mid, m.conversation_id, text, user.id);
            const msg = await getMessage(mid);
            io.to(`conv:${m.conversation_id}`).emit("message:update", msg);
            for (const uid of now.filter((x) => !before.has(x))) {
                for (const s of socketsOf(uid)) s.emit("mention", { conversationId: m.conversation_id, message: msg });
            }
            ack(cb, { ok: true });
        }));

        // Take a message back: text, files, reactions, poll and pin all go; a "deleted" stub stays
        socket.on("message:delete", safe("message:delete", async (d, cb) => {
            const mid = int(d.id);
            const { rows } = await pool.query(
                "SELECT conversation_id, sender_id, kind, deleted_at FROM chat_messages WHERE id = $1",
                [mid],
            );
            const m = rows[0];
            if (!m || m.deleted_at || m.kind === "system") return ack(cb, { ok: false });
            if (m.sender_id !== user.id) {
                const g = await groupInfo(user.id, m.conversation_id);
                if (!g || !g.canManage) return ack(cb, { ok: false, message: "You can only delete your own messages" });
            }
            const files = await pool.query("DELETE FROM attachments WHERE message_id = $1 RETURNING stored_name", [mid]);
            for (const f of files.rows) fs.unlink(path.join(UPLOAD_DIR, f.stored_name), () => {});
            await pool.query("DELETE FROM message_reactions WHERE message_id = $1", [mid]);
            await pool.query("DELETE FROM polls WHERE message_id = $1", [mid]);
            await pool.query("DELETE FROM message_mentions WHERE message_id = $1", [mid]);
            const unpinned = await pool.query("DELETE FROM pinned_messages WHERE message_id = $1", [mid]);
            await pool.query("UPDATE chat_messages SET message = NULL, effect = NULL, deleted_at = NOW() WHERE id = $1", [mid]);
            io.to(`conv:${m.conversation_id}`).emit("message:update", await getMessage(mid));
            if (unpinned.rowCount) io.to(`conv:${m.conversation_id}`).emit("pins", { conversationId: m.conversation_id, pins: await pinList(m.conversation_id) });
            ack(cb, { ok: true });
        }));

        socket.on("pin", safe("pin", async (d, cb) => {
            const mid = int(d.messageId);
            const found = mid && (await messageFor(user, mid));
            if (!found || found.error) return ack(cb, { ok: false, message: found && found.error });
            if (found.m.deleted_at || found.m.kind === "system") return ack(cb, { ok: false });
            const conv = found.m.conversation_id;
            if (d.on) {
                const { rows } = await pool.query("SELECT count(*)::int AS n FROM pinned_messages WHERE conversation_id = $1", [conv]);
                if (rows[0].n >= MAX_PINS) return ack(cb, { ok: false, message: `You can pin up to ${MAX_PINS} messages. Unpin one first.` });
                await pool.query(
                    "INSERT INTO pinned_messages (conversation_id, message_id, pinned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
                    [conv, mid, user.id],
                );
            } else {
                await pool.query("DELETE FROM pinned_messages WHERE conversation_id = $1 AND message_id = $2", [conv, mid]);
            }
            io.to(`conv:${conv}`).emit("pins", { conversationId: conv, pins: await pinList(conv) });
            ack(cb, { ok: true });
        }));

        // ---------- polls ----------
        socket.on("poll:create", safe("poll:create", async (d, cb) => {
            const id = int(d.conversationId);
            const question = str(d.question, 300);
            const options = (Array.isArray(d.options) ? d.options : []).map((o) => str(o, 100)).filter(Boolean);
            if (!question) return ack(cb, { ok: false, message: "Ask a question" });
            if (options.length < 2 || options.length > 10) return ack(cb, { ok: false, message: "Give 2 to 10 options" });
            if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return ack(cb, { ok: false, message: "Each option needs to be different" });
            const access = await postAccess(user.id, id);
            if (access.error) return ack(cb, { ok: false, message: access.error });
            const blocked = postBlocked(access.type, false);
            if (blocked) return ack(cb, { ok: false, message: blocked });
            await createMessage({ conversationId: id, user, text: question, kind: "poll", poll: { question, options, multi: !!d.multi } });
            ack(cb, { ok: true });
        }));

        socket.on("poll:vote", safe("poll:vote", async (d, cb) => {
            const mid = int(d.messageId);
            const found = mid && (await messageFor(user, mid));
            if (!found || found.error) return ack(cb, { ok: false, message: found && found.error });
            const poll = await pollOf(mid);
            if (!poll || found.m.deleted_at) return ack(cb, { ok: false });
            if (poll.closed) return ack(cb, { ok: false, message: "This poll is closed" });
            let picks = [...new Set((Array.isArray(d.options) ? d.options : []).map(Number))]
                .filter((i) => Number.isInteger(i) && i >= 0 && i < poll.options.length);
            if (!poll.multi) picks = picks.slice(0, 1);
            const client = await pool.connect();
            try {
                await client.query("BEGIN");
                await client.query("DELETE FROM poll_votes WHERE message_id = $1 AND user_id = $2", [mid, user.id]);
                if (picks.length) {
                    await client.query(
                        "INSERT INTO poll_votes (message_id, user_id, option_index) SELECT $1, $2, unnest($3::smallint[])",
                        [mid, user.id, picks],
                    );
                }
                await client.query("COMMIT");
            } catch (err) {
                await client.query("ROLLBACK");
                throw err;
            } finally {
                client.release();
            }
            io.to(`conv:${found.m.conversation_id}`).emit("poll", { conversationId: found.m.conversation_id, messageId: mid, poll: await pollOf(mid) });
            ack(cb, { ok: true });
        }));

        socket.on("poll:close", safe("poll:close", async (d, cb) => {
            const mid = int(d.messageId);
            const found = mid && (await messageFor(user, mid));
            if (!found || found.error) return ack(cb, { ok: false });
            if (found.m.sender_id !== user.id && user.role !== "admin") return ack(cb, { ok: false, message: "Only whoever asked can close the poll" });
            await pool.query("UPDATE polls SET closed_at = COALESCE(closed_at, NOW()) WHERE message_id = $1", [mid]);
            io.to(`conv:${found.m.conversation_id}`).emit("poll", { conversationId: found.m.conversation_id, messageId: mid, poll: await pollOf(mid) });
            ack(cb, { ok: true });
        }));

        // ---------- tasks ----------
        socket.on("tasks:list", safe("tasks:list", async (d, cb) => {
            const id = int(d.conversationId);
            if (!id || !(await accessType(user.id, id))) return ack(cb, { ok: false });
            ack(cb, { ok: true, tasks: await taskList(id) });
        }));

        async function assigneeOk(conversationId, assigneeId) {
            if (!assigneeId) return true;
            const { rows } = await pool.query(
                `SELECT 1 FROM users u, conversations c WHERE u.id = $2 AND c.id = $1 AND u.status = 'active'
                   AND (c.slug = 'main' OR EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = c.id AND cm.user_id = u.id))`,
                [conversationId, assigneeId],
            );
            return rows.length > 0;
        }

        socket.on("task:add", safe("task:add", async (d, cb) => {
            const id = int(d.conversationId);
            const title = str(d.title, 500);
            if (!id || !title) return ack(cb, { ok: false, message: "Write what needs doing" });
            const access = await postAccess(user.id, id);
            if (access.error) return ack(cb, { ok: false, message: access.error });
            const { rows } = await pool.query("SELECT count(*)::int AS n FROM tasks WHERE conversation_id = $1", [id]);
            if (rows[0].n >= MAX_TASKS) return ack(cb, { ok: false, message: "This chat has too many tasks. Delete some done ones." });
            let messageId = int(d.messageId);
            if (messageId) {
                const m = await pool.query("SELECT 1 FROM chat_messages WHERE id = $1 AND conversation_id = $2", [messageId, id]);
                if (!m.rows.length) messageId = null;
            }
            const assignee = int(d.assigneeId);
            if (!(await assigneeOk(id, assignee))) return ack(cb, { ok: false, message: "That person isn't in this chat" });
            await pool.query(
                "INSERT INTO tasks (conversation_id, message_id, title, assignee_id, created_by) VALUES ($1, $2, $3, $4, $5)",
                [id, messageId, title, assignee, user.id],
            );
            await emitTasks(id);
            if (assignee && assignee !== user.id) tellUsers([assignee], "task:assigned", { conversationId: id, title, by: user.username });
            ack(cb, { ok: true });
        }));

        socket.on("task:update", safe("task:update", async (d, cb) => {
            const tid = int(d.id);
            const { rows } = await pool.query("SELECT conversation_id, assignee_id FROM tasks WHERE id = $1", [tid]);
            if (!rows[0]) return ack(cb, { ok: false });
            const id = rows[0].conversation_id;
            const access = await postAccess(user.id, id);
            if (access.error) return ack(cb, { ok: false, message: access.error });
            if (d.done !== undefined) {
                await pool.query(
                    `UPDATE tasks SET done = $2, done_by = CASE WHEN $2 THEN $3::int END, done_at = CASE WHEN $2 THEN NOW() END WHERE id = $1`,
                    [tid, !!d.done, user.id],
                );
            }
            if (d.title !== undefined) {
                const title = str(d.title, 500);
                if (!title) return ack(cb, { ok: false, message: "A task needs a title" });
                await pool.query("UPDATE tasks SET title = $2 WHERE id = $1", [tid, title]);
            }
            if (d.assigneeId !== undefined) {
                const assignee = int(d.assigneeId);
                if (!(await assigneeOk(id, assignee))) return ack(cb, { ok: false, message: "That person isn't in this chat" });
                await pool.query("UPDATE tasks SET assignee_id = $2 WHERE id = $1", [tid, assignee]);
                if (assignee && assignee !== user.id && assignee !== rows[0].assignee_id) {
                    const t = await pool.query("SELECT title FROM tasks WHERE id = $1", [tid]);
                    tellUsers([assignee], "task:assigned", { conversationId: id, title: t.rows[0].title, by: user.username });
                }
            }
            await emitTasks(id);
            ack(cb, { ok: true });
        }));

        socket.on("task:delete", safe("task:delete", async (d, cb) => {
            const tid = int(d.id);
            const { rows } = await pool.query("SELECT conversation_id, created_by FROM tasks WHERE id = $1", [tid]);
            if (!rows[0]) return ack(cb, { ok: false });
            const id = rows[0].conversation_id;
            if (rows[0].created_by !== user.id) {
                const g = await groupInfo(user.id, id);
                if (!g || !g.canManage) return ack(cb, { ok: false, message: "Only whoever added a task (or an owner) can delete it" });
            }
            await pool.query("DELETE FROM tasks WHERE id = $1", [tid]);
            await emitTasks(id);
            ack(cb, { ok: true });
        }));

        // ---------- shared notes ----------
        socket.on("notes:open", safe("notes:open", async (d, cb) => {
            const id = int(d.conversationId);
            if (!id || !(await accessType(user.id, id))) return ack(cb, { ok: false, message: "You're not part of this conversation" });
            const doc = await loadDoc(id);
            notesOpen.add(id);
            socket.join(`notes:${id}`);
            if (!noteEditors.has(id)) noteEditors.set(id, new Map());
            noteEditors.get(id).set(socket.id, user.username);
            const writable = !(await postAccess(user.id, id)).error;
            ack(cb, { ok: true, body: doc.text, version: doc.version, updated_by: doc.updatedBy, updated_at: doc.updatedAt, writable });
            sendEditors(id);
        }));

        function closeNotes(id) {
            if (!notesOpen.delete(id)) return;
            socket.leave(`notes:${id}`);
            const eds = noteEditors.get(id);
            if (eds) {
                eds.delete(socket.id);
                if (!eds.size) noteEditors.delete(id);
            }
            sendEditors(id);
        }
        socket.on("notes:close", (d) => closeNotes(int(d && d.conversationId)));

        socket.on("notes:op", safe("notes:op", async (d, cb) => {
            const id = int(d.conversationId);
            if (!id || !notesOpen.has(id)) return ack(cb, { ok: false });
            const op = d.op || {};
            const base = Number(d.base);
            if (!Number.isInteger(op.from) || !Number.isInteger(op.to) || op.from < 0 || op.to < op.from ||
                typeof op.text !== "string" || op.text.length > NOTE_MAX || !Number.isInteger(base)) return ack(cb, { ok: false });
            if ((await postAccess(user.id, id)).error) return ack(cb, { ok: false, message: "Join this chat to edit its notes" });
            const doc = await loadDoc(id);
            const oldest = doc.version - doc.log.length;
            if (base > doc.version || base < oldest) {
                return ack(cb, { ok: false, resync: true, body: doc.text, version: doc.version });
            }
            let o = { from: op.from, to: op.to, text: op.text };
            for (const entry of doc.log) if (entry.version > base) o = transform(o, entry.op, true);
            o.from = Math.min(o.from, doc.text.length);
            o.to = Math.min(Math.max(o.to, o.from), doc.text.length);
            const next = doc.text.slice(0, o.from) + o.text + doc.text.slice(o.to);
            if (next.length > NOTE_MAX) return ack(cb, { ok: false, message: "The notes are full (100,000 characters)" });
            doc.text = next;
            doc.version += 1;
            doc.log.push({ version: doc.version, op: o });
            if (doc.log.length > NOTE_LOG) doc.log.shift();
            doc.userId = user.id;
            doc.updatedBy = user.username;
            doc.updatedAt = new Date();
            saveDocSoon(doc);
            ack(cb, { ok: true, version: doc.version });
            socket.to(`notes:${id}`).emit("notes:op", { conversationId: id, version: doc.version, op: o, by: user.username });
        }));

        socket.on("disconnect", () => {
            for (const id of [...notesOpen]) closeNotes(id);
        });
    }

    return { registerSocket, REACTIONS };
};

module.exports.noteTransform = noteTransform;
