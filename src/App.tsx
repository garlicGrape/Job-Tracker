import { FormEvent, useEffect, useRef, useState } from 'react';
import { createAccountApiFromConfig, type AccountApi, type PublicUser } from './lib/supabase-account';
import { loadSupabaseConfig } from './lib/supabase-config';
import { applicationsToCsv, downloadCsv, parseApplicationsCsv } from './lib/csv';
import { LIMITS, assertCsvByteSize } from './lib/applications';
import type { Application } from './lib/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function todayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

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
  const [receivedOffer, setReceivedOffer] = useState(false);
  const [postingUrl, setPostingUrl] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
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

  function resetForm() {
    setCompany('');
    setTitle('');
    setDateApplied(todayIsoDate());
    setReceivedOffer(false);
    setPostingUrl('');
    setEditingId(null);
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
    setBusy(true);
    try {
      const payload = {
        company,
        title,
        dateApplied,
        receivedOffer,
        postingUrl
      };
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
    setReceivedOffer(app.receivedOffer);
    setPostingUrl(app.postingUrl);
    setPendingDeleteId(null);
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

  async function onToggleOffer(id: string, checked: boolean) {
    if (!api) return;
    try {
      setApplications(await api.setOffer(id, checked));
      if (editingId === id) {
        setReceivedOffer(checked);
      }
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Could not update offer.',
        kind: 'error'
      });
    }
  }

  function onExport() {
    const csv = applicationsToCsv(applications);
    downloadCsv(`job-applications-${todayIsoDate()}.csv`, csv);
    setMessage({ text: 'CSV downloaded.', kind: 'success' });
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
    reader.onload = () => {
      void (async () => {
        try {
          const text = typeof reader.result === 'string' ? reader.result : '';
          const imported = parseApplicationsCsv(text);
          if (imported.length === 0) {
            throw new Error('No valid rows found in that CSV.');
          }
          if (!api) {
            throw new Error('Supabase is not configured.');
          }
          const next = await api.replaceAll([...applications, ...imported]);
          setApplications(next);
          setMessage({
            text: `Imported ${imported.length} application${imported.length === 1 ? '' : 's'}.`,
            kind: 'success'
          });
        } catch (err) {
          setMessage({
            text: err instanceof Error ? err.message : 'Could not import CSV.',
            kind: 'error'
          });
        }
      })();
    };
    reader.readAsText(file);
  }

  const offerCount = applications.filter((app) => app.receivedOffer).length;
  const waitingCount = applications.length - offerCount;

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
              cannot read them. Each account can keep up to {LIMITS.maxApplicationsPerUser} listings
              — enough for a heavy search — and oversized or malformed rows are rejected even if
              someone bypasses this form. Export CSV anytime as a personal backup.
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
            <div className="stats" aria-label="Application summary">
              <div className="stat">
                <span className="stat-value">
                  {applications.length}
                  <span className="stat-cap">/{LIMITS.maxApplicationsPerUser}</span>
                </span>
                <span className="stat-label">{applications.length === 1 ? 'Application' : 'Applications'}</span>
              </div>
              <div className="stat">
                <span className="stat-value">{offerCount}</span>
                <span className="stat-label">{offerCount === 1 ? 'Offer' : 'Offers'}</span>
              </div>
              <div className="stat">
                <span className="stat-value">{waitingCount}</span>
                <span className="stat-label">Waiting</span>
              </div>
            </div>

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
                  <div className="checkbox-row">
                    <input
                      type="checkbox"
                      id="receivedOffer"
                      name="receivedOffer"
                      checked={receivedOffer}
                      onChange={(e) => setReceivedOffer(e.target.checked)}
                    />
                    <label htmlFor="receivedOffer">Received offer</label>
                  </div>
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
                    : `${applications.length} of ${LIMITS.maxApplicationsPerUser} saved · edit or delete any row`}
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
                <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
                  Import CSV
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={onExport}
                  disabled={applications.length === 0}
                >
                  Export CSV
                </button>
              </div>
            </div>

            {applications.length === 0 ? (
              <div className="card empty">
                <div className="empty-icon" aria-hidden="true">
                  <BriefcaseIcon />
                </div>
                <p className="empty-title">No applications yet</p>
                <p>Add your first listing above, or import a CSV backup.</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Title</th>
                      <th>Date applied</th>
                      <th>Offer</th>
                      <th>Posting</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((app) => (
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
                          <time dateTime={app.dateApplied}>{formatDisplayDate(app.dateApplied)}</time>
                        </td>
                        <td data-label="Offer">
                          <button
                            type="button"
                            className={app.receivedOffer ? 'offer-pill is-on' : 'offer-pill'}
                            aria-pressed={app.receivedOffer}
                            aria-label={
                              app.receivedOffer
                                ? `Offer from ${app.company}. Click to mark as waiting.`
                                : `No offer from ${app.company}. Click to mark as received.`
                            }
                            onClick={() => void onToggleOffer(app.id, !app.receivedOffer)}
                          >
                            {app.receivedOffer ? 'Offer' : 'Waiting'}
                          </button>
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
                                  onClick={() => void onDelete(app.id)}
                                  disabled={busy}
                                  aria-label={`Confirm delete ${app.company} ${app.title}`}
                                >
                                  Confirm delete
                                </button>
                                <button
                                  type="button"
                                  className="linkish"
                                  onClick={() => setPendingDeleteId(null)}
                                  disabled={busy}
                                >
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
                                  onClick={() => void onDelete(app.id)}
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
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
