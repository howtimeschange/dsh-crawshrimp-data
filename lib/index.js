import z from '@deepseek-ai/schemastery'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import { DataFiles } from './tables.js'

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
  const common = { path: { type: 'string', description: 'CSV or XLSX path within workspaceDir' }, sheet: { type: 'string' } }
  const specs = [
    { name: 'crawshrimp_data_preview', description: 'Preview local CSV/XLSX rows; no formulas or macros are executed.',
      properties: { ...common, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['path'],
      run: (a, e) => files.preview(a, e.signal) },
    { name: 'crawshrimp_data_profile', description: 'Profile all loaded table rows: missing values, distinct values and numeric summaries.',
      properties: common, required: ['path'], run: (a, e) => files.profile(a, e.signal) },
    { name: 'crawshrimp_data_export', description: 'Create a new CSV or XLSX file from JSON records. Existing files are never overwritten.',
      properties: { path: { type: 'string' }, rows: { type: 'array', items: { type: 'object', additionalProperties: true }, minItems: 1, maxItems: 10000 } }, required: ['path', 'rows'],
      run: async (a, e) => { await approve(ctx, e, 'crawshrimp_data_export', { path: a.path, rowCount: a.rows.length }); return files.export(a, e.signal) } },
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
          const value = await tool.run(args, { ...exec, signal })
          return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }
        },
      })))
    } catch (error) { lifetime.abort(); for (const dispose of disposers.reverse()) dispose(); throw error }
    return () => { lifetime.abort(); for (const dispose of disposers.reverse()) dispose() }
  })
}
