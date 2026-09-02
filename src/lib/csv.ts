import { HEADERS, type Application, type ApplicationStatus } from './types';
import {
  STATUS_LABELS,
  createApplication,
  escapeFormula,
  isValidDate,
  isValidHttpUrl,
  normalizePostingUrl,
  parseStatus,
  toBoolean
} from './applications';

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
        STATUS_LABELS[app.status],
        csvField(escapeFormula(app.postingUrl))
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
 * Read a status from either a "Status" cell (Applied / Interviewing / Offer /
 * Rejected) or the older "Received Offer" cell (TRUE / FALSE). TRUE means an
 * offer; anything unrecognized, including FALSE and blank, means applied.
 */
export function statusFromCell(value: string): ApplicationStatus {
  const trimmed = value.trim();
  if (toBoolean(trimmed)) return 'offer';
  return parseStatus(trimmed) ?? 'applied';
}

type ColumnMap = {
  company: number;
  title: number;
  dateApplied: number;
  status: number;
  receivedOffer: number;
  postingUrl: number;
};

/** Positional layout for a file with no header row (or an unknown header). */
const DEFAULT_COLUMNS: ColumnMap = {
  company: 0,
  title: 1,
  dateApplied: 2,
  status: 3,
  receivedOffer: -1,
  postingUrl: 4
};

/**
 * Locate columns by header name so exports from either era import, and a
 * reordered sheet still lands in the right fields. Unknown columns are
 * ignored. Returns null when the first row is not a header.
 */
function mapColumns(cols: string[]): ColumnMap | null {
  const names = cols.map((c) => c.trim().toLowerCase());
  if (names[0] !== 'company' || names[1] !== 'title' || !names.includes('date applied')) {
    return null;
  }
  const find = (...labels: string[]) => {
    for (const label of labels) {
      const idx = names.indexOf(label);
      if (idx >= 0) return idx;
    }
    return -1;
  };
  return {
    company: 0,
    title: 1,
    dateApplied: find('date applied', 'date'),
    status: find('status', 'stage'),
    receivedOffer: find('received offer', 'offer'),
    postingUrl: find('posting url', 'url', 'link')
  };
}

function cell(cols: string[], index: number): string {
  return index >= 0 ? (cols[index] ?? '') : '';
}

/**
 * Parse a CSV produced by this app (or a Google Sheet export with the same
 * headers) into application records. Older exports with a Received Offer
 * column and no Status column still import: TRUE becomes an offer. A sheet
 * without Posting URL leaves that field blank. Invalid rows are skipped.
 */
export function parseApplicationsCsv(text: string): Application[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];

  const header = mapColumns(splitCsvLine(lines[0]));
  const columns = header ?? DEFAULT_COLUMNS;
  const start = header ? 1 : 0;
  const apps: Application[] = [];
  for (let i = start; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const company = unescapeImported(cell(cols, columns.company));
    const title = unescapeImported(cell(cols, columns.title));
    const dateApplied = cell(cols, columns.dateApplied).trim();
    const statusCell = cell(cols, columns.status).trim();
    const status = statusCell
      ? statusFromCell(statusCell)
      : statusFromCell(cell(cols, columns.receivedOffer));
    const normalizedUrl = normalizePostingUrl(unescapeImported(cell(cols, columns.postingUrl)));
    const postingUrl = isValidHttpUrl(normalizedUrl) ? normalizedUrl : '';
    if (!company && !title) continue;
    if (!isValidDate(dateApplied)) continue;
    try {
      apps.push(createApplication({ company, title, dateApplied, status, postingUrl }));
    } catch {
      // Skip rows that fail the same validation the form uses.
    }
  }
  return apps;
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
