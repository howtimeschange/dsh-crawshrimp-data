# 抓虾数据工具 · DSH 社区插件

[English](README.md)

在 DSH 进程内直接处理 JSON、CSV、Excel。无需抓虾应用、后端、API Token、Python 或其他插件。这是独立社区项目。

| 工具 | 用途 |
| --- | --- |
| `crawshrimp_data_preview` | JSON/CSV/XLSX 预览、指定工作表、分页读取 |
| `crawshrimp_data_profile` | 缺失值、去重数量、数值范围/合计/均值 |
| `crawshrimp_data_export` | 将 JSON 记录写成新的 CSV/XLSX |
| `crawshrimp_data_transform` | 筛选、去重、排序、选列、重命名，可预览或保存 |

适合商品表检查、库存汇总、将浏览器或脚本提取的结果导出。读写限定在配置的工作目录；写文件使用 DSH 原生权限信号。会话同时处于 `danger-full-access` 且原生审批策略为 `never` 时，表示已有完全权限授予，插件直接执行，不重复弹出逐次审批；`ask`，或沙箱/审批服务缺失、读取异常时，仍走原生审批路径，无法获批就故障关闭。不会覆盖已有文件。使用同一插件实例的会话共享该目录。

## 安装

需要 Node.js 22.19+ 或 24+，已验证 DSH **0.2.1-alpha.4**。可安装 [Release](https://github.com/howtimeschange/dsh-crawshrimp-data/releases) 的预打包文件，或安装已含 JavaScript 产物的 GitHub 标签：

```sh
dsh plugin --profile ecommerce add -w github:howtimeschange/dsh-crawshrimp-data#v0.2.1
DSH_DATA_WORKSPACE=/绝对路径/数据目录 dsh --profile ecommerce --dump-config
DSH_DATA_WORKSPACE=/绝对路径/数据目录 dsh --profile ecommerce
```

无需安装时执行构建脚本。也可以克隆仓库，执行 `npm ci` 后用 `dsh plugin --profile ecommerce add -w /绝对路径/dsh-crawshrimp-data`。包自带 bundle 配置，安装后自动插入插件。默认目录为 DSH 启动目录。通过环境变量或 profile 的 patch 覆盖完整配置：

```yaml
- id: crawshrimp-data
  config:
    workspaceDir: /绝对路径/数据目录
```

[官方安装文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。目前通过 GitHub 分发，未发布 npm 注册表包。

## 使用

可以对 DSH 说：“预览 products.xlsx，统计缺失价格和库存，将选定记录导出 products-clean.csv。”工具调用示例：

```json
{"path":"products.xlsx","rows":[{"货号":"A001","价格":39.5,"库存":8},{"货号":"A002","价格":60.5,"库存":0}]}
```

交给 `crawshrimp_data_export`，再用 `crawshrimp_data_profile` 读取 `{"path":"products.xlsx"}`。以零开头的货号应传字符串。CSV 导出会为可能被表格软件识别为公式的文本（含表头）加前置单引号；XLSX 文本保持字面值。

## 商品表清洗与脚本衔接

JSON 可传记录数组，或脚本返回的 `{ "success": true, "data": [...] }` 文件。明确声明 `success: false` 的失败产物会拒绝处理。数据目录应包含该文件；无需安装脚本插件。字段值限扁平标量，`001` 等货号字符串保持原样。JSON 的 null 与空字符串在内部保持区别；CSV/XLSX 写文件时 null 表示为空单元格。空数组可通过 `{ "columns": [...], "data": [] }` 声明表头。

`crawshrimp_data_transform` 示例：

```json
{
  "path": "products.json",
  "filters": [{ "column": "库存", "op": "gt", "value": 0 }],
  "dedupeBy": ["sku"],
  "sortBy": [{ "column": "价格", "numeric": true, "direction": "desc" }],
  "columns": ["sku", "商品", "价格", "库存"],
  "rename": { "sku": "货号" }
}
```

不传 `outputPath` 只计算预览和行数；加上 `"outputPath": "products-clean.xlsx"` 或 CSV 路径，才发起原生审批并保存新文件。执行顺序是筛选→去重（保留第一条）→排序→选列/重命名。计划中的列名都指输入列；不执行表达式、SQL 或 JavaScript。筛选结果为空时仍生成有表头的文件。普通 `export` 也支持可选 `columns`；`rows` 为空时必须提供。

筛选条件为 AND：`eq`、`ne`、`contains`、`in`（传 `values`）、`gt/gte/lt/lte`、`is_empty`、`not_empty`。相等比较保留类型差异；CSV 单元格读出为字符串。数值比较只接受有限十进制数或对应字符串，不解析带货币符号的文本。排序默认按文本，数值请设 `numeric: true`；空值/无法解析的数值排最后。最多 20 个筛选、5 个排序键。预览最多 20 行/256 KiB，并明确报告截断；保存的是完整的有界结果。仓库 `examples/` 包含中文商品样例及转换参数。

## 范围与验证

支持 10 MiB 内 JSON、UTF-8 CSV/XLSX，最多 10,000 行、200 列、200,000 单元格；列名最多 256 字符；表头不能为空或重复。导出 JSON 最多 5 MiB，单元格最多 10,000 字符，预览结果最多 512 KiB。超限明确报错。XLSX 公式仅读取已有缓存值，无缓存时返回标记；不执行公式或宏，不重算、不渲染、不编辑已有复杂工作簿。日期不做跨格式自动统一。读取 XLSX 前检查 ZIP 展开大小。目录约束是常规本地路径检查，不能代替防御其他进程并发修改软链接的操作系统沙箱。

`npm test` 已覆盖真实中文 CSV/XLSX 读写和统计、公式文本、路径/软链接越界、拒绝覆盖、取消，真实 Cordis/DSH ToolRuntime 的注册、审批、卸载，以及完全权限/ask/受限策略/审批服务缺失与异常时的权限映射。无需模型 API 或真实商家账号。

[浏览器插件](https://github.com/howtimeschange/dsh-crawshrimp-browser) · [Office 插件](https://github.com/howtimeschange/dsh-crawshrimp-office)。当前按浏览器、数据、Office 三类维护，每个插件均可单独安装运行。网页脚本与翻页归入浏览器插件。

MIT。能力设计来自抓虾的本地产物处理流程，运行实现直接使用 Node 库。

0.2.1 对齐 DSH 原生完全权限策略：`danger-full-access` 与 `never` 同时成立时不重复请求审批；其他状态继续走原生审批并故障关闭。0.2.0 新增 JSON 产物直读和声明式表格转换；0.1.0 标签已被替代。
