'use client';

/**
 * Dynamic Excel template engine — the source of truth is the Coaching Form.
 *
 * Nothing here hard-codes parameter columns. `templateColumns(form)` derives the
 * whole column set from the selected form (standard fields + the form's own
 * custom metadata fields + its parameters, in order), so a new form with new
 * parameters automatically produces the right template and the right validation.
 *
 * These are deliberately pure functions over a `FormTemplate` — the same code
 * can run in the browser today and behind the API later, unchanged.
 */

import * as XLSX from 'xlsx';
import { validateMetaValue, type FormTemplate, type MetaField, type TemplateParam } from './mock-data';
// (Excel time/date serials are normalized in parseAndValidate.)

/** The eleven fixed fields every generated template carries, in order. */
export const STANDARD_FIELDS = [
  'Agent Name', 'EID', 'Supervisor', 'Quality Auditor',
  'Call Date', 'Audit Date', 'Disposition', 'Call Reason',
  'Call ID', 'AHT', 'Total Hold Time',
] as const;

const META_SHEET = '_meta';
const DATA_SHEET = 'Audit Data';
const INSTR_SHEET = 'Instructions';

const sortedParams = (form: FormTemplate): TemplateParam[] =>
  [...form.params].sort((a, b) => a.sortOrder - b.sortOrder);
const metaFields = (form: FormTemplate): MetaField[] => form.metaFields ?? [];

export const parameterColumns = (form: FormTemplate): string[] => sortedParams(form).map((p) => p.text);
export const metaColumns = (form: FormTemplate): string[] => metaFields(form).map((f) => f.label);

/** Full ordered column set the template exposes and the upload is validated against. */
export function templateColumns(form: FormTemplate): string[] {
  return [...STANDARD_FIELDS, ...metaColumns(form), ...parameterColumns(form)];
}

// ------------------------------------------------------------------
// Generation
// ------------------------------------------------------------------

function buildWorkbook(form: FormTemplate): XLSX.WorkBook {
  const cols = templateColumns(form);

  const data = XLSX.utils.aoa_to_sheet([cols]);
  data['!cols'] = cols.map((c) => ({ wch: Math.min(Math.max(c.length + 2, 12), 46) }));
  data['!freeze'] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, data, DATA_SHEET);

  const instr = XLSX.utils.aoa_to_sheet([
    ['AWR Quality Coaching — Audit upload template'],
    [],
    ['Coaching form', form.name],
    ['Version', form.version],
    ['Line of business', form.lineOfBusiness],
    [],
    ['How to use'],
    ['1. Fill one row per audited transaction in the "Audit Data" sheet.'],
    ['2. Every standard field is required.'],
    ['3. Parameter columns take the audit RESULT only — Yes, No, or N/A.'],
    ['4. QA remarks are NOT entered here — you add them on the website during QA Review.'],
    ['5. Do not rename, add, remove, or reorder columns. The upload is validated'],
    ['   against this exact form and version.'],
    ['6. Dates use YYYY-MM-DD. AHT and Total Hold Time use HH:MM:SS or a number of seconds.'],
    [],
    ['Column', 'Type', 'Allowed values'],
    ...STANDARD_FIELDS.map((f) => [f, 'Standard', dateish(f) ? 'YYYY-MM-DD' : timeish(f) ? 'HH:MM:SS or seconds' : 'Text']),
    ...metaFields(form).map((f) => [f.label, `Custom (${f.type})${f.required ? ', required' : ''}`, metaHint(f.type)]),
    ...parameterColumns(form).map((p) => [p, 'Parameter (result)', 'Yes / No / N/A']),
  ]);
  instr['!cols'] = [{ wch: 42 }, { wch: 22 }, { wch: 26 }];
  XLSX.utils.book_append_sheet(wb, instr, INSTR_SHEET);

  // Hidden provenance sheet — lets the upload prove which form/version generated
  // the file and that the columns were not tampered with.
  const meta = XLSX.utils.aoa_to_sheet([
    ['key', 'value'],
    ['app', 'AWR Quality Coaching'],
    ['formId', form.id],
    ['slug', form.slug],
    ['formName', form.name],
    ['version', form.version],
    ['columns', cols.join('||')],
    ['generatedAt', new Date().toISOString()],
  ]);
  XLSX.utils.book_append_sheet(wb, meta, META_SHEET);
  // Mark the meta sheet hidden (index 2). Community SheetJS honors this on write.
  wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }] };

  return wb;
}

const slugForFile = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** Triggers a browser download of the dynamically generated template. */
export function downloadTemplate(form: FormTemplate): void {
  const wb = buildWorkbook(form);
  const name = `coaching-template_${form.slug || slugForFile(form.name)}_v${slugForFile(form.version)}.xlsx`;
  XLSX.writeFile(wb, name);
}

// ------------------------------------------------------------------
// Parsing + validation
// ------------------------------------------------------------------

export interface UploadIssue { row: number | null; column: string | null; message: string }
export interface ParsedRecord {
  rowNumber: number;
  standard: Record<string, string>;
  metaValues: Record<string, string>;
  params: Record<number, 'YES' | 'NO' | 'NA'>;
}
export interface ValidationResult {
  ok: boolean;
  errors: UploadIssue[];
  warnings: string[];
  records: ParsedRecord[];
  boundForm: { id?: string; version?: string } | null;
}

const dateish = (f: string) => f === 'Call Date' || f === 'Audit Date';
const timeish = (f: string) => f === 'AHT' || f === 'Total Hold Time';
const metaHint = (t: MetaField['type']) =>
  t === 'number' ? 'Number' : t === 'integer' ? 'Whole number' : t === 'date' ? 'YYYY-MM-DD' : t === 'time' ? 'HH:MM' : 'Text';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Excel day 0 is 1899-12-30 (it carries the 1900 leap-year bug). */
function excelSerialToDate(n: number): Date {
  return new Date(Math.round((n - 25569) * 86400000));
}

/**
 * Excel stores a typed date as a serial number and a typed time as a fraction of
 * a day. SheetJS returns those raw numbers, so we normalize from the raw cell
 * value — not the stringified serial — and return clean text (or null if invalid).
 */
function normalizeDate(raw: unknown): string | null {
  if (raw === '' || raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw < 1 || raw > 401768) return null; // sane serial range (year ~1 to ~3000)
    const d = excelSerialToDate(Math.floor(raw));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.isNaN(Date.parse(s)) ? null : s;
  const t = Date.parse(s); // handles MM/DD/YYYY and similar
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Total seconds from an Excel time serial (a day fraction), a plain seconds
 * count, or an "HH:MM:SS" / "MM:SS" string. Null if it can't be read. */
function excelToSeconds(raw: unknown): number | null {
  if (raw === '' || raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > 0 && raw < 1) return Math.round(raw * 86400);   // time fraction of a day
    if (Number.isInteger(raw) && raw >= 0) return raw;        // a plain seconds count
    if (raw >= 1) return Math.round(raw * 86400);             // multi-day time serial
    return null;
  }
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d{1,3}:\d{2}(:\d{2})?$/.test(s)) return s.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
  if (/^\d*\.\d+$/.test(s)) { const f = Number(s); return f < 1 ? Math.round(f * 86400) : Math.round(f); }
  return null;
}

function fmtSeconds(total: number): string {
  return `${pad2(Math.floor(total / 3600))}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`;
}
function normResult(v: string): 'YES' | 'NO' | 'NA' | null {
  const s = v.trim().toLowerCase().replace(/[.\s]/g, '');
  if (['yes', 'y', 'pass', 'p', '1'].includes(s)) return 'YES';
  if (['no', 'n', 'fail', 'f', '0'].includes(s)) return 'NO';
  if (['na', 'n/a', 'notapplicable', '-'].includes(s)) return 'NA';
  return null;
}

/** Validate an uploaded workbook against the selected form (and its version). */
export async function parseAndValidate(file: File, form: FormTemplate): Promise<ValidationResult> {
  const errors: UploadIssue[] = [];
  const warnings: string[] = [];
  let boundForm: ValidationResult['boundForm'] = null;

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  } catch {
    return { ok: false, errors: [{ row: null, column: null, message: 'This file could not be read as an Excel workbook.' }], warnings, records: [], boundForm };
  }

  // provenance
  const metaSheet = wb.Sheets[META_SHEET];
  if (metaSheet) {
    const kv: Record<string, string> = {};
    for (const r of XLSX.utils.sheet_to_json<string[]>(metaSheet, { header: 1 }).slice(1)) {
      if (r[0]) kv[String(r[0])] = String(r[1] ?? '');
    }
    boundForm = { id: kv.formId, version: kv.version };
    if (kv.formId && kv.formId !== form.id) {
      errors.push({ row: null, column: null, message: `This file was generated from a different Coaching Form (“${kv.formName || kv.formId}”). Re-download the template for “${form.name}”, or select that form.` });
    } else if (kv.version && kv.version !== form.version) {
      errors.push({ row: null, column: null, message: `This file was generated from “${form.name}” version ${kv.version}, but version ${form.version} is selected. Versions must match.` });
    }
  } else {
    warnings.push('No template provenance found in this file — validating by column names against the selected form.');
  }

  const dataName = wb.SheetNames.find((n) => n !== META_SHEET && n !== INSTR_SHEET) ?? wb.SheetNames[0];
  const ws = dataName ? wb.Sheets[dataName] : undefined;
  if (!ws) {
    errors.push({ row: null, column: null, message: 'No “Audit Data” sheet was found in this file.' });
    return { ok: false, errors, warnings, records: [], boundForm };
  }

  const grid = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, blankrows: false, defval: '' });
  if (grid.length === 0) {
    errors.push({ row: null, column: null, message: 'The “Audit Data” sheet is empty.' });
    return { ok: false, errors, warnings, records: [], boundForm };
  }

  const header = (grid[0] ?? []).map((c) => String(c).trim());
  const expected = templateColumns(form);
  const missing = expected.filter((c) => !header.includes(c));
  const unexpected = header.filter((c) => c && !expected.includes(c));
  missing.forEach((c) => errors.push({ row: 1, column: c, message: `Required column “${c}” is missing.` }));
  unexpected.forEach((c) => errors.push({ row: 1, column: c, message: `Unexpected column “${c}” — it is not part of “${form.name}”.` }));
  // A broken header makes per-row checks meaningless; stop here so the errors stay clear.
  if (missing.length || unexpected.length) {
    return { ok: false, errors, warnings, records: [], boundForm };
  }

  const idx: Record<string, number> = {};
  header.forEach((h, i) => { idx[h] = i; });
  const params = sortedParams(form);
  const metas = metaFields(form);

  if (grid.length < 2) {
    errors.push({ row: null, column: null, message: 'No audit rows found — the template has a header but no data.' });
    return { ok: false, errors, warnings, records: [], boundForm };
  }

  const records: ParsedRecord[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const excelRow = r + 1;
    const get = (c: string) => String(row[idx[c] ?? -1] ?? '').trim();
    const rawOf = (c: string): unknown => row[idx[c] ?? -1];

    // Standard fields — built and validated together. Times/dates are normalized
    // from the raw cell value (Excel stores them as numbers) and stored as clean
    // text, so a value that reads as "0.00785" in the file shows as "00:11:19".
    const standard: Record<string, string> = {};
    for (const f of STANDARD_FIELDS) {
      if (dateish(f)) {
        const norm = normalizeDate(rawOf(f));
        if (get(f) && !norm) errors.push({ row: excelRow, column: f, message: `“${get(f)}” is not a valid date.` });
        standard[f] = norm ?? get(f);
      } else if (timeish(f)) {
        const secs = excelToSeconds(rawOf(f));
        if (get(f) && secs === null) errors.push({ row: excelRow, column: f, message: `“${get(f)}” is not a valid time (HH:MM:SS or a number of seconds).` });
        standard[f] = secs !== null ? fmtSeconds(secs) : get(f);
      } else {
        standard[f] = get(f);
      }
      if (!standard[f].trim()) errors.push({ row: excelRow, column: f, message: `“${f}” is required.` });
    }

    const metaValues: Record<string, string> = {};
    for (const mf of metas) {
      const v = get(mf.label);
      metaValues[mf.label] = v;
      const err = validateMetaValue(mf, v);
      if (err) errors.push({ row: excelRow, column: mf.label, message: err });
    }

    const presult: Record<number, 'YES' | 'NO' | 'NA'> = {};
    for (const p of params) {
      const v = get(p.text);
      const norm = normResult(v);
      if (!norm) errors.push({ row: excelRow, column: p.text, message: `“${v || '(blank)'}” is not a valid result — allowed values are Yes, No, or N/A.` });
      else presult[p.sortOrder] = norm;
    }

    records.push({ rowNumber: excelRow, standard, metaValues, params: presult });
  }

  const ok = errors.length === 0;
  return { ok, errors, warnings, records: ok ? records : [], boundForm };
}
