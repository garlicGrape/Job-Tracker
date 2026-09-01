import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createJob,
  deleteJob,
  fetchJobs,
  fetchStats,
  updateJob,
  JOB_STATUSES,
  type Job,
  type JobInput,
  type JobStatus,
  type Stats,
} from "./api";
import { StatusBadge } from "./components/StatusBadge";
import { JobForm } from "./components/JobForm";
import { STATUS_META } from "./statusMeta";

type Filter = JobStatus | "All";

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [jobsData, statsData] = await Promise.all([
        fetchJobs(filter),
        fetchStats(),
      ]);
      setJobs(jobsData);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (job: Job) => {
    setEditing(job);
    setModalOpen(true);
  };

  const handleSubmit = async (input: JobInput) => {
    if (editing) {
      await updateJob(editing.id, input);
    } else {
      await createJob(input);
    }
    setModalOpen(false);
    setEditing(null);
    await load();
  };

  const handleDelete = async (job: Job) => {
    if (!confirm(`Delete ${job.position} at ${job.company}?`)) return;
    await deleteJob(job.id);
    await load();
  };

  const filters = useMemo<Filter[]>(() => ["All", ...JOB_STATUSES], []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <BriefcaseIcon />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Job Tracker</h1>
              <p className="text-sm text-slate-500">
                Keep every application in one place.
              </p>
            </div>
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            <PlusIcon />
            Add application
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Total" value={stats?.total ?? 0} accent="text-indigo-600" />
          {JOB_STATUSES.map((s) => (
            <StatCard
              key={s}
              label={s}
              value={stats?.byStatus[s] ?? 0}
              accent={STATUS_META[s].accent}
            />
          ))}
        </section>

        <div className="mb-5 flex flex-wrap gap-2">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                filter === f
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-100"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        )}

        {loading ? (
          <p className="py-16 text-center text-slate-400">Loading…</p>
        ) : jobs.length === 0 ? (
          <EmptyState onAdd={openCreate} filtered={filter !== "All"} />
        ) : (
          <ul className="space-y-3">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onEdit={() => openEdit(job)}
                onDelete={() => handleDelete(job)}
              />
            ))}
          </ul>
        )}
      </main>

      {modalOpen && (
        <Modal
          title={editing ? "Edit application" : "New application"}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
        >
          <JobForm
            initial={editing}
            onCancel={() => {
              setModalOpen(false);
              setEditing(null);
            }}
            onSubmit={handleSubmit}
          />
        </Modal>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}

function JobCard({
  job,
  onEdit,
  onDelete,
}: {
  job: Job;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-slate-900">
              {job.position}
            </h3>
            <StatusBadge status={job.status} />
          </div>
          <p className="mt-0.5 text-sm text-slate-600">
            {job.company}
            {job.location ? (
              <span className="text-slate-400"> · {job.location}</span>
            ) : null}
          </p>
          {job.notes && (
            <p className="mt-2 line-clamp-2 text-sm text-slate-500">{job.notes}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
            {job.applied_on && <span>Applied {job.applied_on}</span>}
            {job.url && (
              <a
                href={job.url}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-600 hover:underline"
              >
                View posting ↗
              </a>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            onClick={onEdit}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Edit"
          >
            <PencilIcon />
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
            aria-label="Delete"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </li>
  );
}

function EmptyState({
  onAdd,
  filtered,
}: {
  onAdd: () => void;
  filtered: boolean;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
        <BriefcaseIcon />
      </div>
      <h3 className="text-base font-semibold text-slate-800">
        {filtered ? "No applications with this status" : "No applications yet"}
      </h3>
      <p className="mt-1 text-sm text-slate-500">
        {filtered
          ? "Try a different filter or add a new one."
          : "Add your first job application to get started."}
      </p>
      {!filtered && (
        <button
          onClick={onAdd}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          <PlusIcon />
          Add application
        </button>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BriefcaseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5v14" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
