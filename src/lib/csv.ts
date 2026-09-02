import { HEADERS, STATUS_LABELS, type Application } from './types';
import {
  createApplication,
  escapeFormula,
  isValidDate,
  isValidHttpUrl,
  normalizePostingUrl,
  normalizeStatus,
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
 * `Received Offer` stays in column 4 for older importers; `Status` carries
 * the full stage.
 */
export function applicationsToCsv(apps: Application[]): string {
  const lines = [HEADERS.join(',')];
  for (const app of apps) {
    lines.push(
      [
        csvField(escapeFormula(app.company)),
        csvField(escapeFormula(app.title)),
        csvField(app.dateApplied),
        app.receivedOffer ? 'TRUE' : 'FALSE',
        csvField(escapeFormula(app.postingUrl)),
        csvField(escapeFormula(STATUS_LABELS[app.status]))
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

type ColumnMap = {
  company: number;
  title: number;
  dateApplied: number;
  receivedOffer: number;
  postingUrl: number;
  status: number;
};

/** Column order used when a file has no header row. */
const POSITIONAL_COLUMNS: ColumnMap = {
  company: 0,
  title: 1,
  dateApplied: 2,
  receivedOffer: 3,
  postingUrl: 4,
  status: 5
};

const HEADER_ALIASES: Record<string, keyof ColumnMap> = {
  company: 'company',
  employer: 'company',
  title: 'title',
  role: 'title',
  position: 'title',
  'date applied': 'dateApplied',
  date: 'dateApplied',
  applied: 'dateApplied',
  'received offer': 'receivedOffer',
  offer: 'receivedOffer',
  'posting url': 'postingUrl',
  url: 'postingUrl',
  link: 'postingUrl',
  posting: 'postingUrl',
  status: 'status',
  stage: 'status',
  outcome: 'status'
};

/**
 * Read a header row into column positions, so a sheet may reorder columns or
 * omit the ones added later. Returns null when the row is data, not a header.
 */
function parseHeader(cols: string[]): ColumnMap | null {
  const names = cols.map((c) => c.trim().toLowerCase());
  if (names[0] !== 'company' || names[1] !== 'title') {
    return null;
  }
  const map: ColumnMap = {
    company: -1,
    title: -1,
    dateApplied: -1,
    receivedOffer: -1,
    postingUrl: -1,
    status: -1
  };
  names.forEach((name, index) => {
    const field = HEADER_ALIASES[name];
    if (field && map[field] < 0) {
      map[field] = index;
    }
  });
  return map;
}

function cell(cols: string[], index: number): string {
  return index < 0 ? '' : cols[index] ?? '';
}

/**
 * Parse a CSV produced by this app (or a Google Sheet export with the same
 * headers) into application records. Files written before stages existed
 * still import: `Received Offer` alone decides between offer and applied.
 * Invalid rows are skipped.
 */
export function parseApplicationsCsv(text: string): Application[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];

  const header = parseHeader(splitCsvLine(lines[0]));
  const columns = header ?? POSITIONAL_COLUMNS;
  const apps: Application[] = [];
  for (let i = header ? 1 : 0; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const company = unescapeImported(cell(cols, columns.company));
    const title = unescapeImported(cell(cols, columns.title));
    const dateApplied = cell(cols, columns.dateApplied).trim();
    const receivedOffer = toBoolean(cell(cols, columns.receivedOffer).trim());
    const rawStatus = unescapeImported(cell(cols, columns.status));
    const status = normalizeStatus(rawStatus, receivedOffer ? 'offer' : 'applied');
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
