import { describe, it, expect } from 'vitest';
import { addApplication } from '../src/lib/store';
import { applicationsToCsv, parseApplicationsCsv, splitCsvLine } from '../src/lib/csv';
import { escapeFormula } from '../src/lib/applications';
import { createMemoryStorage } from './harness';
import type { Application } from '../src/lib/types';

function sampleApp(overrides: Partial<Application> = {}): Application {
  return {
    id: '1',
    company: 'Acme',
    title: 'Dev',
    dateApplied: '2026-08-20',
    status: 'applied',
    postingUrl: '',
    ...overrides
  };
}

describe('formula-injection escaping (CSV)', () => {
  const dangerous = ['=', '+', '-', '@'];

  for (const prefix of dangerous) {
    it(`prefixes a company beginning with "${prefix}" with an apostrophe in CSV`, () => {
      const storage = createMemoryStorage();
      const apps = addApplication(storage, {
        company: prefix + 'SUM(A1:A9)',
        title: 'Engineer',
        dateApplied: '2026-01-01'
      });
      // In-app storage keeps the original text so the table stays readable.
      expect(apps[0].company).toBe(prefix + 'SUM(A1:A9)');
      const csv = applicationsToCsv(apps);
      const dataLine = csv.trim().split(/\r?\n/)[1];
      const companyField = splitCsvLine(dataLine)[0];
      expect(companyField).toBe("'" + prefix + 'SUM(A1:A9)');
    });
  }

  it('escapes the title field too', () => {
    const csv = applicationsToCsv([
      sampleApp({ title: '=HYPERLINK("http://evil","x")', dateApplied: '2026-01-01' })
    ]);
    const dataLine = csv.trim().split(/\r?\n/)[1];
    const titleField = splitCsvLine(dataLine)[1];
    expect(titleField).toBe("'=HYPERLINK(\"http://evil\",\"x\")");
  });

  it('escapes the posting URL field too', () => {
    const csv = applicationsToCsv([
      sampleApp({ postingUrl: '=HYPERLINK("http://evil","x")', dateApplied: '2026-01-01' })
    ]);
    const dataLine = csv.trim().split(/\r?\n/)[1];
    const urlField = splitCsvLine(dataLine)[4];
    expect(urlField).toBe("'=HYPERLINK(\"http://evil\",\"x\")");
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeFormula('Acme Corp')).toBe('Acme Corp');
    expect(escapeFormula('Senior Engineer')).toBe('Senior Engineer');
  });

  it('does not corrupt the value the client reads back from storage', () => {
    const storage = createMemoryStorage();
    const result = addApplication(storage, {
      company: '=1+1',
      title: 'Dev',
      dateApplied: '2026-01-01'
    });
    expect(result[0].company).toBe('=1+1');
  });
});

describe('CSV round-trip', () => {
  it('exports a header row and one data row', () => {
    const csv = applicationsToCsv([sampleApp({ status: 'offer' })]);
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toBe('Company,Title,Date Applied,Status,Posting URL');
    expect(splitCsvLine(lines[1])).toEqual(['Acme', 'Dev', '2026-08-20', 'Offer', '']);
  });

  it('quotes fields that contain commas', () => {
    const csv = applicationsToCsv([sampleApp({ company: 'Acme, Inc.' })]);
    const dataLine = csv.trim().split(/\r?\n/)[1];
    expect(splitCsvLine(dataLine)[0]).toBe('Acme, Inc.');
  });

  it('exports a posting URL and round-trips it', () => {
    const csv = applicationsToCsv([
      sampleApp({ postingUrl: 'https://jobs.example.com/dev' })
    ]);
    const lines = csv.trim().split(/\r?\n/);
    expect(splitCsvLine(lines[1])[4]).toBe('https://jobs.example.com/dev');
    const parsed = parseApplicationsCsv(csv);
    expect(parsed[0].postingUrl).toBe('https://jobs.example.com/dev');
  });

  it('parses a Google Sheets-style export with the same headers', () => {
    const csv = [
      'Company,Title,Date Applied,Received Offer',
      'Acme,Frontend,2026-08-20,TRUE',
      'Globex,Backend,2026-08-25,FALSE'
    ].join('\n');
    const apps = parseApplicationsCsv(csv);
    expect(apps).toHaveLength(2);
    expect(apps[0]).toMatchObject({
      company: 'Acme',
      title: 'Frontend',
      dateApplied: '2026-08-20',
      status: 'offer',
      postingUrl: ''
    });
    expect(apps[1].status).toBe('applied');
  });

  it('round-trips every status through the Status column', () => {
    const apps: Application[] = [
      sampleApp({ id: '1', status: 'applied' }),
      sampleApp({ id: '2', status: 'interviewing' }),
      sampleApp({ id: '3', status: 'offer' }),
      sampleApp({ id: '4', status: 'rejected' })
    ];
    const csv = applicationsToCsv(apps);
    const lines = csv.trim().split(/\r?\n/);
    expect(lines.slice(1).map((l) => splitCsvLine(l)[3])).toEqual([
      'Applied',
      'Interviewing',
      'Offer',
      'Rejected'
    ]);
    expect(parseApplicationsCsv(csv).map((a) => a.status)).toEqual([
      'applied',
      'interviewing',
      'offer',
      'rejected'
    ]);
  });

  it('reads status case-insensitively and treats unknown values as applied', () => {
    const csv = [
      'Company,Title,Date Applied,Status,Posting URL',
      'A,Dev,2026-01-01,REJECTED,',
      'B,Dev,2026-01-01,interview,',
      'C,Dev,2026-01-01,something else,',
      'D,Dev,2026-01-01,,'
    ].join('\n');
    expect(parseApplicationsCsv(csv).map((a) => a.status)).toEqual([
      'rejected',
      'interviewing',
      'applied',
      'applied'
    ]);
  });

  it('imports a legacy export whose Received Offer column sits after Posting URL', () => {
    const csv = [
      'Company,Title,Posting URL,Date Applied,Received Offer',
      'Acme,Dev,https://jobs.acme.test/dev,2026-08-20,TRUE'
    ].join('\n');
    const apps = parseApplicationsCsv(csv);
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      company: 'Acme',
      dateApplied: '2026-08-20',
      status: 'offer',
      postingUrl: 'https://jobs.acme.test/dev'
    });
  });

  it('imports a headerless file positionally, accepting TRUE or a status name', () => {
    const csv = ['Acme,Dev,2026-08-20,TRUE,', 'Globex,PM,2026-08-21,Rejected,'].join('\n');
    const apps = parseApplicationsCsv(csv);
    expect(apps.map((a) => a.status)).toEqual(['offer', 'rejected']);
  });

  it('parses a five-column export that includes posting URLs', () => {
    const csv = [
      'Company,Title,Date Applied,Received Offer,Posting URL',
      'Acme,Frontend,2026-08-20,TRUE,https://jobs.acme.test/frontend'
    ].join('\n');
    const apps = parseApplicationsCsv(csv);
    expect(apps).toHaveLength(1);
    expect(apps[0].postingUrl).toBe('https://jobs.acme.test/frontend');
  });

  it('imports a row with an invalid posting URL and leaves the URL blank', () => {
    const csv = [
      'Company,Title,Date Applied,Received Offer,Posting URL',
      'Acme,Frontend,2026-08-20,TRUE,javascript:alert(1)'
    ].join('\n');
    const apps = parseApplicationsCsv(csv);
    expect(apps).toHaveLength(1);
    expect(apps[0].postingUrl).toBe('');
  });

  it('strips a leading apostrophe added for formula safety on import', () => {
    const apps = parseApplicationsCsv(
      "Company,Title,Date Applied,Received Offer\n'=1+1,Dev,2026-01-01,FALSE\n"
    );
    expect(apps[0].company).toBe('=1+1');
  });

  it('skips blank and invalid rows', () => {
    const csv = [
      'Company,Title,Date Applied,Received Offer',
      ',,,',
      'NoDate,Dev,,FALSE',
      'Good,Dev,2026-01-01,FALSE'
    ].join('\n');
    expect(parseApplicationsCsv(csv)).toHaveLength(1);
  });

  it('skips a row whose company is over the length cap', () => {
    const csv = [
      'Company,Title,Date Applied,Received Offer',
      `${'A'.repeat(201)},Dev,2026-01-01,FALSE`,
      'Good,Dev,2026-01-01,FALSE'
    ].join('\n');
    const apps = parseApplicationsCsv(csv);
    expect(apps).toHaveLength(1);
    expect(apps[0].company).toBe('Good');
  });
});
