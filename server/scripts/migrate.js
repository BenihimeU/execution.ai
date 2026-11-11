import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
try {
  await pool.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const applied = new Set((await pool.query("select name from schema_migrations")).rows.map((row) => row.name));
  for (const name of (await fs.readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    const client = await pool.connect();
    try { await client.query("begin"); await client.query(await fs.readFile(path.join(directory, name), "utf8")); await client.query("insert into schema_migrations (name) values ($1)", [name]); await client.query("commit"); console.log(`Applied ${name}`); }
    catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
} finally { await pool.end(); }

