import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import type Database from "better-sqlite3";
import { JOB_STATUSES, type Job, type JobStatus } from "./db.js";

interface JobInput {
  company: string;
  position: string;
  status: JobStatus;
  location: string;
  url: string;
  notes: string;
  applied_on: string | null;
}

function validateJob(body: unknown): { data?: JobInput; error?: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "Request body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;

  const company = typeof b.company === "string" ? b.company.trim() : "";
  const position = typeof b.position === "string" ? b.position.trim() : "";
  if (!company) return { error: "company is required." };
  if (!position) return { error: "position is required." };

  const status = (typeof b.status === "string" ? b.status : "Applied") as JobStatus;
  if (!JOB_STATUSES.includes(status)) {
    return { error: `status must be one of: ${JOB_STATUSES.join(", ")}.` };
  }

  return {
    data: {
      company,
      position,
      status,
      location: typeof b.location === "string" ? b.location.trim() : "",
      url: typeof b.url === "string" ? b.url.trim() : "",
      notes: typeof b.notes === "string" ? b.notes : "",
      applied_on:
        typeof b.applied_on === "string" && b.applied_on.trim()
          ? b.applied_on.trim()
          : null,
    },
  };
}

export function createApp(db: Database.Database): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const api = express.Router();

  api.get("/health", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  api.get("/statuses", (_req, res) => {
    res.json(JOB_STATUSES);
  });

  api.get("/stats", (_req, res) => {
    const rows = db
      .prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status")
      .all() as { status: JobStatus; count: number }[];
    const byStatus = Object.fromEntries(
      JOB_STATUSES.map((s) => [s, 0]),
    ) as Record<JobStatus, number>;
    let total = 0;
    for (const row of rows) {
      byStatus[row.status] = row.count;
      total += row.count;
    }
    res.json({ total, byStatus });
  });

  api.get("/jobs", (req, res) => {
    const status = req.query.status;
    let jobs: Job[];
    if (typeof status === "string" && JOB_STATUSES.includes(status as JobStatus)) {
      jobs = db
        .prepare("SELECT * FROM jobs WHERE status = ? ORDER BY updated_at DESC")
        .all(status) as Job[];
    } else {
      jobs = db
        .prepare("SELECT * FROM jobs ORDER BY updated_at DESC")
        .all() as Job[];
    }
    res.json(jobs);
  });

  api.get("/jobs/:id", (req, res) => {
    const job = db
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(req.params.id) as Job | undefined;
    if (!job) {
      res.status(404).json({ error: "Job not found." });
      return;
    }
    res.json(job);
  });

  api.post("/jobs", (req, res) => {
    const { data, error } = validateJob(req.body);
    if (error || !data) {
      res.status(400).json({ error });
      return;
    }
    const result = db
      .prepare(
        `INSERT INTO jobs (company, position, status, location, url, notes, applied_on)
         VALUES (@company, @position, @status, @location, @url, @notes, @applied_on)`,
      )
      .run(data);
    const job = db
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(result.lastInsertRowid) as Job;
    res.status(201).json(job);
  });

  api.put("/jobs/:id", (req, res) => {
    const existing = db
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(req.params.id) as Job | undefined;
    if (!existing) {
      res.status(404).json({ error: "Job not found." });
      return;
    }
    const { data, error } = validateJob(req.body);
    if (error || !data) {
      res.status(400).json({ error });
      return;
    }
    db.prepare(
      `UPDATE jobs
         SET company = @company,
             position = @position,
             status = @status,
             location = @location,
             url = @url,
             notes = @notes,
             applied_on = @applied_on,
             updated_at = datetime('now')
       WHERE id = @id`,
    ).run({ ...data, id: Number(req.params.id) });
    const job = db
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(req.params.id) as Job;
    res.json(job);
  });

  api.delete("/jobs/:id", (req, res) => {
    const result = db
      .prepare("DELETE FROM jobs WHERE id = ?")
      .run(req.params.id);
    if (result.changes === 0) {
      res.status(404).json({ error: "Job not found." });
      return;
    }
    res.status(204).end();
  });

  app.use("/api", api);

  // JSON 404 for unknown API routes.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found." });
  });

  // Centralized error handler.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error." });
  });

  return app;
}
