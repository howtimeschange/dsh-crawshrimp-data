# Crawshrimp Data for DeepSeek Harness

[中文](README.zh-CN.md) · [DSH](https://github.com/deepseek-ai/deepseek-harness) · [Plugin topic](https://github.com/topics/dsh-plugin)

Local CSV and Excel tools that run inside DSH. No Crawshrimp application, backend, API token, Python runtime or companion plugin is required. This is an independent community project, not an official DeepSeek plugin.

| Tool | Capability |
| --- | --- |
| `crawshrimp_data_preview` | Read CSV/XLSX, select an XLSX sheet, paginate up to 100 rows |
| `crawshrimp_data_profile` | Missing values, distinct counts and numeric min/max/sum/mean |
| `crawshrimp_data_export` | JSON records to a new CSV or XLSX file |

Useful for product-table checks, inventory summaries and turning browser/script results into spreadsheets. Files stay inside the configured workspace; writes require DSH's native approval service. The user's `never` permission policy permits writes without a prompt. Existing files are never overwritten. All sessions using this instance share its configured workspace.

## Install

Requires Node.js 22.19+ or 24+, and DSH **0.2.1-alpha.4** (the tested API version). Install a built release tarball from [Releases](https://github.com/howtimeschange/dsh-crawshrimp-data/releases), or install the tagged sources, which already include executable JavaScript:

```sh
dsh plugin --profile ecommerce add -w github:howtimeschange/dsh-crawshrimp-data#v0.1.0
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

## Boundaries and validation

Inputs are UTF-8 CSV or XLSX up to 10 MiB; tables support 10,000 rows, 200 columns, 200,000 cells, column names up to 256 characters, unique nonempty headers and scalar cell values. Export input is capped at 5 MiB JSON, cells at 10,000 characters, previews at 512 KiB. Large tables fail explicitly rather than being silently truncated. XLSX formula cells use their saved cached result, or a marker when absent; formulas/macros are never evaluated. CSV and XLSX dates are not automatically normalized across formats. ZIP expansion is bounded before XLSX parsing. Filesystem confinement is a normal local path check, not an OS sandbox against another process changing symlinks concurrently.

`npm test` verifies real Unicode CSV/XLSX round trips, numeric summaries, formula-string handling, path/symlink escapes, overwrite refusal, cancellation before output, and registration/approval/unload in actual Cordis + DSH ToolRuntime. No model API or merchant system is used. This plugin does not edit arbitrary existing workbooks, render charts, recalculate formulas or connect to seller accounts.

## Related independent plugins

[Browser](https://github.com/howtimeschange/dsh-crawshrimp-browser) · [Scripts](https://github.com/howtimeschange/dsh-crawshrimp-scripts) · [Office](https://github.com/howtimeschange/dsh-crawshrimp-office). Each installs separately and works without the others.

MIT. Inspired by the local artifact workflow in [Crawshrimp Harness](https://github.com/howtimeschange/crawshrimp-harness); implementation uses standalone Node libraries.
