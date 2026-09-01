import { createApp } from "./app.js";
import { createDb, seedIfEmpty } from "./db.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

const db = createDb();
seedIfEmpty(db);

const app = createApp(db);

const server = app.listen(port, host, () => {
  console.log(`[job-tracker] API listening on http://${host}:${port}`);
});

function shutdown(signal: string) {
  console.log(`[job-tracker] received ${signal}, shutting down...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
