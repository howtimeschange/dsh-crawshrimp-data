# Crawshrimp Data for DeepSeek Harness

[中文](README.zh-CN.md) · [DSH](https://github.com/deepseek-ai/deepseek-harness) · [Plugin topic](https://github.com/topics/dsh-plugin)

Local JSON, CSV and Excel tools that run inside DSH. No Crawshrimp application, backend, API token, Python runtime or companion plugin is required. This is an independent community project, not an official DeepSeek plugin.

| Tool | Capability |
| --- | --- |
| `crawshrimp_data_preview` | Read JSON/CSV/XLSX, select an XLSX sheet, paginate up to 100 rows |
| `crawshrimp_data_profile` | Missing values, distinct counts and numeric min/max/sum/mean |
| `crawshrimp_data_export` | JSON records to a new CSV or XLSX file |
| `crawshrimp_data_transform` | Filter, deduplicate, sort, select and rename columns; preview or save |

Useful for product-table checks, inventory summaries and turning browser/script results into spreadsheets. Files stay inside the configured workspace; writes use DSH's native permission signals. A session in `danger-full-access` with native approval policy `never` already has a standing Full Access grant, so the plugin proceeds without a duplicate per-call prompt. In `ask`, or when the sandbox/approval service is missing or cannot be read, the plugin keeps the native approval path and fails closed when it cannot grant the write. Existing files are never overwritten. All sessions using this instance share its configured workspace.

## Install

Requires Node.js 22.19+ or 24+, and DSH **0.2.1-alpha.4** (the tested API version). Install a built release tarball from [Releases](https://github.com/howtimeschange/dsh-crawshrimp-data/releases), or install the tagged sources, which already include executable JavaScript:

```sh
dsh plugin --profile ecommerce add -w github:howtimeschange/dsh-crawshrimp-data#v0.2.1
DSH_DATA_WORKSPACE=/absolute/path/to/data dsh --profile ecommerce --dump-config
DSH_DATA_WORKSPACE=/absolute/path/to/data dsh --profile ecommerce
```

No package lifecycle/build scripts are needed. Alternatively clone this repository, run `npm ci`, then `dsh plugin --profile ecommerce add -w /absolute/path/to/dsh-crawshrimp-data`. The bundle automatically inserts its plugin row. The default workspace is DSH's launch directory. Use a dedicated folder or override row `crawshrimp-data` with the complete `config` in your profile patch:

```yaml
- id: crawshrimp-data
  config:
    workspaceDir: /absolute/path/to/data
```

See the [official bundle installation guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md). These packages are distributed through GitHub, not the npm registry.

## Example

Ask DSH: “Preview products.xlsx, summarize missing prices and inventory, then export the selected records to products-clean.csv.” Or call with JSON:

```json
{"path":"products.xlsx","rows":[{"sku":"A001","price":39.5,"stock":8},{"sku":"A002","price":60.5,"stock":0}]}
```

Use that object with `crawshrimp_data_export`, then call `crawshrimp_data_profile` with `{"path":"products.xlsx"}`. CSV exports prefix formula-like strings (including headers) with an apostrophe so spreadsheet software treats them as text. XLSX strings remain literal. Preserve identifiers such as `00123` as JSON strings.

## Product-table transformations

JSON input accepts a record array or `{ "success": true, "data": [...] }`, so a script artifact can be consumed directly from the configured workspace. A declared `success: false` artifact is rejected. Records are flat scalar values; leading-zero identifiers stay strings. JSON null and empty strings remain distinct internally; CSV/XLSX serialization represents null as an empty cell. An empty array can carry explicit `columns` in a `{ "columns": [...], "data": [] }` envelope.

Call `crawshrimp_data_transform` with:

```json
{
  "path": "products.json",
  "filters": [{ "column": "stock", "op": "gt", "value": 0 }],
  "dedupeBy": ["sku"],
  "sortBy": [{ "column": "price", "numeric": true, "direction": "desc" }],
  "columns": ["sku", "price", "stock"],
  "rename": { "sku": "product_id" }
}
```

Omit `outputPath` to compute a read-only preview and row counts. Add `"outputPath": "products-clean.xlsx"` or a `.csv` path to request native approval and write a new artifact. No expressions, SQL or JavaScript execute. The deterministic order is filter → deduplicate (keep first) → sort → select/rename; all plan column references use input names. A zero-row result still exports its declared header. `crawshrimp_data_export` also accepts optional `columns`, required for an empty `rows` array.

Filters are AND-combined: `eq`, `ne`, `contains`, `in` (use `values`), `gt/gte/lt/lte`, `is_empty`, `not_empty`. Equality is type-sensitive; CSV values are strings. Numeric comparisons accept finite decimal numbers/strings, not formatted currency. Sort defaults to lexical order; set `numeric: true` for numbers. Missing/unparseable numeric values sort last. At most 20 filters and five sort keys are accepted. Returned previews contain up to 20 rows/256 KiB and explicitly report truncation; the saved file contains the full bounded result. Examples are in `examples/sample-products.json` and `examples/transform-products.json`.

## Boundaries and validation

Inputs are JSON records, UTF-8 CSV or XLSX up to 10 MiB; tables support 10,000 rows, 200 columns, 200,000 cells, column names up to 256 characters, unique nonempty headers and scalar cell values. Export input is capped at 5 MiB JSON, cells at 10,000 characters, previews at 512 KiB. Large tables fail explicitly rather than being silently truncated. XLSX formula cells use their saved cached result, or a marker when absent; formulas/macros are never evaluated. CSV and XLSX dates are not automatically normalized across formats. ZIP expansion is bounded before XLSX parsing. Filesystem confinement is a normal local path check, not an OS sandbox against another process changing symlinks concurrently.

`npm test` verifies real Unicode CSV/XLSX round trips, numeric summaries, formula-string handling, path/symlink escapes, overwrite refusal, cancellation before output, registration/approval/unload in actual Cordis + DSH ToolRuntime, and Full Access/ask/restricted/missing/error permission mappings. No model API or merchant system is used. This plugin does not edit arbitrary existing workbooks, render charts, recalculate formulas or connect to seller accounts.

## Related independent plugins

[Browser](https://github.com/howtimeschange/dsh-crawshrimp-browser) · [Office](https://github.com/howtimeschange/dsh-crawshrimp-office). These are the three maintained functional packages; each installs separately and works without the others. Page scripts and pagination belong to Browser.

MIT. Inspired by the local artifact workflow in [Crawshrimp Harness](https://github.com/howtimeschange/crawshrimp-harness); implementation uses standalone Node libraries.

Version 0.2.1 keeps direct JSON-artifact reading and declarative table transformations, and aligns write permissions with DSH's native Full Access preset. The original 0.1.0 tag is superseded.
