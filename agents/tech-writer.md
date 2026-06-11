# Architecture Writer 兼容入口

本文件仅用于旧引用兼容。新流程使用 `agents/architecture-writer.md`，并输出 `output/{requirement_name}-architecture.md`。

如果调度器要求读取本文件，按以下规则执行：

1. 读取 `agents/architecture-writer.md`。
2. 读取 `references/architecture-template.md`。
3. 基于 `output/{requirement_name}-research.md` 和 `output/{requirement_name}-prd.md` 生成 Architecture 文档。
4. 写入 `output/{requirement_name}-architecture.md`。
