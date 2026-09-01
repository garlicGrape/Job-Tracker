import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  addApplication,
  getApplications,
  replaceApplications,
  setOffer,
  updateApplication
} from './lib/store';
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

export default function App() {
  const storage = useMemo(() => window.localStorage, []);
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
    setApplications(getApplications(storage));
  }, [storage]);

  function resetForm() {
    setCompany('');
    setTitle('');
    setDateApplied(todayIsoDate());
    setReceivedOffer(false);
    setPostingUrl('');
    setEditingId(null);
  }

  function onSubmit(event: FormEvent) {
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
        ? updateApplication(storage, editingId, payload)
        : addApplication(storage, payload);
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

  function onToggleOffer(id: string, checked: boolean) {
    try {
      setApplications(setOffer(storage, id, checked));
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
      try {
        const text = typeof reader.result === 'string' ? reader.result : '';
        const imported = parseApplicationsCsv(text);
        if (imported.length === 0) {
          throw new Error('No valid rows found in that CSV.');
        }
        const existing = getApplications(storage);
        const next = replaceApplications(storage, [...existing, ...imported]);
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
          <p className="subtitle">Log every application in this browser. Export a CSV whenever you want a copy.</p>
        </div>
      </header>

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
    </div>
  );
}
