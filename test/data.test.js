import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile, symlink, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as plugin from '../lib/index.js'
import { DataFiles } from '../lib/tables.js'

async function workspace(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-data-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('exports Unicode XLSX and CSV, reads exact records and profiles missing/numeric fields', async t => {
  const files = await DataFiles.create(await workspace(t))
  const rows = [{ 商品: '棉衣', 价格: 39.5, 库存: 2 }, { 商品: '短裤', 价格: 60.5, 库存: null }]
  for (const ext of ['xlsx', 'csv']) {
    await files.export({ path: `products.${ext}`, rows })
    const preview = await files.preview({ path: `products.${ext}`, limit: 1, offset: 1 })
    assert.equal(preview.totalRows, 2)
    assert.equal(preview.rows[0].商品, '短裤')
    const profile = await files.profile({ path: `products.${ext}` })
    assert.equal(profile.columns.find(c => c.name === '价格').sum, 100)
    assert.equal(profile.columns.find(c => c.name === '库存').missing, 1)
  }
})

test('CSV export neutralizes formulas including headers; XLSX stores formula-like strings literally', async t => {
  const dir = await workspace(t), files = await DataFiles.create(dir)
  const rows = [{ '=header': '=1+1', safe: '+SUM(A1)' }]
  await files.export({ path: 'literal.csv', rows })
  const raw = await readFile(path.join(dir, 'literal.csv'), 'utf8')
  assert.match(raw, /'=header/)
  assert.match(raw, /'=1\+1/)
  await files.export({ path: 'literal.xlsx', rows })
  assert.equal((await files.preview({ path: 'literal.xlsx' })).rows[0]['=header'], '=1+1')
})

test('rejects traversal, symlink escape, overwrite, malformed headers and excessive cells', async t => {
  const dir = await workspace(t), outside = await workspace(t), files = await DataFiles.create(dir)
  await writeFile(path.join(outside, 'data.csv'), 'a\nsecret\n')
  await symlink(outside, path.join(dir, 'outside'))
  await assert.rejects(files.preview({ path: '../other.csv' }), /escapes/)
  await assert.rejects(files.preview({ path: 'outside/data.csv' }), /escapes/)
  await assert.rejects(files.export({ path: 'outside/new.csv', rows: [{ a: 1 }] }), /escapes/)
  await files.export({ path: 'keep.csv', rows: [{ a: 'original' }] })
  await assert.rejects(files.export({ path: 'keep.csv', rows: [{ a: 'changed' }] }), /EEXIST/)
  assert.equal((await files.preview({ path: 'keep.csv' })).rows[0].a, 'original')
  await writeFile(path.join(dir, 'duplicate.csv'), 'a,a\n1,2\n')
  await assert.rejects(files.preview({ path: 'duplicate.csv' }), /Duplicate/)
  await assert.rejects(files.export({ path: 'big.csv', rows: [{ a: 'x'.repeat(10001) }] }), /Cell exceeds/)
  assert.equal((await readdir(dir)).some(n => n.endsWith('.tmp')), false)
})

test('aborted output does not create a file', async t => {
  const dir = await workspace(t), files = await DataFiles.create(dir)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(files.export({ path: 'abort.xlsx', rows: [{ a: 1 }] }, controller.signal), /abort/i)
  assert.deepEqual(await readdir(dir), [])
})

test('real Cordis/ToolRuntime registers, enforces approval, exports and unloads', async t => {
  const dir = await workspace(t), ctx = new Context()
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} })
  const runtime = ctx.plugin(ToolRuntime); await runtime
  const fiber = ctx.plugin(plugin, { workspaceDir: dir }); await fiber
  t.after(async () => { await fiber.dispose(); await runtime.dispose() })
  assert.equal(ctx.tools.schemas().length, 3)
  const call = { name: 'crawshrimp_data_export', callId: 'data-one', arguments: { path: 'approved.xlsx', rows: [{ 商品: 'T恤', 销量: 5 }] }, agent: { id: 'a', session: { id: 's' } }, signal: new AbortController().signal }
  const denied = await ctx.tools.execute(call)
  assert.equal(denied.isError, true)
  assert.deepEqual(await readdir(dir), [])
  const requests = []
  const approval = ctx.provide('approval', { effectivePolicy: () => 'ask', request: async args => { requests.push(args); return 'allowed-once' } })
  const result = await ctx.tools.execute({ ...call, callId: 'data-two' })
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(requests[0].toolName, 'crawshrimp_data_export')
  assert.equal(requests[0].callId, 'data-two')
  const preview = await ctx.tools.execute({ ...call, name: 'crawshrimp_data_preview', callId: 'data-three', arguments: { path: 'approved.xlsx' } })
  assert.equal(preview.isError, false, JSON.stringify(preview))
  assert.equal(preview.value.structuredContent.rows[0].销量, 5)
  await fiber.dispose()
  assert.equal(ctx.tools.schemas().length, 0)
  await approval()
})
