import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import { DataFiles } from '../lib/tables.js'
import { transformTable, boundedPreview } from '../lib/transform.js'
import * as plugin from '../lib/index.js'

const products = [
  { sku: '001', 商品: '棉衣', price: '39.5', stock: 8 },
  { sku: '001', 商品: '棉衣重复', price: '39.5', stock: 8 },
  { sku: '002', 商品: '短裤', price: '60.5', stock: 0 },
  { sku: '003', 商品: '待补价', price: 'unknown', stock: 10 },
  { sku: '004', 商品: '袜子', price: '11', stock: null },
]

async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-transform-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = await DataFiles.create(root)
  await writeFile(path.join(root, 'products.json'), JSON.stringify({ success: true, data: products, meta: { action: 'complete' } }))
  return { root, files }
}

test('loads both script JSON artifacts and record arrays without losing leading-zero SKUs', async t => {
  const { root, files } = await setup(t)
  assert.equal((await files.preview({ path: 'products.json' })).rows[0].sku, '001')
  await writeFile(path.join(root, 'array.json'), JSON.stringify(products))
  const profile = await files.profile({ path: 'array.json' })
  assert.equal(profile.totalRows, 5)
  assert.equal(profile.columns.find(c => c.name === 'stock').missing, 1)
  await writeFile(path.join(root, 'failed.json'), JSON.stringify({ success: false, data: products }))
  await assert.rejects(files.preview({ path: 'failed.json' }), /success=false/)
  await writeFile(path.join(root, 'nested.json'), JSON.stringify([{ nested: { value: 1 } }]))
  await assert.rejects(files.preview({ path: 'nested.json' }), /Nested/)
})

test('filters, deduplicates, sorts and renames a merchant-style product table deterministically', async t => {
  const { files } = await setup(t), source = await files.load({ path: 'products.json' })
  const value = transformTable(source, { filters: [{ column: 'price', op: 'gt', value: 0 }], dedupeBy: ['sku'], sortBy: [{ column: 'price', direction: 'desc', numeric: true }], columns: ['sku', 'price'], rename: { sku: '货号', price: '售价' } })
  assert.deepEqual(value.stats, { inputRows: 5, filteredRows: 4, duplicatesRemoved: 1, outputRows: 3 })
  assert.deepEqual(value.rows, [{ 货号: '002', 售价: '60.5' }, { 货号: '001', 售价: '39.5' }, { 货号: '004', 售价: '11' }])
  const inStock = transformTable(source, { filters: [{ column: 'price', op: 'gte', value: 20 }, { column: 'stock', op: 'gt', value: 0 }], dedupeBy: ['sku'] })
  assert.equal(inStock.rows.length, 1)
  assert.equal(inStock.rows[0].商品, '棉衣')
})

test('equality preserves types, empty/membership filters work and invalid plans fail before output', async t => {
  const { files } = await setup(t), source = await files.load({ path: 'products.json' })
  assert.equal(transformTable(source, { filters: [{ column: 'sku', op: 'eq', value: 1 }] }).rows.length, 0)
  assert.equal(transformTable(source, { filters: [{ column: 'sku', op: 'in', values: ['001'] }] }).rows.length, 2)
  assert.equal(transformTable(source, { filters: [{ column: 'stock', op: 'is_empty' }] }).rows[0].sku, '004')
  assert.throws(() => transformTable(source, { filters: [{ column: 'absent', op: 'eq', value: 1 }] }), /existing column/)
  assert.throws(() => transformTable(source, { columns: ['sku', 'price'], rename: { sku: 'same', price: 'same' } }), /unique/)
  assert.throws(() => transformTable(source, { filters: [{ column: 'price', op: 'gt', value: 'NaN' }] }), /finite/)
  assert.throws(() => transformTable(source, { dedupeBy: ['absent'] }), /existing columns/)
})

test('JSON null and empty string remain distinct for equality and deduplication', async t => {
  const { root, files } = await setup(t)
  await writeFile(path.join(root, 'nullable.json'), JSON.stringify([{ value: null }, { value: '' }, { value: null }]))
  const source = await files.load({ path: 'nullable.json' })
  assert.deepEqual(source.rows, [{ value: null }, { value: '' }, { value: null }])
  assert.equal(transformTable(source, { filters: [{ column: 'value', op: 'eq', value: null }] }).rows.length, 2)
  assert.equal(transformTable(source, { filters: [{ column: 'value', op: 'eq', value: '' }] }).rows.length, 1)
  assert.deepEqual(transformTable(source, { dedupeBy: ['value'] }).rows, [{ value: null }, { value: '' }])
  const profile = await files.profile({ path: 'nullable.json' })
  assert.equal(profile.columns[0].missing, 3)
})

test('empty filtered results produce header-only CSV and XLSX with exact column names', async t => {
  const { files } = await setup(t), source = await files.load({ path: 'products.json' })
  const value = transformTable(source, { filters: [{ column: 'stock', op: 'gt', value: 100 }], columns: ['sku', '商品'] })
  for (const ext of ['csv', 'xlsx']) {
    await files.export({ path: `empty.${ext}`, columns: value.columns, rows: value.rows })
    const readback = await files.preview({ path: `empty.${ext}` })
    assert.equal(readback.totalRows, 0)
    assert.deepEqual(readback.columns, ['sku', '商品'])
  }
  await assert.rejects(files.export({ path: 'schema-missing.csv', rows: [] }), /declared columns/)
})

test('large cells are omitted from the bounded preview without corrupting stored values', () => {
  const row = { value: 'x'.repeat(10000) }
  const result = boundedPreview([row], 20, 100)
  assert.deepEqual(result.preview, [])
  assert.equal(result.previewTruncated, true)
  assert.equal(row.value.length, 10000)
})

test('actual ToolRuntime transforms read-only under never policy and audits rejected writes', async t => {
  const { root } = await setup(t), ctx = new Context()
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, context: () => () => {}, getContextOrder: () => 0 })
  const runtime = ctx.plugin(ToolRuntime); await runtime
  const native = ctx.plugin(ApprovalService, { policy: 'never' }); await native
  const fiber = ctx.plugin(plugin, { workspaceDir: root }); await fiber
  t.after(async () => { await fiber.dispose(); await native.dispose(); await runtime.dispose() })
  const events = [{ type: 'turn/start', data: {} }]
  const session = { id: 'transform-session', get seq() { return events.length }, eventAt: n => events[n], append: (type, data) => events.push({ type, data }) }
  const exec = args => ctx.tools.execute({ name: 'crawshrimp_data_transform', callId: 'transform-call', arguments: args, agent: { id: 'a', session }, signal: new AbortController().signal })
  const preview = await exec({ path: 'products.json', dedupeBy: ['sku'] })
  assert.equal(preview.isError, false, JSON.stringify(preview))
  assert.equal(preview.value.structuredContent.outputRows, 4)
  assert.equal(events.length, 1)
  const denied = await exec({ path: 'products.json', outputPath: 'denied.xlsx' })
  assert.equal(denied.isError, true)
  assert.equal(events.at(-1).data.outcome, 'rejected')
  assert.deepEqual(await readdir(root), ['products.json'])
})

test('approved ToolRuntime transform writes actual XLSX and refuses to replace the source', async t => {
  const { root } = await setup(t), ctx = new Context()
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} })
  const requests = []
  ctx.provide('approval', { request: async request => { requests.push(request); return 'allowed-once' } })
  const runtime = ctx.plugin(ToolRuntime); await runtime
  const fiber = ctx.plugin(plugin, { workspaceDir: root }); await fiber
  t.after(async () => { await fiber.dispose(); await runtime.dispose() })
  const args = { path: 'products.json', outputPath: 'clean.xlsx', filters: [{ column: 'price', op: 'gt', value: 0 }], dedupeBy: ['sku'], sortBy: [{ column: 'price', numeric: true, direction: 'desc' }], rename: { sku: '货号' } }
  const result = await ctx.tools.execute({ name: 'crawshrimp_data_transform', callId: 'approved-transform', arguments: args, agent: { id: 'a', session: { id: 's' } }, signal: new AbortController().signal })
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(result.value.structuredContent.artifact.rowCount, 3)
  assert.equal(requests[0].toolName, 'crawshrimp_data_transform')
  assert.deepEqual(requests[0].arguments.plan.sortBy, args.sortBy)
  assert.deepEqual(requests[0].arguments.plan.rename, args.rename)
  const files = await DataFiles.create(root)
  assert.equal((await files.preview({ path: 'clean.xlsx' })).rows[0].货号, '002')
  const before = await readFile(path.join(root, 'clean.xlsx'))
  await assert.rejects(files.export({ path: 'clean.xlsx', rows: [{ a: 1 }] }), /EEXIST/)
  assert.deepEqual(await readFile(path.join(root, 'clean.xlsx')), before)
})

test('invalid export data and escaped paths are rejected before asking for approval', async t => {
  const { root } = await setup(t), ctx = new Context()
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} })
  let requests = 0
  ctx.provide('approval', { request: async () => { requests++; return 'allowed-once' } })
  const runtime = ctx.plugin(ToolRuntime); await runtime
  const fiber = ctx.plugin(plugin, { workspaceDir: root }); await fiber
  t.after(async () => { await fiber.dispose(); await runtime.dispose() })
  for (const args of [{ path: '../escape.csv', rows: [{ a: 1 }] }, { path: 'nested.csv', rows: [{ a: { bad: true } }] }, { path: 'empty.csv', rows: [] }]) {
    const result = await ctx.tools.execute({ name: 'crawshrimp_data_export', callId: 'invalid-write', arguments: args, agent: { id: 'a', session: { id: 's' } }, signal: new AbortController().signal })
    assert.equal(result.isError, true)
  }
  assert.equal(requests, 0)
  assert.deepEqual(await readdir(root), ['products.json'])
})
