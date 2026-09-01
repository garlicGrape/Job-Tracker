import { HEADERS, type Application } from './types';
import { createApplication, escapeFormula, isValidDate, toBoolean } from './applications';

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Serialize applications to CSV. Formula-looking company/title values are
 * prefixed with an apostrophe so Excel / Sheets will not execute them.
 */
export function applicationsToCsv(apps: Application[]): string {
  const lines = [HEADERS.join(',')];
  for (const app of apps) {
    lines.push(
      [
        csvField(escapeFormula(app.company)),
        csvField(escapeFormula(app.title)),
        csvField(app.dateApplied),
        app.receivedOffer ? 'TRUE' : 'FALSE'
      ].join(',')
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * Split a CSV line into fields, honoring double-quoted values.
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function unescapeImported(value: string): string {
  const trimmed = value.trim();
  // Sheets / Excel store formula-safe text with a leading apostrophe.
  if (trimmed.startsWith("'") && /^'[=+\-@\t\r]/.test(trimmed)) {
    return trimmed.slice(1);
  }
  return trimmed;
}

/**
 * Parse a CSV produced by this app (or a 4-column Google Sheet export with
 * the same headers) into application records. Invalid rows are skipped.
 */
export function parseApplicationsCsv(text: string): Application[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];

  const start = looksLikeHeader(splitCsvLine(lines[0])) ? 1 : 0;
  const apps: Application[] = [];
  for (let i = start; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const company = unescapeImported(cols[0] ?? '');
    const title = unescapeImported(cols[1] ?? '');
    const dateApplied = (cols[2] ?? '').trim();
    const receivedOffer = toBoolean((cols[3] ?? '').trim());
    if (!company && !title) continue;
    if (!isValidDate(dateApplied)) continue;
    try {
      apps.push(createApplication({ company, title, dateApplied, receivedOffer }));
    } catch {
      // Skip rows that fail the same validation the form uses.
    }
  }
  return apps;
}

function looksLikeHeader(cols: string[]): boolean {
  const joined = cols.map((c) => c.trim().toLowerCase()).join('|');
  return joined.startsWith('company|title|date applied|');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
