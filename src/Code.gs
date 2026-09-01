/**
 * Job Tracker — Google Apps Script backend.
 *
 * Records job applications to a bound Google Sheet. This file is plain V8
 * JavaScript: the Node test harness reads it as text and evaluates it with fake
 * `SpreadsheetApp` / `LockService` globals, so keep everything here dependency
 * free (no imports, no npm packages, no `fetch`).
 */

var SHEET_NAME = 'Applications';
var HEADERS = ['Company', 'Title', 'Date Applied', 'Received Offer'];

// Column positions (1-indexed) mirror HEADERS above.
var COL_COMPANY = 1;
var COL_TITLE = 2;
var COL_DATE = 3;
var COL_OFFER = 4;

// Row 1 is the header, so application data starts on row 2.
var FIRST_DATA_ROW = 2;

var LOCK_TIMEOUT_MS = 30000;

/**
 * Serve the single-page UI.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Job Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Return the bound `Applications` sheet, throwing a clear error if it is
 * missing rather than silently creating one in the wrong place.
 */
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('Sheet "' + SHEET_NAME + '" not found. Create a tab named ' + SHEET_NAME + '.');
  }
  return sheet;
}

/**
 * Write the header row if it is not already present. The sheet ships with an
 * empty row 1; the code owns the header so a fresh sheet just works.
 */
function ensureHeader_(sheet) {
  var firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var hasHeader = true;
  for (var i = 0; i < HEADERS.length; i++) {
    if (firstRow[i] !== HEADERS[i]) {
      hasHeader = false;
      break;
    }
  }
  if (!hasHeader) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
}

/**
 * Neutralize spreadsheet formula injection. A value beginning with =, +, -, @
 * (or a leading tab / carriage return) is treated as a formula by Sheets, so we
 * prefix it with an apostrophe to force it to be stored as literal text.
 */
function escapeFormula_(value) {
  var str = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return "'" + str;
  }
  return str;
}

/**
 * Coerce an arbitrary truthy/checkbox value into a real boolean.
 */
function toBoolean_(value) {
  return value === true || value === 'true' || value === 'TRUE' || value === 1;
}

/**
 * Validate a YYYY-MM-DD string and confirm it is a real calendar date. Dates
 * are stored as text (never Date objects) to avoid Apps Script timezone drift.
 */
function isValidDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  var parts = value.split('-');
  var year = Number(parts[0]);
  var month = Number(parts[1]);
  var day = Number(parts[2]);
  if (month < 1 || month > 12) {
    return false;
  }
  var daysInMonth = new Date(year, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}

/**
 * Validate and normalize a raw application payload from the client. Returns a
 * clean object; throws on invalid input.
 */
function validateApplication_(app) {
  if (!app || typeof app !== 'object') {
    throw new Error('Invalid application.');
  }
  var company = (app.company == null ? '' : String(app.company)).trim();
  var title = (app.title == null ? '' : String(app.title)).trim();
  var dateApplied = (app.dateApplied == null ? '' : String(app.dateApplied)).trim();

  if (!company) {
    throw new Error('Company is required.');
  }
  if (!title) {
    throw new Error('Title is required.');
  }
  if (!isValidDate_(dateApplied)) {
    throw new Error('Date Applied must be a valid date in YYYY-MM-DD format.');
  }

  return {
    company: company,
    title: title,
    dateApplied: dateApplied,
    receivedOffer: toBoolean_(app.receivedOffer)
  };
}

/**
 * Append a new application. Guarded by a script lock so a double-click cannot
 * append twice or read a stale last row.
 */
function addApplication(app) {
  var clean = validateApplication_(app);

  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    var sheet = getSheet_();
    ensureHeader_(sheet);
    sheet.appendRow([
      escapeFormula_(clean.company),
      escapeFormula_(clean.title),
      clean.dateApplied,
      clean.receivedOffer
    ]);
  } finally {
    lock.releaseLock();
  }

  return getApplications();
}

/**
 * Read every application as an array of objects, newest last. `rowNumber` is the
 * 1-indexed sheet row, which the client passes back to `setOffer`.
 */
function getApplications() {
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < FIRST_DATA_ROW) {
    return [];
  }

  var apps = [];
  for (var r = FIRST_DATA_ROW - 1; r < values.length; r++) {
    var row = values[r];
    if ((row[COL_COMPANY - 1] === '' || row[COL_COMPANY - 1] == null) &&
        (row[COL_TITLE - 1] === '' || row[COL_TITLE - 1] == null)) {
      continue;
    }
    apps.push({
      rowNumber: r + 1,
      company: row[COL_COMPANY - 1],
      title: row[COL_TITLE - 1],
      dateApplied: row[COL_DATE - 1],
      receivedOffer: toBoolean_(row[COL_OFFER - 1])
    });
  }
  return apps;
}

/**
 * Toggle the "Received Offer" checkbox for a specific row.
 */
function setOffer(rowNumber, received) {
  var row = Number(rowNumber);
  if (!Number.isInteger(row) || row < FIRST_DATA_ROW) {
    throw new Error('Invalid row number.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    var sheet = getSheet_();
    if (row > sheet.getLastRow()) {
      throw new Error('Row ' + row + ' does not exist.');
    }
    sheet.getRange(row, COL_OFFER).setValue(toBoolean_(received));
  } finally {
    lock.releaseLock();
  }

  return getApplications();
}
