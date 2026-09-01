import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  addApplication,
  getApplications,
  replaceApplications,
  setOffer
} from './lib/store';
import { applicationsToCsv, downloadCsv, parseApplicationsCsv } from './lib/csv';
import type { Application } from './lib/types';

function todayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export default function App() {
  const storage = useMemo(() => window.localStorage, []);
  const [applications, setApplications] = useState<Application[]>([]);
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [dateApplied, setDateApplied] = useState(todayIsoDate);
  const [receivedOffer, setReceivedOffer] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: 'error' | 'success' | '' }>({
    text: '',
    kind: ''
  });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setApplications(getApplications(storage));
  }, [storage]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const next = addApplication(storage, {
        company,
        title,
        dateApplied,
        receivedOffer
      });
      setApplications(next);
      setCompany('');
      setTitle('');
      setDateApplied(todayIsoDate());
      setReceivedOffer(false);
      setMessage({ text: 'Saved.', kind: 'success' });
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Could not save.',
        kind: 'error'
      });
    } finally {
      setBusy(false);
    }
  }

  function onToggleOffer(id: string, checked: boolean) {
    try {
      setApplications(setOffer(storage, id, checked));
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
        <form className="app-form" onSubmit={onSubmit}>
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
          <div className="actions">
            <span className={`msg${message.kind ? ' ' + message.kind : ''}`}>{message.text}</span>
            <button type="submit" className="primary" disabled={busy}>
              Add application
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
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Title</th>
              <th>Date Applied</th>
              <th>Offer</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((app) => (
              <tr key={app.id}>
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
