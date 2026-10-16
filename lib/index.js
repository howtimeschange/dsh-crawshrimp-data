import z from '@deepseek-ai/schemastery'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import { DataFiles } from './tables.js'
import { transformTable, boundedPreview } from './transform.js'

export const name = 'crawshrimp-data'
export const inject = ['tools']
export const Config = z.object({ workspaceDir: z.string().default('.') })

async function approve(ctx, execution, toolName, args) {
  execution.signal?.throwIfAborted()
  const approval = ctx.get('approval')
  if (!approval || !execution.agent) throw new Error('DSH approval service and an agent are required to write files')
  const outcome = await approval.request({ agent: execution.agent, toolName, callId: execution.callId,
    reason: 'Create a local data artifact', arguments: args, signal: execution.signal })
  if (outcome !== 'allowed-once') throw new Error('File write was not approved')
  execution.signal?.throwIfAborted()
}

export async function apply(ctx, config = {}) {
  const files = await DataFiles.create(config.workspaceDir || '.')
  const lifetime = new AbortController()
  const active = new Set()
  const columnList = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 200 }
  const common = { path: { type: 'string', description: 'CSV, XLSX or JSON record artifact path within workspaceDir' }, sheet: { type: 'string' } }
  const specs = [
    { name: 'crawshrimp_data_preview', description: 'Preview local CSV/XLSX/JSON records; no formulas or macros are executed.',
      properties: { ...common, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['path'],
      run: (a, e) => files.preview(a, e.signal) },
    { name: 'crawshrimp_data_profile', description: 'Profile all loaded table rows: missing values, distinct values and numeric summaries.',
      properties: common, required: ['path'], run: (a, e) => files.profile(a, e.signal) },
    { name: 'crawshrimp_data_export', description: 'Create a new CSV or XLSX file from JSON records. Existing files are never overwritten.',
      properties: { path: { type: 'string' }, columns: columnList, rows: { type: 'array', items: { type: 'object', additionalProperties: true }, maxItems: 10000 } }, required: ['path', 'rows'],
      run: async (a, e) => {
        const summary = await files.preflightExport(a, e.signal)
        await approve(ctx, e, 'crawshrimp_data_export', summary)
        return files.export(a, e.signal)
      } },
    { name: 'crawshrimp_data_transform', description: 'Filter, deduplicate, sort, select and rename local table columns. Omit outputPath for a read-only preview; provide it to create a new CSV/XLSX artifact with approval.',
      properties: { ...common, outputPath: { type: 'string' }, columns: columnList,
        rename: { type: 'object', additionalProperties: true }, dedupeBy: columnList,
        filters: { type: 'array', maxItems: 20, items: { type: 'object', properties: {
          column: { type: 'string' }, op: { type: 'string', enum: ['eq', 'ne', 'contains', 'in', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'not_empty'] }, value: {}, values: { type: 'array', items: {}, maxItems: 100 },
        }, required: ['column', 'op'], additionalProperties: false } },
        sortBy: { type: 'array', maxItems: 5, items: { type: 'object', properties: { column: { type: 'string' }, direction: { type: 'string', enum: ['asc', 'desc'] }, numeric: { type: 'boolean' } }, required: ['column'], additionalProperties: false } },
      }, required: ['path'],
      run: async (a, e) => {
        const source = await files.load(a, e.signal)
        const transformed = transformTable(source, a)
        e.signal.throwIfAborted()
        let artifact
        if (a.outputPath !== undefined) {
          const output = { path: a.outputPath, rows: transformed.rows, columns: transformed.columns }
          const summary = await files.preflightExport(output, e.signal)
          await approve(ctx, e, 'crawshrimp_data_transform', { source: source.path, output: summary, stats: transformed.stats,
            plan: { filters: a.filters ?? [], dedupeBy: a.dedupeBy ?? [], sortBy: a.sortBy ?? [], columns: a.columns ?? source.columns, rename: a.rename ?? {} } })
          artifact = await files.export(output, e.signal)
        }
        return { source: source.path, columns: transformed.columns, ...transformed.stats, ...boundedPreview(transformed.rows), ...(artifact ? { artifact } : {}) }
      } },
  ]
  ctx.effect(() => {
    const disposers = []
    try {
      for (const tool of specs) disposers.push(ctx.tools.register(createMcpToolDefinition(ctx, {
        name: tool.name, rawName: tool.name, description: tool.description,
        inputSchema: { type: 'object', properties: tool.properties, required: tool.required, additionalProperties: false },
        call: async (args, exec) => {
          const signal = exec.signal ? AbortSignal.any([exec.signal, lifetime.signal]) : lifetime.signal
          signal.throwIfAborted()
          const pending = tool.run(args, { ...exec, signal })
          active.add(pending)
          try {
            const value = await pending
            return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }
          } finally { active.delete(pending) }
        },
      })))
    } catch (error) { lifetime.abort(); for (const dispose of disposers.reverse()) dispose(); throw error }
    return async () => { lifetime.abort(); for (const dispose of disposers.reverse()) dispose(); await Promise.allSettled([...active]) }
  })
}
