import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";

const server = app.listen(config.port, () => console.log(`Execution AI API listening on http://localhost:${config.port}`));
async function shutdown() { server.close(async () => { await pool.end(); process.exit(0); }); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

