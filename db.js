const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "postgres",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "root",
  // All unqualified table names (users, chat_messages) resolve to the "sandes" schema
  options: "-c search_path=sandes",
});

// Connect and create tables (if missing) from schema.sql on startup
pool.ready = pool
  .query(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"))
  .then(() => console.log("Connected to PostgreSQL, tables ready"))
  .catch((err) => {
    console.error("PostgreSQL init error:", err);
    process.exit(1);
  });

module.exports = pool;
