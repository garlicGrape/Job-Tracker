import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

// Listings are unlimited, so the list renders in chunks rather than putting
// thousands of rows in the DOM at once.
const ROWS_PER_CHUNK = 250;

// Calendar weeks shown in the activity chart, current week included.
const WEEKS_SHOWN = 8;

// Segment order for the pipeline bar: closest to a job first. Neighbouring
// colors were checked for color-vision separation in this order; the gaps and
// the labeled legend carry identity where hue alone is close.
const BAR_ORDER: readonly ApplicationStatus[] = ['offer', 'interviewing', 'applied', 'rejected'];

const THEME_KEY = 'job-tracker.theme';

type Theme = 'light' | 'dark';
type ViewMode = 'list' | 'board';
type Message = { text: string; kind: 'error' | 'success' | '' };

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

/**
 * Up to two letters for a company badge. Split on code points so an accented
 * or emoji-leading name does not get cut in half.
 */
function initialsOf(company: string): string {
  const words = company.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return [...words[0]].slice(0, 2).join('').toUpperCase();
  return ([...words[0]][0] + [...words[1]][0]).toUpperCase();
}

/**
 * A stable hue per company, derived from its name rather than stored. The same
 * employer keeps the same badge colour across sessions and devices, which is
 * what makes a long list scannable; saturation and lightness are fixed in CSS
 * so every hue lands at the same contrast.
 */
function hueOf(company: string): number {
  const name = company.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % 100_003;
  }
  return Math.round((hash * 137.508) % 360);
}

function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Scroll an element clear of the sticky app bar rather than under it. */
function scrollIntoViewBelowBar(el: HTMLElement | null) {
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 76;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

/* ---------------------------------------------------------------- icons -- */

type IconProps = { size?: number };

function Icon({ size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const BriefcaseIcon = ({ size = 18 }: IconProps) => (
  <Icon size={size}>
    <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </Icon>
);

const SearchIcon = ({ size = 16 }: IconProps) => (
  <Icon size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </Icon>
);

const PlusIcon = ({ size = 16 }: IconProps) => (
  <Icon size={size}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

const CloseIcon = ({ size = 16 }: IconProps) => (
  <Icon size={size}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);

const PencilIcon = ({ size = 16 }: IconProps) => (
  <Icon size={size}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Icon>
);

const TrashIcon = ({ size = 16 }: IconProps) => (
  <Icon size={size}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </Icon>
);

const LinkIcon = ({ size = 14 }: IconProps) => (
  <Icon size={size}>
    <path d="M14 3h7v7" />
    <path d="M10 14 21 3" />
    <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
  </Icon>
);

const UploadIcon = ({ size = 15 }: IconProps) => (
  <Icon size={size}>
    <path d="M12 16V4M8 8l4-4 4 4" />
    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Icon>
);

const DownloadIcon = ({ size = 15 }: IconProps) => (
  <Icon size={size}>
    <path d="M12 4v12M8 12l4 4 4-4" />
    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Icon>
);

const ListIcon = ({ size = 15 }: IconProps) => (
  <Icon size={size}>
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </Icon>
);

const BoardIcon = ({ size = 15 }: IconProps) => (
  <Icon size={size}>
    <rect x="3" y="4" width="6" height="16" rx="1.5" />
    <rect x="15" y="4" width="6" height="10" rx="1.5" />
  </Icon>
);

const SunIcon = ({ size = 16 }: IconProps) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

const MoonIcon = ({ size = 16 }: IconProps) => (
  <Icon size={size}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </Icon>
);

/* ----------------------------------------------------------- fragments -- */

function Monogram({ company, size }: { company: string; size?: number }) {
  const style = {
    '--mono-h': hueOf(company),
    ...(size ? { width: `${size}px`, height: `${size}px` } : {})
  } as React.CSSProperties;
  return (
    <span className="mono" style={style} aria-hidden="true">
      {initialsOf(company)}
    </span>
  );
}

function StageSelect({
  app,
  busy,
  onStatus
}: {
  app: Application;
  busy: boolean;
  onStatus: (id: string, status: ApplicationStatus) => void;
}) {
  return (
    <select
      className={`status-select is-${app.status}`}
      value={app.status}
      disabled={busy}
      aria-label={`Stage for ${app.title} at ${app.company}`}
      onChange={(event) => onStatus(app.id, event.target.value as ApplicationStatus)}
    >
      {STATUSES.map((status) => (
        <option key={status} value={status}>
          {STATUS_LABELS[status]}
        </option>
      ))}
    </select>
  );
}

function FollowUpFlag() {
  return (
    <span className="flag" title={`Open for ${FOLLOW_UP_DAYS}+ days with no answer`}>
      Follow up
    </span>
  );
}

function PostingLink({ url }: { url: string }) {
  if (!url || !isSafeHttpUrl(url)) return <span className="muted">—</span>;
  return (
    <a className="posting-link" href={url} target="_blank" rel="noopener noreferrer">
      <LinkIcon />
      Posting
    </a>
  );
}

type RowActionsProps = {
  app: Application;
  busy: boolean;
  pendingDelete: boolean;
  onEdit: (app: Application) => void;
  onDelete: (id: string) => void;
  onKeep: () => void;
};

function RowActions({ app, busy, pendingDelete, onEdit, onDelete, onKeep }: RowActionsProps) {
  if (pendingDelete) {
    return (
      <div className="confirm-actions">
        <button type="button" className="linkish" onClick={onKeep} disabled={busy}>
          Keep
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => onDelete(app.id)}
          disabled={busy}
          aria-label={`Confirm delete ${app.title} at ${app.company}`}
        >
          Delete
        </button>
      </div>
    );
  }
  return (
    <div className="row-actions">
      <button
        type="button"
        className="icon-btn"
        title="Edit"
        onClick={() => onEdit(app)}
        aria-label={`Edit ${app.title} at ${app.company}`}
      >
        <PencilIcon />
      </button>
      <button
        type="button"
        className="icon-btn is-danger"
        title="Delete"
        onClick={() => onDelete(app.id)}
        disabled={busy}
        aria-label={`Delete ${app.title} at ${app.company}`}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

type ListProps = {
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

/**
 * One table on a wide screen; the same rows restyle into cards under 760px,
 * where every cell is placed by `data-cell` into a small grid. Nothing is
 * duplicated in the DOM, so a long list stays one node per row either way.
 */
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
}: ListProps) {
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Company</th>
          <th scope="col">Role</th>
          <th scope="col">Applied</th>
          <th scope="col">Stage</th>
          <th scope="col">Posting</th>
          <th scope="col">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((app) => {
          const classes = [
            editingId === app.id ? 'is-editing' : '',
            pendingDeleteId === app.id ? 'is-pending-delete' : ''
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <tr key={app.id} className={classes || undefined}>
              <td data-cell="company">
                <span className="company-cell">
                  <Monogram company={app.company} />
                  <span className="company-name">{app.company}</span>
                </span>
              </td>
              <td data-cell="title">
                <span className="role-title">{app.title}</span>
              </td>
              <td data-cell="date">
                <span className="date-stack">
                  <time dateTime={app.dateApplied}>{formatDisplayDate(app.dateApplied)}</time>
                  <span className="date-sub">
                    {formatAge(app.dateApplied, today)}
                    {needsFollowUp(app, today) ? <FollowUpFlag /> : null}
                  </span>
                </span>
              </td>
              <td data-cell="stage">
                <StageSelect app={app} busy={busy} onStatus={onStatus} />
              </td>
              <td data-cell="posting">
                <PostingLink url={app.postingUrl} />
              </td>
              <td data-cell="actions">
                <RowActions
                  app={app}
                  busy={busy}
                  pendingDelete={pendingDeleteId === app.id}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onKeep={onKeep}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Board view: one column per stage, every stage always present. Seeing an
 * empty Interviewing column next to a full Applied one is the whole point, so
 * columns are never dropped for being empty.
 */
function ApplicationsBoard({
  items,
  today,
  editingId,
  pendingDeleteId,
  busy,
  onEdit,
  onDelete,
  onKeep,
  onStatus
}: ListProps) {
  const columns = groupByStatus(items, { includeEmpty: true });
  return (
    <div className="board">
      {columns.map((column) => (
        <section className={`board-col is-${column.status}`} key={column.status}>
          <div className="board-head">
            <h3>{column.label}</h3>
            <span className="board-count">{column.items.length}</span>
          </div>
          <span className="board-rail" aria-hidden="true" />
          {column.items.length === 0 ? (
            <p className="board-empty">Nothing here</p>
          ) : (
            <ul className="board-items">
              {column.items.map((app) => {
                const classes = [
                  'board-card',
                  editingId === app.id ? 'is-editing' : '',
                  pendingDeleteId === app.id ? 'is-pending-delete' : ''
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <li className={classes} key={app.id}>
                    <div className="board-card-top">
                      <Monogram company={app.company} />
                      <span className="board-card-text">
                        <span className="board-card-title">{app.title}</span>
                        <span className="board-card-company">{app.company}</span>
                      </span>
                    </div>
                    <div className="board-card-meta">
                      <time dateTime={app.dateApplied}>{formatShortDate(app.dateApplied)}</time>
                      <span aria-hidden="true">·</span>
                      <span>{formatAge(app.dateApplied, today)}</span>
                      {needsFollowUp(app, today) ? <FollowUpFlag /> : null}
                      {app.postingUrl && isSafeHttpUrl(app.postingUrl) ? (
                        <PostingLink url={app.postingUrl} />
                      ) : null}
                    </div>
                    <div className="board-card-foot">
                      <StageSelect app={app} busy={busy} onStatus={onStatus} />
                      <RowActions
                        app={app}
                        busy={busy}
                        pendingDelete={pendingDeleteId === app.id}
                        onEdit={onEdit}
                        onDelete={onDelete}
                        onKeep={onKeep}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function Toast({ message, onDismiss }: { message: Message; onDismiss: () => void }) {
  if (!message.text) return null;
  const error = message.kind === 'error';
  return (
    <div
      className={`toast ${error ? 'is-error' : 'is-success'}`}
      role={error ? 'alert' : 'status'}
      aria-live={error ? 'assertive' : 'polite'}
    >
      <span className="toast-dot" aria-hidden="true" />
      <span className="toast-text">{message.text}</span>
      <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Dismiss message">
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ app -- */

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
  const [view, setView] = useState<ViewMode>('list');
  const [visibleCount, setVisibleCount] = useState(ROWS_PER_CHUNK);
  const [message, setMessage] = useState<Message>({ text: '', kind: '' });
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  // The form is a panel rather than a permanent block. Closed by default: the
  // list is what the page is for, and a permanently open form pushes it down
  // by a screen's worth on a phone.
  const [formOpen, setFormOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const companyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a0e17' : '#f2f5fb');
  }, [theme]);

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

  // Confirmations clear themselves; errors stay until read or replaced.
  useEffect(() => {
    if (message.kind !== 'success') return;
    const timer = window.setTimeout(() => setMessage({ text: '', kind: '' }), 3500);
    return () => window.clearTimeout(timer);
  }, [message]);

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
  const visibleApplications = useMemo(() => organized.slice(0, shown), [organized, shown]);
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

  const openForm = useCallback((focus: boolean) => {
    setFormOpen(true);
    window.requestAnimationFrame(() => {
      scrollIntoViewBelowBar(formRef.current);
      if (focus) companyRef.current?.focus({ preventScroll: true });
    });
  }, []);

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
      const nextUser =
        mode === 'signup' ? await api.signUp(email, password) : await api.signIn(email, password);
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
    const payload = { company, title, dateApplied, status: formStatus, postingUrl };

    // Warn once before saving a second copy of a listing already tracked. The
    // acknowledgement names the row it was given for, so changing the form
    // until it collides with a different listing asks again instead of
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
      setFormOpen(false);
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
    openForm(false);
  }

  function onCancelEdit() {
    resetForm();
    setMessage({ text: '', kind: '' });
    setFormOpen(false);
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
   * just the chunk rendered so far. The confirmation names that count, so a
   * partial export is never a surprise; with no filter on it is the whole
   * account.
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
            throw new Error(`Every row in that CSV is already tracked (${plan.skipped} skipped).`);
          }
          const next = await api.addMany(plan.fresh);
          setApplications(next);
          const added = `Imported ${plan.fresh.length} application${
            plan.fresh.length === 1 ? '' : 's'
          }`;
          setMessage({
            text:
              plan.skipped > 0 ? `${added} · skipped ${plan.skipped} already tracked.` : `${added}.`,
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

  const insightCards: {
    key: string;
    value: string | number;
    label: string;
    hint: string;
    filter?: StatusFilter;
    alert?: boolean;
  }[] = [
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
          ? `Open ${FOLLOW_UP_DAYS}+ days, no answer`
          : 'Nothing has gone quiet',
      filter: metrics.followUpCount > 0 ? 'followup' : undefined,
      alert: metrics.followUpCount > 0
    },
    {
      key: 'companies',
      value: metrics.distinctCompanies,
      label: metrics.distinctCompanies === 1 ? 'Company' : 'Companies',
      hint:
        metrics.distinctCompanies > 0
          ? `${(metrics.total / metrics.distinctCompanies).toFixed(1)} roles each`
          : 'No companies yet'
    },
    {
      key: 'open',
      value: metrics.open,
      label: 'Still open',
      hint: metrics.open > 0 ? 'Waiting on the company' : 'Nothing outstanding',
      filter: metrics.open > 0 ? 'open' : undefined
    }
  ];

  const listProps: ListProps = {
    items: visibleApplications,
    today,
    editingId,
    pendingDeleteId,
    busy,
    onEdit,
    onDelete: (id: string) => void onDelete(id),
    onKeep: () => setPendingDeleteId(null),
    onStatus: (id: string, status: ApplicationStatus) => void onChangeStatus(id, status)
  };

  const signedIn = ready && user && api;

  return (
    <div className="page">
      <header className="appbar">
        <div className="appbar-inner">
          <div className="brand">
            <span className="logo">
              <BriefcaseIcon />
            </span>
            <span className="brand-text">
              <h1>Job Tracker</h1>
              <p className="brand-sub">
                {user ? user.email : 'Your pipeline, in your own database'}
              </p>
            </span>
          </div>
          <div className="appbar-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                const next: Theme = theme === 'dark' ? 'light' : 'dark';
                setTheme(next);
                try {
                  window.localStorage.setItem(THEME_KEY, next);
                } catch {
                  /* Private mode: the choice just does not persist. */
                }
              }}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
            {user ? (
              <button
                type="button"
                className="secondary"
                onClick={() => void onSignOut()}
                disabled={busy}
              >
                Sign out
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="wrap">
        {!ready ? <div className="card pad empty">Loading…</div> : null}

        {ready && !configured ? (
          <div className="card pad auth-card wide">
            <p className="eyebrow">Setup</p>
            <h2>Connect your Supabase project</h2>
            <p className="privacy-note" style={{ marginTop: 8 }}>
              Listings live in <strong>your</strong> Supabase Postgres database. The browser uses a
              <strong> publishable</strong> key (<code>sb_publishable_...</code>), not a secret or
              legacy JWT anon key. Row-level security is what keeps other accounts out. Do not
              commit keys to git.
            </p>
            <ol className="setup-steps">
              <li>
                In Supabase: <strong>Settings → API Keys</strong> → copy the project URL and the{' '}
                <strong>publishable</strong> key.
              </li>
              <li>
                Locally copy <code>public/config.example.json</code> to{' '}
                <code>public/config.json</code> (gitignored), then restart <code>npm run dev</code>.
              </li>
              <li>
                For GitHub Pages, store the same two values as repository secrets. They are injected
                at deploy time, not committed.
              </li>
            </ol>
          </div>
        ) : null}

        {ready && configured && !user ? (
          <div className="card pad auth-card">
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
            <p className="privacy-note" style={{ marginTop: 8 }}>
              Listings are stored in your Supabase database, scoped to this email. Other accounts
              cannot read them. Keep as many as you like — there is no cap — and export CSV anytime
              as a personal backup.
            </p>
            <form className="auth-form" onSubmit={(event) => void onAuth(event)}>
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
              <button type="submit" className="primary" disabled={busy}>
                {mode === 'signup' ? 'Create account' : 'Sign in'}
              </button>
            </form>
          </div>
        ) : null}

        {signedIn ? (
          <>
            {metrics.total > 0 ? (
              <>
                <div className="overview">
                  <section className="card summary" aria-label="Pipeline summary">
                    <div className="summary-top">
                      <div>
                        <span className="big-number">{metrics.total}</span>
                        <span className="big-label">
                          {metrics.total === 1 ? 'application tracked' : 'applications tracked'} ·{' '}
                          {metrics.open} open
                        </span>
                      </div>
                      <div className="pace-pill">
                        <span className="pace-value">{metrics.weeklyPace}</span>
                        <span className="pace-label">per week</span>
                      </div>
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
                          <button
                            type="button"
                            className="legend-row"
                            aria-pressed={statusFilter === status}
                            onClick={() =>
                              setStatusFilter((current) => (current === status ? 'all' : status))
                            }
                          >
                            <span className={`swatch is-${status}`} aria-hidden="true" />
                            <span className="legend-label">{STATUS_LABELS[status]}</span>
                            <span className="legend-value">{metrics.counts[status]}</span>
                            <span className="legend-pct">
                              {percentOf(metrics.counts[status], metrics.total)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="card chart-card" aria-label="Applications per week">
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
                            title={`Week of ${formatDisplayDate(week.weekStart)}: ${
                              week.count
                            } application${week.count === 1 ? '' : 's'}`}
                          >
                            <span className="week-count">{week.count > 0 ? week.count : ''}</span>
                            <span className="week-track">
                              <span
                                className="week-bar"
                                style={{ height: `${(week.count / weeklyMax) * 100}%` }}
                              />
                            </span>
                            <span className="week-label">
                              {isCurrent ? 'Now' : formatShortDate(week.weekStart)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </div>

                <div className="insights" aria-label="Application metrics">
                  {insightCards.map((card) =>
                    card.filter ? (
                      <button
                        type="button"
                        className={card.alert ? 'insight is-alert' : 'insight'}
                        key={card.key}
                        onClick={() => setStatusFilter(card.filter as StatusFilter)}
                      >
                        <span className="insight-value">{card.value}</span>
                        <span className="insight-label">{card.label}</span>
                        <span className="insight-hint">{card.hint}</span>
                      </button>
                    ) : (
                      <div className={card.alert ? 'insight is-alert' : 'insight'} key={card.key}>
                        <span className="insight-value">{card.value}</span>
                        <span className="insight-label">{card.label}</span>
                        <span className="insight-hint">{card.hint}</span>
                      </div>
                    )
                  )}
                </div>
              </>
            ) : null}

            <div className="section-head">
              <div>
                <h2>
                  Your applications
                  {applications.length > 0 ? (
                    <span className="count-pill">{applications.length}</span>
                  ) : null}
                </h2>
                <p className="section-lede">
                  {applications.length === 0
                    ? 'Nothing here yet.'
                    : shown < organized.length
                      ? `Showing ${shown} of ${organized.length}`
                      : filtering
                        ? `${organized.length} of ${applications.length} shown`
                        : 'Change a stage inline, or edit any listing'}
                </p>
              </div>
              <div className="head-actions">
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
                  title="Import CSV"
                >
                  <UploadIcon />
                  <span className="btn-label">Import</span>
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={onExport}
                  disabled={applications.length === 0}
                  title={
                    filtering && organized.length !== applications.length
                      ? `Export ${organized.length} matching`
                      : 'Export CSV'
                  }
                >
                  <DownloadIcon />
                  <span className="btn-label">
                    {filtering && organized.length !== applications.length
                      ? `Export ${organized.length}`
                      : 'Export'}
                  </span>
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    if (formOpen && !editingId) {
                      setFormOpen(false);
                      return;
                    }
                    resetForm();
                    openForm(true);
                  }}
                >
                  <PlusIcon />
                  <span className="btn-label">Add</span>
                  <span className="sr-only">Add an application</span>
                </button>
              </div>
            </div>

            <div ref={formRef}>
              {formOpen ? (
                <section className="card form-panel">
                  <div className="form-panel-head">
                    <div>
                      <h3>{editingId ? 'Edit application' : 'Add an application'}</h3>
                      {editingId ? (
                        <p className="editing-note">Save or cancel when you are done.</p>
                      ) : (
                        <p className="card-lede">Company, role, and date are required.</p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={onCancelEdit}
                      aria-label="Close the form"
                      title="Close"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                  <form className="app-form" onSubmit={(event) => void onSubmit(event)}>
                    <div className="field">
                      <label htmlFor="company">Company</label>
                      <input
                        ref={companyRef}
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
                      <label htmlFor="title">Role</label>
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
                    <div className="form-actions">
                      {editingId ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={onCancelEdit}
                          disabled={busy}
                        >
                          Cancel
                        </button>
                      ) : null}
                      <button type="submit" className="primary" disabled={busy}>
                        {editingId ? 'Save changes' : 'Add application'}
                      </button>
                    </div>
                  </form>
                </section>
              ) : null}
            </div>

            {applications.length > 0 ? (
              <div className="controls">
                <div className="controls-row">
                  <div className="search-field">
                    <span className="search-icon">
                      <SearchIcon />
                    </span>
                    <label className="sr-only" htmlFor="search">
                      Search company, role, or URL
                    </label>
                    <input
                      type="search"
                      id="search"
                      placeholder="Search company or role…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query ? (
                      <button
                        type="button"
                        className="icon-btn search-clear"
                        onClick={() => setQuery('')}
                        aria-label="Clear search"
                      >
                        <CloseIcon size={14} />
                      </button>
                    ) : null}
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
                  <div className="viewswitch" role="group" aria-label="View">
                    <button
                      type="button"
                      aria-pressed={view === 'list'}
                      onClick={() => setView('list')}
                      aria-label="List view"
                      title="List view"
                    >
                      <ListIcon />
                      <span className="btn-label">List</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={view === 'board'}
                      onClick={() => setView('board')}
                      aria-label="Board view"
                      title="Board view"
                    >
                      <BoardIcon />
                      <span className="btn-label">Board</span>
                    </button>
                  </div>
                </div>
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
              </div>
            ) : null}

            {applications.length === 0 ? (
              <div className="card pad empty">
                <div className="empty-icon" aria-hidden="true">
                  <BriefcaseIcon size={22} />
                </div>
                <p className="empty-title">No applications yet</p>
                <p>Add your first listing, or import a CSV backup.</p>
                <p style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      resetForm();
                      openForm(true);
                    }}
                  >
                    <PlusIcon />
                    Add an application
                  </button>
                </p>
              </div>
            ) : organized.length === 0 ? (
              <div className="card pad empty">
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
            ) : view === 'board' ? (
              <>
                <ApplicationsBoard {...listProps} />
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
              </>
            ) : (
              <>
                <div className="table-wrap">
                  <ApplicationsTable {...listProps} />
                </div>
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
              </>
            )}

            <button
              type="button"
              className="fab"
              onClick={() => {
                resetForm();
                openForm(true);
              }}
              aria-label="Add an application"
            >
              <PlusIcon size={18} />
              Add
            </button>
          </>
        ) : null}
      </div>

      <Toast message={message} onDismiss={() => setMessage({ text: '', kind: '' })} />
    </div>
  );
}
