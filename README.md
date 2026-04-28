# spec-dev-skill

需求开发全流程 Claude Code Skill。从需求调研到归档的自动化流水线。

## 流程

```
research → PRD → 技术方案 → [确认门禁] → 任务拆分 → 开发 → [确认门禁] → 归档
```

## 安装

```bash
# 克隆到 Claude Code skills 目录
git clone https://github.com/<your-username>/spec-dev-skill.git ~/.claude/skills/spec-dev
```

或者手动复制：

```bash
cp -r spec-dev-skill/ ~/.claude/skills/spec-dev/
```

## 使用

在 Claude Code 中输入：

```
/spec-dev 你的需求描述
```

或：

```
spec-dev: 你的需求描述
```

## 目录结构

```
spec-dev-skill/
├── SKILL.md                          # Skill 主入口（元数据 + 状态机 + 阶段链）
├── agents/
│   ├── researcher.md                 # Deep Research 调研专家指令
│   ├── prd-writer.md                 # PRD 撰写专家指令
│   ├── tech-writer.md                # 技术方案撰写专家指令
│   └── spec-generator.md            # 任务拆分专家指令
├── references/
│   ├── prd-template.md               # PRD 文档模板
│   ├── tech-template.md              # 技术方案模板
│   ├── spec-template.md              # 任务清单模板
│   └── archive-template.md           # 归档模板
└── scripts/
    └── archive.sh                    # 归档辅助脚本
```

## 产物

运行后会在项目根目录生成：

```
spec-dev/
├── .state.json                       # 流程状态（可恢复断点）
├── prd/{name}-prd.md                 # 产品需求文档
├── tech/{name}-tech.md               # 技术方案
├── spec/{name}-tasks.md              # 开发任务清单
└── archive/YYYY-MM-DD-{name}.md      # 归档记录
```

## 特性

- 状态机驱动，支持断点恢复（关闭会话后重新触发自动继续）
- 两个硬门禁：文档确认 + 开发确认，防止跳过人工审核
- Deep Research 双引擎：本地代码分析 + 联网调研
- 任务拆分采用纵向切片策略，每个任务可独立验证
- 适用于 Java 后端微服务，兼容其他技术栈

## License

MIT
