import { useEffect, useState, type FormEvent } from "react";
import { JOB_STATUSES, type Job, type JobInput } from "../api";

interface JobFormProps {
  initial?: Job | null;
  onCancel: () => void;
  onSubmit: (input: JobInput) => Promise<void>;
}

const empty: JobInput = {
  company: "",
  position: "",
  status: "Applied",
  location: "",
  url: "",
  notes: "",
  applied_on: null,
};

export function JobForm({ initial, onCancel, onSubmit }: JobFormProps) {
  const [form, setForm] = useState<JobInput>(empty);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) {
      setForm({
        company: initial.company,
        position: initial.position,
        status: initial.status,
        location: initial.location,
        url: initial.url,
        notes: initial.notes,
        applied_on: initial.applied_on,
      });
    } else {
      setForm(empty);
    }
  }, [initial]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  const field =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
  const label = "mb-1 block text-sm font-medium text-slate-700";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="company">
            Company *
          </label>
          <input
            id="company"
            className={field}
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
            placeholder="Acme Corp"
            required
          />
        </div>
        <div>
          <label className={label} htmlFor="position">
            Position *
          </label>
          <input
            id="position"
            className={field}
            value={form.position}
            onChange={(e) => setForm({ ...form, position: e.target.value })}
            placeholder="Senior Engineer"
            required
          />
        </div>
        <div>
          <label className={label} htmlFor="status">
            Status
          </label>
          <select
            id="status"
            className={field}
            value={form.status}
            onChange={(e) =>
              setForm({ ...form, status: e.target.value as JobInput["status"] })
            }
          >
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="applied_on">
            Applied on
          </label>
          <input
            id="applied_on"
            type="date"
            className={field}
            value={form.applied_on ?? ""}
            onChange={(e) =>
              setForm({ ...form, applied_on: e.target.value || null })
            }
          />
        </div>
        <div>
          <label className={label} htmlFor="location">
            Location
          </label>
          <input
            id="location"
            className={field}
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder="Remote"
          />
        </div>
        <div>
          <label className={label} htmlFor="url">
            Posting URL
          </label>
          <input
            id="url"
            className={field}
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="https://..."
          />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="notes">
          Notes
        </label>
        <textarea
          id="notes"
          className={`${field} min-h-20 resize-y`}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Recruiter contact, next steps, etc."
        />
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving ? "Saving..." : initial ? "Save changes" : "Add application"}
        </button>
      </div>
    </form>
  );
}
