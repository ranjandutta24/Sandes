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
-- Default user (password stored as plain text, matching current login logic)
-- ---------------------------------------------------------------
INSERT INTO sandes.users (username, password)
SELECT 'admin', 'admin123'
WHERE NOT EXISTS (SELECT 1 FROM sandes.users WHERE username = 'admin');
