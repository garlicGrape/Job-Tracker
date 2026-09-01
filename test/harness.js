/**
 * Test harness for the Apps Script backend.
 *
 * Apps Script's V8 runtime shares one global scope across `.gs` files, so
 * `src/Code.gs` is plain JavaScript. Here we read it as text and evaluate it in
 * a Node `vm` context with fake `SpreadsheetApp` / `LockService` globals, then
 * return the defined functions so tests can call them directly — offline, with
 * no Google runtime.
 *
 * NOTE: This file encodes the assumptions the real Google services must satisfy.
 * If a test fails, fix `src/Code.gs`, not this harness.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const CODE_PATH = join(here, '..', 'src', 'Code.gs');

/**
 * Load `Code.gs` into a fresh VM context seeded with the provided fake globals.
 * Top-level `function` and `var` declarations become properties of the context,
 * so the returned object exposes them (e.g. `code.addApplication`).
 */
export function loadCode(globals = {}) {
  const source = readFileSync(CODE_PATH, 'utf8');
  const context = { console, ...globals };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'Code.gs' });
  return context;
}

/**
 * Build a fake spreadsheet + lock service backed by an in-memory 2D grid.
 *
 * @param {Array<Array<*>>} initialGrid rows of the sheet (row 0 === sheet row 1)
 * @param {{ hasSheet?: boolean }} options
 */
export function createFakeEnvironment(initialGrid = [], options = {}) {
  const hasSheet = options.hasSheet !== false;
  const grid = initialGrid.map((row) => [...row]);

  const cell = (r, c) => {
    const row = grid[r];
    if (!row) return '';
    return row[c] === undefined ? '' : row[c];
  };

  const sheet = {
    getName: () => 'Applications',
    getLastRow: () => grid.length,
    getLastColumn: () =>
      grid.reduce((max, row) => Math.max(max, row.length), 0),
    getDataRange: () => ({
      getValues: () => grid.map((row) => [...row])
    }),
    getRange: (row, col, numRows = 1, numCols = 1) => ({
      getValues: () => {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const rowOut = [];
          for (let c = 0; c < numCols; c++) {
            rowOut.push(cell(row - 1 + r, col - 1 + c));
          }
          out.push(rowOut);
        }
        return out;
      },
      setValues: (values) => {
        for (let r = 0; r < values.length; r++) {
          const gr = row - 1 + r;
          if (!grid[gr]) grid[gr] = [];
          for (let c = 0; c < values[r].length; c++) {
            grid[gr][col - 1 + c] = values[r][c];
          }
        }
      },
      setValue: (value) => {
        const gr = row - 1;
        if (!grid[gr]) grid[gr] = [];
        grid[gr][col - 1] = value;
      }
    }),
    appendRow: (rowValues) => {
      grid.push([...rowValues]);
    }
  };

  const spreadsheet = {
    getSheetByName: (name) => (hasSheet && name === 'Applications' ? sheet : null)
  };

  const SpreadsheetApp = {
    getActiveSpreadsheet: () => spreadsheet
  };

  const lockState = { waitCalls: 0, releaseCalls: 0, held: false };
  const lock = {
    waitLock: () => {
      lockState.waitCalls++;
      lockState.held = true;
    },
    tryLock: () => {
      lockState.waitCalls++;
      lockState.held = true;
      return true;
    },
    releaseLock: () => {
      lockState.releaseCalls++;
      lockState.held = false;
    }
  };
  const LockService = {
    getScriptLock: () => lock,
    getDocumentLock: () => lock,
    getUserLock: () => lock
  };

  return { SpreadsheetApp, LockService, sheet, grid, lockState };
}

/**
 * Convenience: build the fake environment and load Code.gs against it.
 */
export function setup(initialGrid = [], options = {}) {
  const env = createFakeEnvironment(initialGrid, options);
  const code = loadCode({
    SpreadsheetApp: env.SpreadsheetApp,
    LockService: env.LockService
  });
  return { ...env, code };
}

export const HEADER_ROW = ['Company', 'Title', 'Date Applied', 'Received Offer'];
