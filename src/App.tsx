import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createConfiguredAccountApi, isSupabaseConfigured } from './lib/supabase-account';
import { applicationsToCsv, downloadCsv, parseApplicationsCsv } from './lib/csv';
import type { Application } from './lib/types';
import type { PublicUser } from './lib/supabase-account';

function todayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function isSafeHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export default function App() {
  const configured = isSupabaseConfigured();
  const api = useMemo(() => (configured ? createConfiguredAccountApi() : null), [configured]);
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
      if (!api) {
        setReady(true);
        return;
      }
      try {
        const restored = await api.restore();
        if (cancelled) return;
        if (restored) {
          setUser(restored);
          setApplications(await api.list());
        }
      } catch (err) {
        if (!cancelled) {
          setMessage({
            text: err instanceof Error ? err.message : 'Could not restore session.',
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
  }, [api]);

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
    setMessage({ text: '', kind: '' });
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function onCancelEdit() {
    resetForm();
    setMessage({ text: '', kind: '' });
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

  return (
    <div className="wrap">
      <header className="hero">
        <div className="logo" aria-hidden="true">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="20" height="14" x="2" y="7" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
        </div>
        <div>
          <h1>Job Tracker</h1>
          <p className="subtitle">
            {user
              ? `Signed in as ${user.email}. Your listings stay private to this account.`
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
          <h2>Connect your Supabase project</h2>
          <p className="privacy-note">
            Listings live in <strong>your</strong> Supabase Postgres database, private to the
            account you sign in with. GitHub Pages and Lovable only serve the UI; they cannot
            read the table. Create a free project, run <code>supabase/schema.sql</code> in the
            SQL editor, then set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> and rebuild.
          </p>
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
          <h2>{mode === 'signup' ? 'Create your account' : 'Sign in to your account'}</h2>
          <p className="privacy-note">
            Job listings are stored in your Supabase database, scoped to this email. Other
            accounts cannot read them (row-level security). Export CSV anytime as a personal
            backup. Ask Lovable to restyle this screen; leave <code>src/lib/</code> and{' '}
            <code>supabase/schema.sql</code> alone.
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
              <span className={`msg${message.kind ? ' ' + message.kind : ''}`}>{message.text}</span>
              <button type="submit" className="primary" disabled={busy}>
                {mode === 'signup' ? 'Create account' : 'Sign in'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {ready && user && api ? (
        <>
          <div className="card">
            <form className="app-form" onSubmit={(event) => void onSubmit(event)} ref={formRef}>
              {editingId ? (
                <p className="editing-note">Editing an existing application. Save or cancel when you are done.</p>
              ) : null}
              <div className="field">
                <label htmlFor="company">Company</label>
                <input
                  type="text"
                  id="company"
                  name="company"
                  placeholder="Acme Corp"
                  required
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
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="dateApplied">Date Applied</label>
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
                  value={postingUrl}
                  onChange={(e) => setPostingUrl(e.target.value)}
                />
              </div>
              <div className="actions">
                <span className={`msg${message.kind ? ' ' + message.kind : ''}`}>{message.text}</span>
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
            <h2>Your applications</h2>
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
            <div className="card empty">No applications yet. Add your first one above.</div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Title</th>
                    <th>Date Applied</th>
                    <th>Offer</th>
                    <th>Posting</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((app) => (
                    <tr key={app.id} className={editingId === app.id ? 'is-editing' : undefined}>
                      <td>{app.company}</td>
                      <td>{app.title}</td>
                      <td>{app.dateApplied}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={app.receivedOffer}
                          aria-label={`Received offer from ${app.company}`}
                          onChange={(e) => void onToggleOffer(app.id, e.target.checked)}
                        />
                      </td>
                      <td>
                        {app.postingUrl && isSafeHttpUrl(app.postingUrl) ? (
                          <a href={app.postingUrl} target="_blank" rel="noopener noreferrer">
                            View posting
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => onEdit(app)}
                          aria-label={`Edit ${app.company} ${app.title}`}
                        >
                          Edit
                        </button>
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
  );
}
