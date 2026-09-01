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

export interface JobInput {
  company: string;
  position: string;
  status: JobStatus;
  location: string;
  url: string;
  notes: string;
  applied_on: string | null;
}

export interface Stats {
  total: number;
  byStatus: Record<JobStatus, number>;
}

export const JOB_STATUSES: JobStatus[] = [
  "Wishlist",
  "Applied",
  "Interviewing",
  "Offer",
  "Rejected",
];

const BASE = "/api";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function fetchJobs(status?: JobStatus | "All"): Promise<Job[]> {
  const query =
    status && status !== "All" ? `?status=${encodeURIComponent(status)}` : "";
  return handle<Job[]>(await fetch(`${BASE}/jobs${query}`));
}

export async function fetchStats(): Promise<Stats> {
  return handle<Stats>(await fetch(`${BASE}/stats`));
}

export async function createJob(input: JobInput): Promise<Job> {
  return handle<Job>(
    await fetch(`${BASE}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function updateJob(id: number, input: JobInput): Promise<Job> {
  return handle<Job>(
    await fetch(`${BASE}/jobs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteJob(id: number): Promise<void> {
  return handle<void>(await fetch(`${BASE}/jobs/${id}`, { method: "DELETE" }));
}
