-- Sandes chat app - PostgreSQL schema (schema: sandes)
-- Runs automatically on every app start; every statement is safe to re-run.
-- Manual run:  psql -U postgres -d sandes -f schema.sql

CREATE SCHEMA IF NOT EXISTS sandes;

-- ---------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sandes.users (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(100) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- Conversations: the main room (and any future rooms) + 1-to-1 chats
--   type = 'room'   -> group room; is_public rooms are open to every user
--   type = 'direct' -> private chat between exactly two users
--   direct_key      -> "<smaller user id>:<larger user id>", keeps one chat per pair
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sandes.conversations (
    id          SERIAL PRIMARY KEY,
    type        VARCHAR(10)  NOT NULL CHECK (type IN ('room', 'direct')),
    name        VARCHAR(100),
    slug        VARCHAR(50)  UNIQUE,
    is_public   BOOLEAN      NOT NULL DEFAULT FALSE,
    direct_key  VARCHAR(50)  UNIQUE,
    created_by  INTEGER      REFERENCES sandes.users (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CHECK (type <> 'direct' OR direct_key IS NOT NULL)
);

-- Who belongs to which conversation (both users of a direct chat)
CREATE TABLE IF NOT EXISTS sandes.conversation_members (
    conversation_id  INTEGER     NOT NULL REFERENCES sandes.conversations (id) ON DELETE CASCADE,
    user_id          INTEGER     NOT NULL REFERENCES sandes.users (id) ON DELETE CASCADE,
    joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_members_user
    ON sandes.conversation_members (user_id);

-- The main room everyone shares
INSERT INTO sandes.conversations (type, name, slug, is_public)
SELECT 'room', 'Main room', 'main', TRUE
WHERE NOT EXISTS (SELECT 1 FROM sandes.conversations WHERE slug = 'main');

-- ---------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sandes.chat_messages (
    id          SERIAL PRIMARY KEY,
    sender      VARCHAR(100) NOT NULL,
    message     TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Upgrade older installs: link messages to a conversation and a sender user
ALTER TABLE sandes.chat_messages
    ADD COLUMN IF NOT EXISTS conversation_id INTEGER
        REFERENCES sandes.conversations (id) ON DELETE CASCADE;
ALTER TABLE sandes.chat_messages
    ADD COLUMN IF NOT EXISTS sender_id INTEGER
        REFERENCES sandes.users (id) ON DELETE SET NULL;
-- message text is optional now (a message can be attachments only)
ALTER TABLE sandes.chat_messages ALTER COLUMN message DROP NOT NULL;

-- Existing messages belong to the main room
UPDATE sandes.chat_messages
SET conversation_id = (SELECT id FROM sandes.conversations WHERE slug = 'main')
WHERE conversation_id IS NULL;

UPDATE sandes.chat_messages m
SET sender_id = u.id
FROM sandes.users u
WHERE m.sender_id IS NULL AND u.username = m.sender;

ALTER TABLE sandes.chat_messages ALTER COLUMN conversation_id SET NOT NULL;

DROP INDEX IF EXISTS sandes.idx_chat_messages_created_at;
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
    ON sandes.chat_messages (conversation_id, created_at);

-- ---------------------------------------------------------------
-- Attachments (files are stored on disk in ./uploads, metadata here)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sandes.attachments (
    id           SERIAL PRIMARY KEY,
    message_id   INTEGER      NOT NULL REFERENCES sandes.chat_messages (id) ON DELETE CASCADE,
    file_name    VARCHAR(255) NOT NULL,          -- original name shown to users
    stored_name  VARCHAR(255) NOT NULL UNIQUE,   -- random name on disk
    mime_type    VARCHAR(150) NOT NULL,
    size_bytes   BIGINT       NOT NULL CHECK (size_bytes >= 0),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_message
    ON sandes.attachments (message_id);

-- ---------------------------------------------------------------
-- Shared drawing board: one board per conversation, one row per drawn shape
--   item_key -> id made by the browser, so everyone can refer to the same shape
--   data     -> {"t": "pen|line|arrow|rect|ellipse|text", "c": "#rrggbb", "w": width,
--                "p": [x1, y1, x2, y2, ...], "s": "label text", "f": filled?}
--               coordinates are on a fixed 1600 x 1000 board
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sandes.board_items (
    id               BIGSERIAL    PRIMARY KEY,
    conversation_id  INTEGER      NOT NULL REFERENCES sandes.conversations (id) ON DELETE CASCADE,
    item_key         VARCHAR(32)  NOT NULL,
    author_id        INTEGER      REFERENCES sandes.users (id) ON DELETE SET NULL,
    data             JSONB        NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (conversation_id, item_key)
);

-- ---------------------------------------------------------------
-- Users: login ID, role, status, profile picture
--   user_id  -> fixed login code (e.g. SND0001), never changes; log in with it or the username
--   role     -> 'admin' (manages users + settings) or 'user'
--   status   -> 'active' or 'inactive' (inactive users can't sign in)
--   image    -> file name of the profile picture in ./uploads/avatars (NULL = initials)
--   password -> "scrypt$<salt>$<hash>". Plain-text passwords from older installs (or typed
--               in by hand with INSERT) still work and are hashed on the next sign-in.
-- ---------------------------------------------------------------
ALTER TABLE sandes.users ADD COLUMN IF NOT EXISTS user_id VARCHAR(30);
ALTER TABLE sandes.users ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'user'
    CHECK (role IN ('admin', 'user'));
ALTER TABLE sandes.users ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive'));
ALTER TABLE sandes.users ADD COLUMN IF NOT EXISTS image VARCHAR(255);
ALTER TABLE sandes.users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- New users get SND + their number (SND0007) unless a user_id is given
CREATE OR REPLACE FUNCTION sandes.users_default_user_id() RETURNS trigger AS $$
DECLARE
    candidate TEXT := 'SND' || lpad(NEW.id::text, 4, '0');
    n INTEGER := 1;
BEGIN
    IF NEW.user_id IS NULL OR btrim(NEW.user_id) = '' THEN
        WHILE EXISTS (SELECT 1 FROM sandes.users WHERE lower(user_id) = lower(candidate)) LOOP
            candidate := 'SND' || lpad(NEW.id::text, 4, '0') || '-' || n;
            n := n + 1;
        END LOOP;
        NEW.user_id := candidate;
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_default_user_id ON sandes.users;
CREATE TRIGGER users_default_user_id
    BEFORE INSERT ON sandes.users
    FOR EACH ROW EXECUTE FUNCTION sandes.users_default_user_id();

UPDATE sandes.users SET user_id = 'SND' || lpad(id::text, 4, '0') WHERE user_id IS NULL;
ALTER TABLE sandes.users ALTER COLUMN user_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_user_id_lower ON sandes.users (lower(user_id));

-- Upgrading: the existing "admin" account becomes the first admin
UPDATE sandes.users SET role = 'admin'
WHERE username = 'admin'
  AND NOT EXISTS (SELECT 1 FROM sandes.users WHERE role = 'admin');

-- Fresh install (no admin at all): create admin / admin123. Change it after signing in.
INSERT INTO sandes.users (username, password, role)
SELECT 'admin', 'admin123', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM sandes.users WHERE role = 'admin')
  AND NOT EXISTS (SELECT 1 FROM sandes.users WHERE username = 'admin');

-- ---------------------------------------------------------------
-- App settings, changed by admins (key -> JSON value)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sandes.settings (
    key         VARCHAR(50)  PRIMARY KEY,
    value       JSONB        NOT NULL,
    updated_by  INTEGER      REFERENCES sandes.users (id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO sandes.settings (key, value) VALUES
    ('crackers_enabled',          'true'),  -- Diwali crackers in chats
    ('board_enabled',             'true'),  -- shared drawing board
    ('attachments_enabled',       'true'),  -- sending files
    ('direct_messages_enabled',   'true'),  -- private 1-to-1 chats
    ('users_can_change_username', 'true'),  -- users rename themselves
    ('users_can_change_picture',  'true')   -- users set their own profile picture
ON CONFLICT (key) DO NOTHING;
