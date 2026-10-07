-- Sandes chat app - PostgreSQL schema
-- Run once:  psql -U postgres -d sandes -f schema.sql
-- (Create the DB first if needed:  CREATE DATABASE sandes;)

CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(100) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id          SERIAL PRIMARY KEY,
    sender      VARCHAR(100) NOT NULL,
    message     TEXT         NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
    ON chat_messages (created_at);

-- Optional sample user (password stored as plain text, matching current login logic)
-- INSERT INTO users (username, password) VALUES ('admin', 'admin123');
