# 抓虾数据工具 · DSH 社区插件

[English](README.md)

在 DSH 进程内直接处理 CSV、Excel。无需抓虾应用、后端、API Token、Python 或其他插件。这是独立社区项目。

| 工具 | 用途 |
| --- | --- |
| `crawshrimp_data_preview` | CSV/XLSX 预览、指定工作表、分页读取 |
| `crawshrimp_data_profile` | 缺失值、去重数量、数值范围/合计/均值 |
| `crawshrimp_data_export` | 将 JSON 记录写成新的 CSV/XLSX |

适合商品表检查、库存汇总、将浏览器或脚本提取的结果导出。读写限定在配置的工作目录；写文件走 DSH 原生审批，用户设置 `never` 权限策略时免提示。不会覆盖已有文件。使用同一插件实例的会话共享该目录。

## 安装

需要 Node.js 22.19+ 或 24+，已验证 DSH **0.2.1-alpha.4**。可安装 [Release](https://github.com/howtimeschange/dsh-crawshrimp-data/releases) 的预打包文件，或安装已含 JavaScript 产物的 GitHub 标签：

```sh
dsh plugin --profile ecommerce add -w github:howtimeschange/dsh-crawshrimp-data#v0.1.0
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

## 范围与验证

支持 10 MiB 内 UTF-8 CSV/XLSX，最多 10,000 行、200 列、200,000 单元格；列名最多 256 字符；表头不能为空或重复。导出 JSON 最多 5 MiB，单元格最多 10,000 字符，预览结果最多 512 KiB。超限明确报错。XLSX 公式仅读取已有缓存值，无缓存时返回标记；不执行公式或宏，不重算、不渲染、不编辑已有复杂工作簿。日期不做跨格式自动统一。读取 XLSX 前检查 ZIP 展开大小。目录约束是常规本地路径检查，不能代替防御其他进程并发修改软链接的操作系统沙箱。

`npm test` 已覆盖真实中文 CSV/XLSX 读写和统计、公式文本、路径/软链接越界、拒绝覆盖、取消，以及真实 Cordis/DSH ToolRuntime 的注册、审批、卸载。无需模型 API 或真实商家账号。

[浏览器插件](https://github.com/howtimeschange/dsh-crawshrimp-browser) · [脚本插件](https://github.com/howtimeschange/dsh-crawshrimp-scripts) · [Office 插件](https://github.com/howtimeschange/dsh-crawshrimp-office)。四个插件均可单独安装运行。

MIT。能力设计来自抓虾的本地产物处理流程，运行实现直接使用 Node 库。
