# 工作区范围

本目录只用于“无知之幕”应用的产品、代码、数据库、测试、部署和交易体系参考资料。

- 不在本目录创建或保存羽毛球分析视频、查理芒格海报工程、认知卡点论文产物。
- 羽毛球工作使用 `/Users/a1/Desktop/球路`。
- 查理芒格图文工作使用 `/Users/a1/Desktop/查理芒格`。
- 认知卡点论文工作使用 `/Users/a1/Desktop/认知卡点`。
- 修改前保持无知之幕现有功能、数据结构和部署流程不受其他主题影响。

# Agent integrations
- Author remote MCP tools in `src/lib/mcp/` and use one lazy caller-scoped client factory; this preserves verified OAuth identity and existing RLS without runtime environment reads during manifest extraction.
- Preserve canonical same-origin authorization return paths through all offered login and registration methods; this prevents lost consent requests and external redirects.
- Register browser tools only in the screen owning their controls and wrap executions with the shared fail-open telemetry helper; this preserves visible-state permissions and keeps user content out of tracking.
- Regenerate the MCP manifest after changes and activate hosted revisions through app republishing, never manual MCP function deployment; generated files do not establish hosted availability.
