// Keys come from the environment and are never written anywhere. Run the tools with Node's own loader:
//   node --env-file=<path to your .env> tools/assets/<tool>.mjs ...
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** Raw downloads and intermediate files: large, reproducible, never committed. */
export const CACHE = path.join(ROOT, 'assets/.cache');
export const SHEETS = path.join(ROOT, 'assets/sheets');
/** Where a design sheet is kept. JPEG, so that the sheets of every asset fit comfortably in git. */
export const sheetFile = (name) => path.join(SHEETS, `${name}.jpg`);
export const PUBLIC_ASSETS = path.join(ROOT, 'public/assets');

export const key = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run with: node --env-file=<your .env> ${path.relative(ROOT, process.argv[1] ?? '')}`);
  return value;
};

export const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/** One line per paid call, so the spend on each service can be added up afterwards. */
export const ledger = (entry) => {
  ensureDir(CACHE);
  fs.appendFileSync(path.join(CACHE, 'ledger.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
