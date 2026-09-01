import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type JobStatus =
  | "Wishlist"
  | "Applied"
  | "Interviewing"
  | "Offer"
  | "Rejected";

export interface Job {
  id: number;
  company: string;
  position: string;
  status: JobStatus;
  location: string;
  url: string;
  notes: string;
  applied_on: string | null;
  created_at: string;
  updated_at: string;
}

export const JOB_STATUSES: JobStatus[] = [
  "Wishlist",
  "Applied",
  "Interviewing",
  "Offer",
  "Rejected",
];

/**
 * Create (or open) the SQLite database. An in-memory database is used for tests
 * so they never touch the developer's real data file.
 */
export function createDb(filename?: string): Database.Database {
  const file =
    filename ??
    process.env.DATABASE_FILE ??
    resolve(process.cwd(), "data", "jobs.db");

  if (file !== ":memory:") {
    mkdirSync(dirname(file), { recursive: true });
  }

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      position TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Applied',
      location TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      applied_on TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

/** Seed a few example rows if the table is empty (nice first-run experience). */
export function seedIfEmpty(db: Database.Database): void {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM jobs").get() as {
    count: number;
  };
  if (count > 0) return;

  const insert = db.prepare(
    `INSERT INTO jobs (company, position, status, location, url, notes, applied_on)
     VALUES (@company, @position, @status, @location, @url, @notes, @applied_on)`,
  );
  const samples = [
    {
      company: "Acme Corp",
      position: "Senior Frontend Engineer",
      status: "Interviewing",
      location: "Remote",
      url: "https://example.com/acme/job",
      notes: "Phone screen went well. Onsite scheduled.",
      applied_on: "2026-08-20",
    },
    {
      company: "Globex",
      position: "Full Stack Developer",
      status: "Applied",
      location: "New York, NY",
      url: "https://example.com/globex/job",
      notes: "Referred by a friend.",
      applied_on: "2026-08-25",
    },
    {
      company: "Initech",
      position: "Platform Engineer",
      status: "Wishlist",
      location: "Austin, TX",
      url: "",
      notes: "Great mission, waiting for a role to open.",
      applied_on: null,
    },
  ];
  const tx = db.transaction((rows: typeof samples) => {
    for (const row of rows) insert.run(row);
  });
  tx(samples);
}
