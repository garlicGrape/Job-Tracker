import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createAccountApiFromConfig, type AccountApi, type PublicUser } from './lib/supabase-account';
import { loadSupabaseConfig } from './lib/supabase-config';
import { applicationsToCsv, downloadCsv, parseApplicationsCsv } from './lib/csv';
import { LIMITS, assertCsvByteSize, daysBetween, todayIsoDate } from './lib/applications';
import { findDuplicate, planImport } from './lib/dedupe';
import { FOLLOW_UP_DAYS, computeMetrics, needsFollowUp, weeklyActivity } from './lib/metrics';
import {
  SORT_OPTIONS,
  STATUS_FILTERS,
  STATUS_FILTER_LABELS,
  groupByStatus,
  organizeApplications,
  type SortKey,
  type StatusFilter
} from './lib/organize';
import { STATUSES, STATUS_LABELS, type Application, type ApplicationStatus } from './lib/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Listings are unlimited, so the table renders in chunks rather than putting
// thousands of rows in the DOM at once.
const ROWS_PER_CHUNK = 250;

// Calendar weeks shown in the activity chart, current week included.
const WEEKS_SHOWN = 8;

// Segment order for the pipeline bar: closest to a job first. Neighbouring
// colors were checked for color-vision separation in this order; the 2px gaps
// and the labeled legend carry identity where hue alone is close.
const BAR_ORDER: readonly ApplicationStatus[] = ['offer', 'interviewing', 'applied', 'rejected'];

function isSafeHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function formatDisplayDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!year || month < 1 || month > 12 || !day) return iso;
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

function formatShortDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (month < 1 || month > 12 || !day) return iso;
  return `${MONTHS[month - 1]} ${day}`;
}

function percentOf(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%';
}

function formatAge(dateApplied: string, today: string): string {
  const days = daysBetween(dateApplied, today);
  if (days < 0) return 'scheduled';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? 'about a month ago' : `about ${months} months ago`;
}

function BriefcaseIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="20" height="14" x="2" y="7" rx="2" ry="2"></rect>
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
    </svg>
  );
}

type TableProps = {
  items: Application[];
  today: string;
  editingId: string | null;
  pendingDeleteId: string | null;
  busy: boolean;
  onEdit: (app: Application) => void;
  onDelete: (id: string) => void;
  onKeep: () => void;
  onStatus: (id: string, status: ApplicationStatus) => void;
};

function ApplicationsTable({
  items,
  today,
  editingId,
  pendingDeleteId,
  busy,
  onEdit,
  onDelete,
  onKeep,
  onStatus
}: TableProps) {
  return (
    <table>
      <thead>
        <tr>
          <th>Company</th>
          <th>Title</th>
          <th>Date applied</th>
          <th>Stage</th>
          <th>Posting</th>
          <th>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((app) => (
          <tr
            key={app.id}
            className={[
              editingId === app.id ? 'is-editing' : '',
              pendingDeleteId === app.id ? 'is-pending-delete' : ''
            ]
              .filter(Boolean)
              .join(' ') || undefined}
          >
            <td data-label="Company">
              <span className="cell-strong">{app.company}</span>
            </td>
            <td data-label="Title">{app.title}</td>
            <td data-label="Date applied">
              <span className="cell-stack">
                <time dateTime={app.dateApplied}>{formatDisplayDate(app.dateApplied)}</time>
                <span className="cell-sub">
                  {formatAge(app.dateApplied, today)}
                  {needsFollowUp(app, today) ? (
                    <span
                      className="cell-flag"
                      title={`Open for ${FOLLOW_UP_DAYS}+ days with no answer`}
                    >
                      Follow up
                    </span>
                  ) : null}
                </span>
              </span>
            </td>
            <td data-label="Stage">
              <select
                className={`status-select is-${app.status}`}
                value={app.status}
                disabled={busy}
                aria-label={`Stage for ${app.company} ${app.title}`}
                onChange={(e) => onStatus(app.id, e.target.value as ApplicationStatus)}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </td>
            <td data-label="Posting">
              {app.postingUrl && isSafeHttpUrl(app.postingUrl) ? (
                <a href={app.postingUrl} target="_blank" rel="noopener noreferrer">
                  View posting
                </a>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
            <td data-label="Actions">
              <div className="row-actions">
                {pendingDeleteId === app.id ? (
                  <>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onDelete(app.id)}
                      disabled={busy}
                      aria-label={`Confirm delete ${app.company} ${app.title}`}
                    >
                      Confirm delete
                    </button>
                    <button type="button" className="linkish" onClick={onKeep} disabled={busy}>
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => onEdit(app)}
                      aria-label={`Edit ${app.company} ${app.title}`}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="linkish danger-text"
                      onClick={() => onDelete(app.id)}
                      disabled={busy}
                      aria-label={`Delete ${app.company} ${app.title}`}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function App() {
  const [api, setApi] = useState<AccountApi | null>(null);
  const [configured, setConfigured] = useState(false);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [applications, setApplications] = useState<Application[]>([]);
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [dateApplied, setDateApplied] = useState(todayIsoDate);
  const [formStatus, setFormStatus] = useState<ApplicationStatus>('applied');
  const [postingUrl, setPostingUrl] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // The listing key a duplicate warning has already been shown for, so a
  // second click on Add saves the copy on purpose rather than being blocked.
  const [duplicateAck, setDuplicateAck] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [grouped, setGrouped] = useState(false);
  const [visibleCount, setVisibleCount] = useState(ROWS_PER_CHUNK);
  const [message, setMessage] = useState<{ text: string; kind: 'error' | 'success' | '' }>({
    text: '',
    kind: ''
  });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await loadSupabaseConfig({
          fetch: window.fetch.bind(window),
          configUrl: new URL('config.json', window.location.href).href,
          env: import.meta.env.DEV
            ? {
                url: import.meta.env.VITE_SUPABASE_URL,
                publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
              }
            : undefined
        });
        if (cancelled) return;
        if (!config) {
          setConfigured(false);
          return;
        }
        const nextApi = createAccountApiFromConfig(config);
        setApi(nextApi);
        setConfigured(true);
        const restored = await nextApi.restore();
        if (cancelled) return;
        if (restored) {
          setUser(restored);
          setApplications(await nextApi.list());
        }
      } catch (err) {
        if (!cancelled) {
          setConfigured(false);
          setMessage({
            text: err instanceof Error ? err.message : 'Could not load Supabase config.',
            kind: 'error'
          });
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A narrower view should start from its own first chunk, not halfway down
  // the previous one.
  useEffect(() => {
    setVisibleCount(ROWS_PER_CHUNK);
  }, [query, statusFilter, sort]);

  const today = todayIsoDate();
  const metrics = useMemo(() => computeMetrics(applications, today), [applications, today]);
  const weekly = useMemo(
    () => weeklyActivity(applications, today, WEEKS_SHOWN),
    [applications, today]
  );
  const weeklyMax = Math.max(1, ...weekly.map((week) => week.count));
  const organized = useMemo(
    () => organizeApplications(applications, { query, status: statusFilter, sort, today }),
    [applications, query, statusFilter, sort, today]
  );
  const shown = Math.min(visibleCount, organized.length);
  const visibleApplications = organized.slice(0, shown);
  const groups = useMemo(
    () => (grouped ? groupByStatus(visibleApplications) : []),
    [grouped, visibleApplications]
  );
  const filtering = query.trim() !== '' || statusFilter !== 'all';

  function filterCount(filter: StatusFilter): number {
    if (filter === 'all') return applications.length;
    if (filter === 'open') return metrics.open;
    if (filter === 'followup') return metrics.followUpCount;
    return metrics.counts[filter];
  }

  function resetForm() {
    setCompany('');
    setTitle('');
    setDateApplied(todayIsoDate());
    setFormStatus('applied');
    setPostingUrl('');
    setEditingId(null);
    setDuplicateAck(null);
  }

  async function onAuth(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === 'signup' && password !== passwordConfirm) {
        throw new Error('Passwords do not match.');
      }
      if (!api) {
        throw new Error('Supabase is not configured.');
      }
      const nextUser = mode === 'signup' ? await api.signUp(email, password) : await api.signIn(email, password);
      setUser(nextUser);
      setApplications(await api.list());
      setPassword('');
      setPasswordConfirm('');
      setMessage({ text: mode === 'signup' ? 'Account created.' : 'Signed in.', kind: 'success' });
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Could not sign in.',
        kind: 'error'
      });
    } finally {
      setBusy(false);
    }
  }

  async function onSignOut() {
    if (!api) return;
    setBusy(true);
    try {
      await api.signOut();
      setUser(null);
      setApplications([]);
      resetForm();
      setPendingDeleteId(null);
      setQuery('');
      setStatusFilter('all');
      setMessage({ text: 'Signed out.', kind: 'success' });
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Could not sign out.',
        kind: 'error'
      });
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!api) return;
    const payload = {
      company,
      title,
      dateApplied,
      status: formStatus,
      postingUrl
    };

    // Warn once before saving a second copy of a listing already tracked.
    // The acknowledgement names the row it was given for, so changing the
    // form until it collides with a different listing asks again instead of
    // carrying the approval over.
    const twin = findDuplicate(applications, payload, editingId);
    const twinKey = twin ? twin.id : null;
    if (twin && duplicateAck !== twinKey) {
      setDuplicateAck(twinKey);
      setMessage({
        text: `Already tracked: ${twin.company} — ${twin.title} on ${formatDisplayDate(
          twin.dateApplied
        )}. Submit again to save it anyway.`,
        kind: 'error'
      });
      return;
    }

    setBusy(true);
    try {
      const wasEditing = Boolean(editingId);
      const next = editingId ? await api.update(editingId, payload) : await api.add(payload);
      setApplications(next);
      resetForm();
      setPendingDeleteId(null);
      setMessage({ text: wasEditing ? 'Updated.' : 'Saved.', kind: 'success' });
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Could not save.',
        kind: 'error'
      });
    } finally {
      setBusy(false);
    }
  }

  function onEdit(app: Application) {
    setEditingId(app.id);
    setCompany(app.company);
    setTitle(app.title);
    setDateApplied(app.dateApplied);
    setFormStatus(app.status);
    setPostingUrl(app.postingUrl);
    setPendingDeleteId(null);
    setDuplicateAck(null);
    setMessage({ text: '', kind: '' });
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function onCancelEdit() {
    resetForm();
    setMessage({ text: '', kind: '' });
  }

  async function onDelete(id: string) {
    if (!api) return;
    if (pendingDeleteId !== id) {
      setPendingDeleteId(id);
      setMessage({ text: '', kind: '' });
      return;
    }
    setBusy(true);
    try {
      const next = await api.remove(id);
      setApplications(next);
      setPendingDeleteId(null);
      if (editingId === id) {
        resetForm();
      }
      setMessage({ text: 'Deleted.', kind: 'success' });
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Could not delete.',
        kind: 'error'
      });
    } finally {
      setBusy(false);
    }
  }

  async function onChangeStatus(id: string, status: ApplicationStatus) {
    if (!api) return;
    // Hold the busy lock for the round trip: two stage writes racing on one
    // row would each re-list, and the slower reply would win.
    setBusy(true);
    try {
      setApplications(await api.setStatus(id, status));
      if (editingId === id) {
        setFormStatus(status);
      }
      setMessage({ text: `Moved to ${STATUS_LABELS[status]}.`, kind: 'success' });
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Could not update the stage.',
        kind: 'error'
      });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Export what the current search and stage filter select — every match, not
   * just the chunk rendered so far. The button names that count, so a partial
   * export is never a surprise; with no filter on it is the whole account.
   */
  function onExport() {
    const rows = filtering ? organized : applications;
    downloadCsv(`job-applications-${todayIsoDate()}.csv`, applicationsToCsv(rows));
    setMessage({
      text: `Exported ${rows.length} listing${rows.length === 1 ? '' : 's'}.`,
      kind: 'success'
    });
  }

  function onImportFile(file: File) {
    try {
      assertCsvByteSize(file.size);
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Could not import CSV.',
        kind: 'error'
      });
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      setMessage({ text: 'Could not read that file.', kind: 'error' });
    };
    reader.onload = () => {
      void (async () => {
        setBusy(true);
        try {
          const text = typeof reader.result === 'string' ? reader.result : '';
          const imported = parseApplicationsCsv(text);
          if (imported.length === 0) {
            throw new Error('No valid rows found in that CSV.');
          }
          if (!api) {
            throw new Error('Supabase is not configured.');
          }
          // Re-importing a backup is the normal case, so write only what the
          // account does not already have. Parsed rows carry fresh ids, so
          // nothing downstream would catch the copies.
          const plan = planImport(imported, applications);
          if (plan.fresh.length === 0) {
            throw new Error(
              `Every row in that CSV is already tracked (${plan.skipped} skipped).`
            );
          }
          const next = await api.addMany(plan.fresh);
          setApplications(next);
          const added = `Imported ${plan.fresh.length} application${
            plan.fresh.length === 1 ? '' : 's'
          }`;
          setMessage({
            text: plan.skipped > 0 ? `${added} · skipped ${plan.skipped} already tracked.` : `${added}.`,
            kind: 'success'
          });
        } catch (err) {
          setMessage({
            text: err instanceof Error ? err.message : 'Could not import CSV.',
            kind: 'error'
          });
        } finally {
          setBusy(false);
        }
      })();
    };
    reader.readAsText(file);
  }

  const statCards = [
    { key: 'total', value: metrics.total, label: metrics.total === 1 ? 'Application' : 'Applications' },
    { key: 'open', value: metrics.open, label: 'Open' },
    { key: 'interviewing', value: metrics.counts.interviewing, label: 'Interviewing' },
    { key: 'offer', value: metrics.counts.offer, label: metrics.counts.offer === 1 ? 'Offer' : 'Offers' },
    { key: 'rejected', value: metrics.counts.rejected, label: 'Rejected' }
  ];

  const insightCards = [
    {
      key: 'response',
      value: `${metrics.responseRate}%`,
      label: 'Response rate',
      hint: `${metrics.answered} of ${metrics.total} answered`
    },
    {
      key: 'interview',
      value: `${metrics.interviewRate}%`,
      label: 'Interview rate',
      hint: `${metrics.counts.interviewing + metrics.counts.offer} reached interviews`
    },
    {
      key: 'offerRate',
      value: `${metrics.offerRate}%`,
      label: 'Offer rate',
      hint: `${metrics.rejectionRate}% rejected`
    },
    {
      key: 'pace',
      value: metrics.weeklyPace,
      label: 'Per week',
      hint: `${metrics.appliedLast30Days} in the last 30 days`
    },
    {
      key: 'recent',
      value: metrics.appliedLast7Days,
      label: 'Last 7 days',
      hint: metrics.lastAppliedDate
        ? `Latest ${formatDisplayDate(metrics.lastAppliedDate)}`
        : 'Nothing yet'
    },
    {
      key: 'wait',
      value: `${metrics.avgOpenAgeDays}d`,
      label: 'Avg open wait',
      hint: metrics.longestOpenWait
        ? `Longest ${metrics.longestOpenWait.days}d · ${metrics.longestOpenWait.company}`
        : 'Nothing open'
    },
    {
      key: 'followup',
      value: metrics.followUpCount,
      label: 'Follow up',
      hint:
        metrics.followUpCount > 0
          ? `Open ${FOLLOW_UP_DAYS}+ days with no answer`
          : 'Nothing has gone quiet'
    },
    {
      key: 'companies',
      value: metrics.distinctCompanies,
      label: metrics.distinctCompanies === 1 ? 'Company' : 'Companies',
      hint:
        metrics.distinctCompanies > 0
          ? `${(metrics.total / metrics.distinctCompanies).toFixed(1)} roles each`
          : 'No companies yet'
    }
  ];

  const tableProps = {
    today,
    editingId,
    pendingDeleteId,
    busy,
    onEdit,
    onDelete: (id: string) => void onDelete(id),
    onKeep: () => setPendingDeleteId(null),
    onStatus: (id: string, status: ApplicationStatus) => void onChangeStatus(id, status)
  };

  return (
    <div className="page">
      <div className="wrap">
        <header className="hero">
          <div className="logo">
            <BriefcaseIcon />
          </div>
          <div className="hero-copy">
            <p className="eyebrow">Personal pipeline</p>
            <h1>Job Tracker</h1>
            <p className="subtitle">
              {user
                ? `Signed in as ${user.email}. Listings stay private to this account.`
                : 'Create an account, then add listings. They persist in your Supabase database.'}
            </p>
          </div>
          {user ? (
            <button type="button" className="secondary lock-btn" onClick={() => void onSignOut()} disabled={busy}>
              Sign out
            </button>
          ) : null}
        </header>

        {!ready ? <div className="card empty">Loading…</div> : null}

        {ready && !configured ? (
          <div className="card lock-screen">
            <p className="kicker">Setup</p>
            <h2>Connect your Supabase project</h2>
            <p className="privacy-note">
              Listings live in <strong>your</strong> Supabase Postgres database. The browser uses a
              <strong> publishable</strong> key (<code>sb_publishable_...</code>), not a secret or
              legacy JWT anon key. Row-level security is what keeps other accounts out. Do not commit
              keys to git.
            </p>
            <ol className="setup-steps">
              <li>
                In Supabase: <strong>Settings → API Keys</strong> → copy the project URL and the{' '}
                <strong>publishable</strong> key.
              </li>
              <li>
                Locally copy <code>public/config.example.json</code> to <code>public/config.json</code>{' '}
                (gitignored), then restart <code>npm run dev</code>.
              </li>
              <li>
                For GitHub Pages, store the same two values as repository secrets. They are injected
                at deploy time, not committed.
              </li>
            </ol>
          </div>
        ) : null}

        {ready && configured && !user ? (
          <div className="card lock-screen">
            <div className="auth-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                className={mode === 'signin' ? 'auth-tab is-active' : 'auth-tab'}
                aria-selected={mode === 'signin'}
                onClick={() => {
                  setMode('signin');
                  setMessage({ text: '', kind: '' });
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                className={mode === 'signup' ? 'auth-tab is-active' : 'auth-tab'}
                aria-selected={mode === 'signup'}
                onClick={() => {
                  setMode('signup');
                  setMessage({ text: '', kind: '' });
                }}
              >
                Create account
              </button>
            </div>
            <h2>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
            <p className="privacy-note">
              Job listings are stored in your Supabase database, scoped to this email. Other accounts
              cannot read them. Keep as many listings as you like — there is no cap — while oversized
              or malformed rows are still rejected even if someone bypasses this form. Export CSV
              anytime as a personal backup.
            </p>
            <form className="lock-form" onSubmit={(event) => void onAuth(event)}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  minLength={8}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {mode === 'signup' ? (
                <div className="field">
                  <label htmlFor="passwordConfirm">Confirm password</label>
                  <input
                    type="password"
                    id="passwordConfirm"
                    name="passwordConfirm"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                  />
                </div>
              ) : null}
              <div className="actions">
                <span className={`msg${message.kind ? ' ' + message.kind : ''}`} role="status">
                  {message.text}
                </span>
                <button type="submit" className="primary" disabled={busy}>
                  {mode === 'signup' ? 'Create account' : 'Sign in'}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {ready && user && api ? (
          <>
            <div className="stats" aria-label="Pipeline by stage">
              {statCards.map((card) => (
                <div className={`stat is-${card.key}`} key={card.key}>
                  <span className="stat-value">{card.value}</span>
                  <span className="stat-label">{card.label}</span>
                </div>
              ))}
            </div>

            <div className="insights" aria-label="Application metrics">
              {insightCards.map((card) => (
                <div className="insight" key={card.key}>
                  <span className="insight-value">{card.value}</span>
                  <span className="insight-label">{card.label}</span>
                  <span className="insight-hint">{card.hint}</span>
                </div>
              ))}
            </div>

            {metrics.total > 0 ? (
              <div className="charts">
                <div className="card chart-card">
                  <div className="chart-head">
                    <h3>Pipeline</h3>
                    <p className="chart-lede">Where every listing stands right now.</p>
                  </div>
                  <div
                    className="pipeline-bar"
                    role="img"
                    aria-label={BAR_ORDER.map(
                      (status) => `${STATUS_LABELS[status]} ${metrics.counts[status]}`
                    ).join(', ')}
                  >
                    {BAR_ORDER.filter((status) => metrics.counts[status] > 0).map((status) => (
                      <span
                        key={status}
                        className={`pipeline-segment is-${status}`}
                        style={{ flexGrow: metrics.counts[status] }}
                        title={`${STATUS_LABELS[status]}: ${metrics.counts[status]} (${percentOf(
                          metrics.counts[status],
                          metrics.total
                        )})`}
                      />
                    ))}
                  </div>
                  <ul className="legend">
                    {BAR_ORDER.map((status) => (
                      <li key={status}>
                        <span className={`swatch is-${status}`} aria-hidden="true" />
                        <span className="legend-label">{STATUS_LABELS[status]}</span>
                        <span className="legend-value">
                          {metrics.counts[status]}
                          <span className="muted"> · {percentOf(metrics.counts[status], metrics.total)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="card chart-card">
                  <div className="chart-head">
                    <h3>Applications per week</h3>
                    <p className="chart-lede">Last {WEEKS_SHOWN} weeks, Monday to Sunday.</p>
                  </div>
                  <div
                    className="weekly"
                    role="img"
                    aria-label={weekly
                      .map((week) => `week of ${formatShortDate(week.weekStart)}: ${week.count}`)
                      .join(', ')}
                  >
                    {weekly.map((week, index) => {
                      const isCurrent = index === weekly.length - 1;
                      return (
                        <div
                          key={week.weekStart}
                          className={isCurrent ? 'week is-current' : 'week'}
                          title={`Week of ${formatDisplayDate(week.weekStart)}: ${week.count} application${
                            week.count === 1 ? '' : 's'
                          }`}
                        >
                          <span className="week-count">{week.count > 0 ? week.count : ''}</span>
                          <span className="week-track">
                            <span
                              className="week-bar"
                              style={{ height: `${(week.count / weeklyMax) * 100}%` }}
                            />
                          </span>
                          <span className="week-label">
                            {isCurrent ? 'This wk' : formatShortDate(week.weekStart)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="card form-card">
              <div className="card-head">
                <h2>{editingId ? 'Edit application' : 'Add an application'}</h2>
                {editingId ? (
                  <p className="editing-note">Save or cancel when you are done.</p>
                ) : (
                  <p className="card-lede">Company, title, and date are required.</p>
                )}
              </div>
              <form className="app-form" onSubmit={(event) => void onSubmit(event)} ref={formRef}>
                <div className="field">
                  <label htmlFor="company">Company</label>
                  <input
                    type="text"
                    id="company"
                    name="company"
                    placeholder="Acme Corp"
                    required
                    maxLength={LIMITS.maxCompanyLength}
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="title">Title</label>
                  <input
                    type="text"
                    id="title"
                    name="title"
                    placeholder="Senior Engineer"
                    required
                    maxLength={LIMITS.maxTitleLength}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="dateApplied">Date applied</label>
                  <input
                    type="date"
                    id="dateApplied"
                    name="dateApplied"
                    required
                    value={dateApplied}
                    onChange={(e) => setDateApplied(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="status">Stage</label>
                  <select
                    id="status"
                    name="status"
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as ApplicationStatus)}
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field field-wide">
                  <label htmlFor="postingUrl">Posting URL</label>
                  <input
                    type="text"
                    id="postingUrl"
                    name="postingUrl"
                    inputMode="url"
                    placeholder="https://jobs.example.com/role"
                    maxLength={LIMITS.maxPostingUrlLength}
                    value={postingUrl}
                    onChange={(e) => setPostingUrl(e.target.value)}
                  />
                </div>
                <div className="actions">
                  <span className={`msg${message.kind ? ' ' + message.kind : ''}`} role="status">
                    {message.text}
                  </span>
                  {editingId ? (
                    <button type="button" className="secondary" onClick={onCancelEdit} disabled={busy}>
                      Cancel
                    </button>
                  ) : null}
                  <button type="submit" className="primary" disabled={busy}>
                    {editingId ? 'Save changes' : 'Add application'}
                  </button>
                </div>
              </form>
            </div>

            <div className="section-head">
              <div>
                <h2>Your applications</h2>
                <p className="section-lede">
                  {applications.length === 0
                    ? 'Nothing here yet.'
                    : shown < organized.length
                      ? `Showing ${shown} of ${organized.length} · change a stage inline, or edit any row`
                      : filtering
                        ? `${organized.length} of ${applications.length} shown`
                        : `${applications.length} saved · change a stage inline, or edit any row`}
                </p>
              </div>
              <div className="toolbar">
                <input
                  ref={fileRef}
                  className="file-input"
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="Import CSV"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onImportFile(file);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                >
                  Import CSV
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={onExport}
                  disabled={applications.length === 0}
                >
                  {filtering && organized.length !== applications.length
                    ? `Export ${organized.length} matching`
                    : 'Export CSV'}
                </button>
              </div>
            </div>

            {applications.length > 0 ? (
              <div className="organizer">
                <div className="filter-chips" role="group" aria-label="Filter by stage">
                  {STATUS_FILTERS.map((filter) => (
                    <button
                      type="button"
                      key={filter}
                      className={
                        statusFilter === filter ? `chip is-active is-${filter}` : `chip is-${filter}`
                      }
                      aria-pressed={statusFilter === filter}
                      onClick={() => setStatusFilter(filter)}
                    >
                      {STATUS_FILTER_LABELS[filter]}
                      <span className="chip-count">{filterCount(filter)}</span>
                    </button>
                  ))}
                </div>
                <div className="organizer-controls">
                  <div className="search-field">
                    <label className="sr-only" htmlFor="search">
                      Search company, title, or URL
                    </label>
                    <input
                      type="search"
                      id="search"
                      placeholder="Search company or title…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <div className="sort-field">
                    <label className="sr-only" htmlFor="sort">
                      Sort listings
                    </label>
                    <select
                      id="sort"
                      value={sort}
                      onChange={(e) => setSort(e.target.value as SortKey)}
                    >
                      {SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className={grouped ? 'secondary is-on' : 'secondary'}
                    aria-pressed={grouped}
                    onClick={() => setGrouped((on) => !on)}
                  >
                    {grouped ? 'Ungroup' : 'Group by stage'}
                  </button>
                </div>
              </div>
            ) : null}

            {applications.length === 0 ? (
              <div className="card empty">
                <div className="empty-icon" aria-hidden="true">
                  <BriefcaseIcon />
                </div>
                <p className="empty-title">No applications yet</p>
                <p>Add your first listing above, or import a CSV backup.</p>
              </div>
            ) : organized.length === 0 ? (
              <div className="card empty">
                <p className="empty-title">Nothing matches those filters</p>
                <p>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => {
                      setQuery('');
                      setStatusFilter('all');
                    }}
                  >
                    Clear the search and stage filter
                  </button>
                </p>
              </div>
            ) : grouped ? (
              <div className="group-list">
                {groups.map((group) => (
                  <section className={`group is-${group.status}`} key={group.status}>
                    <div className="group-head">
                      <h3>{group.label}</h3>
                      <span className="group-count">{group.items.length}</span>
                    </div>
                    <div className="table-scroll">
                      <ApplicationsTable items={group.items} {...tableProps} />
                    </div>
                  </section>
                ))}
                {shown < organized.length ? (
                  <div className="show-more">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setVisibleCount((n) => n + ROWS_PER_CHUNK)}
                    >
                      Show {Math.min(ROWS_PER_CHUNK, organized.length - shown)} more
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="table-scroll">
                <ApplicationsTable items={visibleApplications} {...tableProps} />
                {shown < organized.length ? (
                  <div className="show-more">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setVisibleCount((n) => n + ROWS_PER_CHUNK)}
                    >
                      Show {Math.min(ROWS_PER_CHUNK, organized.length - shown)} more
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
