# 抓虾数据插件 · DeepSeek Harness（DSH）CSV / Excel / JSON

**简体中文** | [English](README.en.md) · [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [GitHub Releases](https://github.com/howtimeschange/dsh-crawshrimp-data/releases) · [DSH Plugin topic](https://github.com/topics/dsh-plugin)

抓虾数据工具是面向 DeepSeek Harness（DSH）的独立本地数据插件，可在 DSH 进程内预览、统计、清洗和导出 JSON、CSV、Excel（XLSX）数据。它适合商品表检查、库存汇总、订单数据整理，以及把浏览器或脚本产物转换成新的表格文件。无需安装抓虾应用或后端，也不需要抓虾 API Token、Python 运行时或其他配套插件；这是独立社区项目，不是 DeepSeek 官方插件。

## 快速开始

需要 Node.js `^22.19.0 || >=24.0.0`，以及已验证的 DSH **0.2.1-alpha.4**。通过 GitHub Release 安装预打包版本，或直接安装带 JavaScript 产物的 GitHub 标签：

```sh
dsh plugin --profile ecommerce add -w github:howtimeschange/dsh-crawshrimp-data#v0.2.1
DSH_DATA_WORKSPACE=/absolute/path/to/data dsh --profile ecommerce --dump-config
DSH_DATA_WORKSPACE=/absolute/path/to/data dsh --profile ecommerce
```

无需执行包构建脚本。也可以克隆仓库后执行 `npm ci`，再安装本地目录：

```sh
dsh plugin --profile ecommerce add -w /absolute/path/to/dsh-crawshrimp-data
```

`DSH_DATA_WORKSPACE` 指定插件使用的工作目录；未指定时默认使用 DSH 启动目录。也可以在 profile patch 中覆盖完整配置：

```yaml
- id: crawshrimp-data
  config:
    workspaceDir: /absolute/path/to/data
```

详细安装方式见 [官方 bundle 安装文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。项目通过 GitHub 分发，未假定已经发布到 npm 注册表。

## 能力概览

| 工具 | 能力 |
| --- | --- |
| `crawshrimp_data_preview` | 读取 JSON、CSV、XLSX，选择工作表，按页返回最多 100 行 |
| `crawshrimp_data_profile` | 统计缺失值、不同值数量，以及数值列的最小值、最大值、合计和均值 |
| `crawshrimp_data_export` | 将 JSON 记录写入新的 CSV 或 XLSX 文件；不会覆盖已有文件 |
| `crawshrimp_data_transform` | 声明式筛选、去重、排序、选列和重命名；可只预览或保存新文件 |

文件读取和写入限定在配置的 `workspaceDir`。写文件使用 DSH 原生审批信号：当会话同时处于 `danger-full-access` 且原生审批策略为 `never` 时，已有完全权限授予，插件不会重复请求逐次审批；其他状态继续走原生审批路径，无法获得审批时故障关闭。插件不会覆盖已有文件，同一插件实例的会话共享该工作目录。

## 使用示例

可以直接对 DSH 说：

> 预览 `products.xlsx`，统计缺失价格和库存，然后把选定记录导出到 `products-clean.csv`。

工具调用可以传入 JSON 记录：

```json
{
  "path": "products-clean.csv",
  "rows": [
    { "sku": "A001", "price": 39.5, "stock": 8 },
    { "sku": "A002", "price": 60.5, "stock": 0 }
  ]
}
```

将该对象交给 `crawshrimp_data_export`，再用 `crawshrimp_data_profile` 读取 `{"path":"products.xlsx"}`。以零开头的货号必须传为 JSON 字符串，例如 `"00123"`。CSV 导出会为可能被表格软件识别为公式的文本（含表头）加前置单引号；XLSX 文本保持字面值。

## 商品表清洗与脚本衔接

JSON 输入可以是记录数组，也可以是脚本产物 `{ "success": true, "data": [...] }`。明确声明 `success: false` 的失败产物会被拒绝。记录必须由扁平标量字段组成；`001` 等标识符作为字符串保持原样。JSON 的 `null` 与空字符串在内部保持区别，CSV/XLSX 写入时 `null` 表示空单元格。空数组可以通过 `{ "columns": [...], "data": [] }` 声明表头。

调用 `crawshrimp_data_transform` 可以使用以下计划：

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

不传 `outputPath` 时只计算预览、行数和统计；加上 `"outputPath": "products-clean.xlsx"` 或 `.csv` 路径后，才会通过原生权限检查保存新文件。处理顺序固定为：筛选 → 去重（保留第一条）→ 排序 → 选列/重命名。计划中的列名都指输入列；不执行表达式、SQL 或 JavaScript。即使结果为零行，只要声明了表头，也会生成带表头的文件。`crawshrimp_data_export` 的 `rows` 为空时必须提供 `columns`。

筛选条件按 AND 组合：`eq`、`ne`、`contains`、`in`（传 `values`）、`gt`、`gte`、`lt`、`lte`、`is_empty`、`not_empty`。相等比较保留类型差异；CSV 单元格读出为字符串。数值比较只接受有限十进制数或对应字符串，不解析带货币符号的文本。排序默认按文本比较；要按数值排序请设置 `numeric: true`，空值和无法解析的数值排在最后。最多 20 个筛选条件和 5 个排序键。转换预览最多返回 20 行和 256 KiB，并明确报告是否截断；保存文件包含完整的有界结果。示例见 [`examples/sample-products.json`](examples/sample-products.json) 和 [`examples/transform-products.json`](examples/transform-products.json)。

## 范围与限制

- 输入支持不超过 10 MiB 的 JSON、UTF-8 CSV 和 XLSX；表格最多 10,000 行、200 列、200,000 个单元格，列名最多 256 个字符，表头必须非空且不重复。
- 导出输入最多 5 MiB JSON，单元格最多 10,000 个字符；普通预览最多返回 100 行且结果不得超过 512 KiB。
- XLSX 公式单元格只使用已保存的缓存值，没有缓存值时返回标记；公式和宏不会执行。日期不会在 CSV 与 XLSX 之间自动统一。
- XLSX 解析前会限制 ZIP 条目数量和展开大小。超出边界时会明确报错，不会静默截断大型数据。
- 目录约束是常规本地路径和软链接检查，不能替代防御其他进程并发修改软链接的操作系统沙箱。
- 插件不编辑已有复杂工作簿，不重算公式、不渲染图表，也不连接卖家账号或商家系统。

仓库的 `npm test` 覆盖真实中文 CSV/XLSX 往返、数值统计、公式文本、路径与软链接越界、拒绝覆盖、取消、实际 Cordis/DSH ToolRuntime 中的注册/审批/卸载，以及完全权限、`ask`、受限策略和审批服务缺失/异常时的权限映射。插件不调用模型 API，也不需要真实商家账号。

## 相关插件

[浏览器插件](https://github.com/howtimeschange/dsh-crawshrimp-browser) · [Office 插件](https://github.com/howtimeschange/dsh-crawshrimp-office)。浏览器、数据和 Office 插件分别安装、可以独立运行；网页脚本和翻页能力归浏览器插件。

MIT。能力设计来自抓虾的本地产物处理流程，运行实现直接使用独立 Node 库。

## 版本说明

0.2.1 对齐 DSH 原生完全权限策略：`danger-full-access` 与 `never` 同时成立时不重复请求审批；其他状态继续走原生审批并在无法获批时故障关闭。0.2.0 新增 JSON 产物直读和声明式表格转换；0.1.0 标签已被替代。
