const OPERATORS = new Set(['eq', 'ne', 'contains', 'in', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'not_empty'])
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const own = (object, key) => Object.hasOwn(object, key)
const empty = value => value === '' || value === null || value === undefined
function number(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && NUMBER.test(value.trim()) && Number.isFinite(Number(value))) return Number(value)
  return undefined
}
function scalar(value) {
  if (value === null) return null
  if (typeof value === 'string' && value.length <= 10000) return value
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error('Filter values must be scalar JSON values')
}
function names(value, label, known, max = 200) {
  if (!Array.isArray(value) || !value.length || value.length > max || value.some(x => typeof x !== 'string' || !known.includes(x)) || new Set(value).size !== value.length) throw new Error(`${label} must name unique existing columns`)
  return value
}

/** A bounded, declarative table pipeline. No caller code or expressions execute. */
export function transformTable(source, args) {
  const known = source.columns
  const selected = args.columns === undefined ? known : names(args.columns, 'columns', known)
  const rename = args.rename ?? {}
  if (!rename || typeof rename !== 'object' || Array.isArray(rename) || Object.keys(rename).length > 200) throw new Error('rename must be an object with at most 200 fields')
  for (const [from, to] of Object.entries(rename)) {
    if (!selected.includes(from) || typeof to !== 'string' || !to.trim() || to.length > 256) throw new Error('rename must map selected columns to nonempty names of at most 256 characters')
  }
  const columns = selected.map(key => own(rename, key) ? rename[key] : key)
  if (new Set(columns).size !== columns.length) throw new Error('Renamed columns must remain unique')
  const filters = args.filters ?? []
  if (!Array.isArray(filters) || filters.length > 20) throw new Error('At most 20 filters are allowed')
  const predicates = filters.map(filter => {
    if (!filter || !known.includes(filter.column) || !OPERATORS.has(filter.op)) throw new Error('Filter requires an existing column and a supported operator')
    const { column, op } = filter
    if (op === 'is_empty') return row => empty(row[column])
    if (op === 'not_empty') return row => !empty(row[column])
    if (op === 'in') {
      if (!Array.isArray(filter.values) || !filter.values.length || filter.values.length > 100) throw new Error('in requires 1–100 scalar values')
      const values = filter.values.map(scalar)
      return row => values.includes(row[column])
    }
    if (!own(filter, 'value')) throw new Error(`${op} requires value`)
    const value = scalar(filter.value)
    if (op === 'eq') return row => row[column] === value
    if (op === 'ne') return row => row[column] !== value
    if (op === 'contains') {
      if (typeof value !== 'string') throw new Error('contains requires a string value')
      return row => String(row[column]).includes(value)
    }
    const target = number(value)
    if (target === undefined) throw new Error('Numeric comparisons require a finite decimal value')
    return row => {
      const actual = number(row[column])
      if (actual === undefined) return false
      return op === 'gt' ? actual > target : op === 'gte' ? actual >= target : op === 'lt' ? actual < target : actual <= target
    }
  })
  let rows = source.rows.filter(row => predicates.every(predicate => predicate(row)))
  const filteredRows = rows.length
  if (args.dedupeBy !== undefined) {
    const keys = names(args.dedupeBy, 'dedupeBy', known)
    const seen = new Set()
    rows = rows.filter(row => {
      const key = JSON.stringify(keys.map(column => row[column]))
      if (seen.has(key)) return false
      seen.add(key); return true
    })
  }
  const duplicatesRemoved = filteredRows - rows.length
  const sortBy = args.sortBy ?? []
  if (!Array.isArray(sortBy) || sortBy.length > 5) throw new Error('At most five sort keys are allowed')
  for (const item of sortBy) {
    if (!item || !known.includes(item.column) || !['asc', 'desc'].includes(item.direction ?? 'asc') || (item.numeric !== undefined && typeof item.numeric !== 'boolean')) throw new Error('Invalid sort specification')
  }
  if (sortBy.length) rows = [...rows].sort((left, right) => {
    for (const item of sortBy) {
      const a = item.numeric ? number(left[item.column]) : left[item.column]
      const b = item.numeric ? number(right[item.column]) : right[item.column]
      const missingA = empty(a), missingB = empty(b)
      if (missingA !== missingB) return missingA ? 1 : -1 // missing values always sort last
      if (missingA || a === b) continue
      const compareA = item.numeric ? a : String(a)
      const compareB = item.numeric ? b : String(b)
      const result = compareA < compareB ? -1 : compareA > compareB ? 1 : 0
      if (result) return item.direction === 'desc' ? -result : result
    }
    return 0
  })
  return { columns, rows: rows.map(row => Object.fromEntries(selected.map((key, i) => [columns[i], row[key]]))),
    stats: { inputRows: source.rows.length, filteredRows, duplicatesRemoved, outputRows: rows.length } }
}

export function boundedPreview(rows, limit = 20, maxBytes = 256 * 1024) {
  const preview = []
  let size = 2
  for (const row of rows.slice(0, limit)) {
    const bytes = Buffer.byteLength(JSON.stringify(row)) + 1
    if (size + bytes > maxBytes) break
    preview.push(row); size += bytes
  }
  return { preview, previewTruncated: preview.length < rows.length }
}
