import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  addApplication,
  createSessionStorage,
  getApplications,
  replaceApplications,
  setOffer,
  updateApplication,
  type KeyValueStorage
} from './lib/store';
import {
  inspectStorage,
  lockApplications,
  persistLocked,
  unlockApplications,
  wipeVault
} from './lib/vault';
import { applicationsToCsv, downloadCsv, parseApplicationsCsv } from './lib/csv';
import type { Application } from './lib/types';

function todayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function isSafeHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

type Gate = 'loading' | 'setup' | 'locked' | 'open';

export default function App() {
  const disk = useMemo(() => window.localStorage, []);
  const sessionRef = useRef<KeyValueStorage>(createSessionStorage());
  const passphraseRef = useRef('');
  const [gate, setGate] = useState<Gate>('loading');
  const [plaintextCount, setPlaintextCount] = useState(0);
  const [applications, setApplications] = useState<Application[]>([]);
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [dateApplied, setDateApplied] = useState(todayIsoDate);
  const [receivedOffer, setReceivedOffer] = useState(false);
  const [postingUrl, setPostingUrl] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [message, setMessage] = useState<{ text: string; kind: 'error' | 'success' | '' }>({
    text: '',
    kind: ''
  });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const kind = inspectStorage(disk);
    if (kind === 'vault') {
      setGate('locked');
      return;
    }
    if (kind === 'plaintext') {
      setPlaintextCount(getApplications(disk).length);
    }
    setGate('setup');
  }, [disk]);

  async function commit(next: Application[]) {
    setApplications(next);
    await persistLocked(disk, passphraseRef.current, next);
  }

  async function onCreateVault(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (passphrase !== passphraseConfirm) {
        throw new Error('Passphrases do not match.');
      }
      const existing = inspectStorage(disk) === 'plaintext' ? getApplications(disk) : [];
      await lockApplications(disk, passphrase, existing);
      passphraseRef.current = passphrase;
      sessionRef.current = createSessionStorage(existing);
      setApplications(existing);
      setPassphrase('');
      setPassphraseConfirm('');
      setGate('open');
      setMessage({
        text: existing.length
          ? 'Encrypted. Your list stays on this device.'
          : 'Private vault created. Your list stays on this device.',
        kind: 'success'
      });
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Could not create vault.',
        kind: 'error'
      });
    } finally {
      setBusy(false);
    }
  }

  async function onUnlock(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const apps = await unlockApplications(disk, passphrase);
      passphraseRef.current = passphrase;
      sessionRef.current = createSessionStorage(apps);
      setApplications(apps);
      setPassphrase('');
      setGate('open');
      setMessage({ text: '', kind: '' });
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Could not unlock.',
        kind: 'error'
      });
    } finally {
      setBusy(false);
    }
  }

  function onLock() {
    passphraseRef.current = '';
    sessionRef.current = createSessionStorage();
    setApplications([]);
    resetForm();
    setMessage({ text: '', kind: '' });
    setGate('locked');
  }

  function onResetVault() {
    const confirmed = window.confirm(
      'This permanently deletes the encrypted list on this device. Export a CSV first if you want a backup. Continue?'
    );
    if (!confirmed) return;
    wipeVault(disk);
    passphraseRef.current = '';
    sessionRef.current = createSessionStorage();
    setApplications([]);
    setPlaintextCount(0);
    setPassphrase('');
    setPassphraseConfirm('');
    resetForm();
    setMessage({ text: 'Vault cleared on this device.', kind: 'success' });
    setGate('setup');
  }

  function resetForm() {
    setCompany('');
    setTitle('');
    setDateApplied(todayIsoDate());
    setReceivedOffer(false);
    setPostingUrl('');
    setEditingId(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
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
      const next = editingId
        ? updateApplication(sessionRef.current, editingId, payload)
        : addApplication(sessionRef.current, payload);
      await commit(next);
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
    try {
      const next = setOffer(sessionRef.current, id, checked);
      await commit(next);
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
          const existing = getApplications(sessionRef.current);
          const next = replaceApplications(sessionRef.current, [...existing, ...imported]);
          await commit(next);
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
            Private to this browser. Encrypted with your passphrase. Never uploaded.
          </p>
        </div>
        {gate === 'open' ? (
          <button type="button" className="secondary lock-btn" onClick={onLock}>
            Lock
          </button>
        ) : null}
      </header>

      {gate === 'loading' ? <div className="card empty">Loading…</div> : null}

      {gate === 'setup' ? (
        <div className="card lock-screen">
          <h2>Create a private passphrase</h2>
          <p className="privacy-note">
            Applications are saved only in this browser, encrypted so nobody else — including
            anyone who opens this public site — can read them. There is no account and no
            server. If you forget the passphrase, the list cannot be recovered unless you
            exported a CSV.
          </p>
          {plaintextCount > 0 ? (
            <p className="privacy-note">
              {plaintextCount} existing application{plaintextCount === 1 ? '' : 's'} on this
              device will be encrypted when you continue.
            </p>
          ) : null}
          <form className="lock-form" onSubmit={onCreateVault}>
            <div className="field">
              <label htmlFor="new-passphrase">Passphrase</label>
              <input
                type="password"
                id="new-passphrase"
                name="passphrase"
                autoComplete="new-password"
                minLength={8}
                required
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="confirm-passphrase">Confirm passphrase</label>
              <input
                type="password"
                id="confirm-passphrase"
                name="passphraseConfirm"
                autoComplete="new-password"
                minLength={8}
                required
                value={passphraseConfirm}
                onChange={(e) => setPassphraseConfirm(e.target.value)}
              />
            </div>
            <div className="actions">
              <span className={`msg${message.kind ? ' ' + message.kind : ''}`}>{message.text}</span>
              <button type="submit" className="primary" disabled={busy}>
                Encrypt and continue
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {gate === 'locked' ? (
        <div className="card lock-screen">
          <h2>Unlock your applications</h2>
          <p className="privacy-note">
            The encrypted list is still on this device from last time. Enter the same
            passphrase to read it. It is never sent anywhere.
          </p>
          <form className="lock-form" onSubmit={onUnlock}>
            <div className="field">
              <label htmlFor="unlock-passphrase">Passphrase</label>
              <input
                type="password"
                id="unlock-passphrase"
                name="passphrase"
                autoComplete="current-password"
                minLength={8}
                required
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </div>
            <div className="actions">
              <span className={`msg${message.kind ? ' ' + message.kind : ''}`}>{message.text}</span>
              <button type="submit" className="primary" disabled={busy}>
                Unlock
              </button>
            </div>
          </form>
          <button type="button" className="linkish reset-vault" onClick={onResetVault}>
            Forgot passphrase? Reset this device
          </button>
        </div>
      ) : null}

      {gate === 'open' ? (
        <>
          <div className="card">
            <form className="app-form" onSubmit={onSubmit} ref={formRef}>
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
                          onChange={(e) => onToggleOffer(app.id, e.target.checked)}
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
