import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, ssl: config.databaseSsl ? { rejectUnauthorized: false } : false, max: 10, idleTimeoutMillis: 30_000 });
export function query(text, values) { return pool.query(text, values); }

