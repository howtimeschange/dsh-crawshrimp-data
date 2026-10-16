import { mkdir, realpath, stat, readFile, open, unlink, link } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import AdmZip from 'adm-zip'
import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'

const MAX_BYTES = 10 * 1024 * 1024
const MAX_ROWS = 10000
const MAX_COLUMNS = 200
const MAX_CELLS = 200000
const MAX_CELL = 10000
const inside = (root, target) => target === root || target.startsWith(root + path.sep)
const check = signal => signal?.throwIfAborted()
function scalar(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) return value.result === undefined ? '[formula; no cached value]' : scalar(value.result)
    if (value.richText) return scalar(value.richText.map(x => x.text).join(''))
    if (value.text !== undefined) return scalar(String(value.text))
    throw new Error('Nested objects are not supported as cells')
  }
  if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Cells must be finite numbers, booleans, strings or null')
  if (String(value).length > MAX_CELL) throw new Error(`Cell exceeds ${MAX_CELL} characters`)
  return value
}
function headers(values) {
  const result = values.map(v => String(scalar(v)))
  if (!result.length || result.length > MAX_COLUMNS || result.some(v => !v.trim())) throw new Error('Table requires 1–200 nonempty column names')
  if (result.some(v => v.length > 256)) throw new Error('Column names may contain at most 256 characters')
  if (new Set(result).size !== result.length) throw new Error('Duplicate column names are not supported')
  return result
}
function table(matrix) {
  if (!matrix.length) return { columns: [], rows: [] }
  const columns = headers(matrix[0])
  if (matrix.length - 1 > MAX_ROWS || (matrix.length - 1) * columns.length > MAX_CELLS) throw new Error('Table exceeds 10000 rows or 200000 cells')
  const rows = matrix.slice(1).map(values => {
    if (values.length > columns.length) throw new Error('Row has more cells than the header')
    return Object.fromEntries(columns.map((key, i) => [key, scalar(values[i])]))
  })
  return { columns, rows }
}

export class DataFiles {
  static async create(workspaceDir) {
    await mkdir(path.resolve(workspaceDir), { recursive: true })
    return new DataFiles(await realpath(workspaceDir))
  }
  constructor(root) { this.root = root }
  async resolve(filename, writing = false) {
    if (typeof filename !== 'string' || !filename || filename.includes('\0')) throw new Error('A file path is required')
    const target = path.resolve(this.root, filename)
    if (!inside(this.root, target)) throw new Error('Path escapes workspaceDir')
    const resolved = writing ? path.join(await realpath(path.dirname(target)), path.basename(target)) : await realpath(target)
    if (!inside(this.root, resolved)) throw new Error('Symlink escapes workspaceDir')
    if (!['.csv', '.xlsx'].includes(path.extname(resolved).toLowerCase())) throw new Error('Only CSV and XLSX files are supported')
    return resolved
  }
  async load(args, signal) {
    check(signal)
    const target = await this.resolve(args.path)
    const info = await stat(target)
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Input must be a file no larger than 10 MiB')
    const bytes = await readFile(target, { signal })
    let value
    let sheets = []
    if (path.extname(target).toLowerCase() === '.csv') {
      if (args.sheet) throw new Error('sheet applies only to XLSX')
      value = table(parse(bytes.toString('utf8'), { bom: true, skip_empty_lines: true, max_record_size: 2 * 1024 * 1024, relax_column_count: true }))
    } else {
      const entries = new AdmZip(bytes).getEntries()
      if (entries.length > 5000 || entries.reduce((sum, e) => sum + e.header.size, 0) > 50 * 1024 * 1024) throw new Error('XLSX archive exceeds limits')
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(bytes)
      check(signal)
      sheets = workbook.worksheets.map(s => s.name)
      const sheet = args.sheet ? workbook.getWorksheet(args.sheet) : workbook.worksheets[0]
      if (!sheet) throw new Error('Worksheet not found')
      if (sheet.rowCount > MAX_ROWS + 1 || sheet.columnCount > MAX_COLUMNS || sheet.rowCount * sheet.columnCount > MAX_CELLS + MAX_COLUMNS) throw new Error('Worksheet exceeds table limits')
      const matrix = []
      for (let i = 1; i <= sheet.rowCount; i++) {
        const row = sheet.getRow(i)
        matrix.push(Array.from({ length: sheet.columnCount }, (_, j) => row.getCell(j + 1).value))
      }
      value = table(matrix)
    }
    check(signal)
    return { ...value, path: path.relative(this.root, target), sheets }
  }
  async preview(args, signal) {
    const offset = args.offset ?? 0, limit = args.limit ?? 20
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid offset/limit')
    const value = await this.load(args, signal)
    const rows = value.rows.slice(offset, offset + limit)
    if (Buffer.byteLength(JSON.stringify(rows)) > 512 * 1024) throw new Error('Preview exceeds 512 KiB; use a lower limit')
    return { path: value.path, sheets: value.sheets, columns: value.columns, totalRows: value.rows.length, offset, rows }
  }
  async profile(args, signal) {
    const value = await this.load(args, signal)
    const columns = value.columns.map(name => {
      const all = value.rows.map(row => row[name])
      const present = all.filter(x => x !== '' && x !== null)
      const numeric = present.filter(x => (typeof x === 'number') || (typeof x === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(x.trim()))).map(Number).filter(Number.isFinite)
      const sum = numeric.reduce((a, b) => a + b, 0)
      return { name, missing: all.length - present.length, distinct: new Set(present.map(x => `${typeof x}:${x}`)).size,
        numericCount: numeric.length, ...(numeric.length ? { min: Math.min(...numeric), max: Math.max(...numeric), sum: Number.isFinite(sum) ? sum : null, mean: Number.isFinite(sum) ? sum / numeric.length : null } : {}) }
    })
    check(signal)
    return { path: value.path, totalRows: value.rows.length, columns }
  }
  async export(args, signal) {
    check(signal)
    if (!Array.isArray(args.rows) || !args.rows.length || args.rows.length > MAX_ROWS || Buffer.byteLength(JSON.stringify(args.rows)) > 5 * 1024 * 1024) throw new Error('Provide 1–10000 records, up to 5 MiB JSON')
    if (args.rows.some(r => !r || Array.isArray(r) || typeof r !== 'object')) throw new Error('Each row must be an object')
    const columns = headers([...new Set(args.rows.flatMap(Object.keys))])
    if (columns.length * args.rows.length > MAX_CELLS) throw new Error('Output exceeds 200000 cells')
    const rows = args.rows.map(row => columns.map(key => scalar(row[key])))
    const target = await this.resolve(args.path, true)
    let bytes
    if (target.toLowerCase().endsWith('.csv')) {
      bytes = Buffer.from(stringify([columns, ...rows], { bom: true, escape_formulas: true }), 'utf8')
    } else {
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('Data')
      sheet.addRow(columns)
      sheet.addRows(rows)
      sheet.getRow(1).font = { bold: true }
      sheet.views = [{ state: 'frozen', ySplit: 1 }]
      bytes = Buffer.from(await workbook.xlsx.writeBuffer())
    }
    check(signal)
    const temp = path.join(path.dirname(target), `.crawshrimp-${randomUUID()}.tmp`)
    let handle
    try {
      handle = await open(temp, 'wx', 0o600)
      await handle.writeFile(bytes, { signal })
      await handle.close(); handle = undefined
      check(signal)
      await link(temp, target)
    } finally {
      await handle?.close()
      await unlink(temp).catch(() => {})
    }
    return { path: path.relative(this.root, target), rowCount: rows.length, columns, bytes: bytes.length,
      ...(target.toLowerCase().endsWith('.csv') ? { formulaProtection: 'Potential spreadsheet formulas are prefixed with an apostrophe' } : {}) }
  }
}
