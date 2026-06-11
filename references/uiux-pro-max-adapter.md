# UI/UX Pro Max 适配规则

本文档把 `nextlevelbuilder/ui-ux-pro-max-skill` 的设计系统生成方法接入 spec-dev 的 `uiux` 阶段。它是设计决策适配层，不是运行时依赖。

## 来源与边界

| 项 | 说明 |
|----|------|
| 来源项目 | `https://github.com/nextlevelbuilder/ui-ux-pro-max-skill` |
| 融入方式 | 借鉴其多域检索与设计系统推荐结构：产品类型、风格、色板、字体、页面模式、UX、技术栈 |
| 非目标 | 不把 Python 脚本、CSV 数据或 npm CLI 作为 spec-dev 的强制依赖 |
| 失败策略 | 外部 skill/CLI 不存在时，不阻塞 UIUX 阶段；必须按本文档的同等结构手工完成设计决策 |

## 决策输入

从用户需求、PRD 和 Architecture 中提取以下字段，作为 UI Pro Max 查询或手工推理的输入：

| 字段 | 来源 | 示例 |
|------|------|------|
| Product Type | PRD 的业务对象和产品形态 | SaaS dashboard, ecommerce, healthcare, developer tool |
| Industry | PRD 的行业或用户场景 | finance, education, logistics, internal admin |
| Audience | PRD 的用户角色 | operator, manager, developer, consumer |
| Page Type | 页面清单和任务类型 | landing, dashboard, CRUD admin, data table, settings |
| Data Density | Architecture/API 返回的数据复杂度 | low, medium, high, real-time |
| Stack | Architecture 的前端技术栈 | react, nextjs, vue, shadcn, html-tailwind |
| Tone | 品牌和任务语气 | professional, trustworthy, calm, playful, editorial |

生成查询短语时按以下格式组合：

```text
{product_type} {industry} {page_type} {tone} {data_density}
```

## 可选外部检索

如果项目或全局环境已经安装 `ui-ux-pro-max-skill`，优先运行其搜索脚本获得证据。常见路径包括：

```bash
python src/ui-ux-pro-max/scripts/search.py "<query>" --design-system -p "<project-name>" -f markdown
python cli/assets/scripts/search.py "<query>" --design-system -p "<project-name>" -f markdown
python skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system -p "<project-name>" -f markdown
python .shared/ui-ux-pro-max/scripts/search.py "<query>" --design-system -p "<project-name>" -f markdown
python ~/.codex/skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system -p "<project-name>" -f markdown
```

按需要补充细分检索：

```bash
python <ui-pro-max>/scripts/search.py "<query>" --domain product
python <ui-pro-max>/scripts/search.py "<style keywords>" --domain style
python <ui-pro-max>/scripts/search.py "<industry keywords>" --domain color
python <ui-pro-max>/scripts/search.py "<tone keywords>" --domain typography
python <ui-pro-max>/scripts/search.py "animation accessibility z-index loading" --domain ux
python <ui-pro-max>/scripts/search.py "<stack keywords>" --stack <stack>
```

检索结果必须被转写为设计决策，不允许把原始输出粘贴后不落地。

## 手工推理降级

外部检索不可用时，按以下决策矩阵手工生成推荐。

| 产品/页面信号 | 推荐模式 | 推荐风格 | 色彩倾向 | 字体倾向 | 必须避免 |
|---------------|----------|----------|----------|----------|----------|
| B2B SaaS / 管理后台 / 数据表 | Data-Dense Dashboard / Trust & Authority | Minimalism & Swiss / Soft UI Evolution | 蓝灰、青绿、低饱和强调色 | Inter / IBM Plex Sans / Source Sans 3 | 营销 Hero、过度装饰、低对比卡片 |
| Fintech / Banking / Billing | Trust & Authority / Comparative Dashboard | Accessible & Ethical / Minimalism | 深蓝、青色、绿色语义色 | Inter / Roboto / IBM Plex Sans | 紫粉渐变、娱乐化动效、模糊金额层级 |
| Healthcare / Education / Public Service | Task-first / Inclusive Design | Accessible & Ethical / Soft UI Evolution | 蓝绿、暖中性色、高对比语义色 | Source Sans 3 / Noto Sans / Inter | 低对比文字、只靠颜色表达状态 |
| Ecommerce / Marketplace | Conversion-Optimized / Product Showcase | Flat Design / Liquid Glass (慎用) | 品牌主色 + 高对比 CTA | Inter / Manrope / Lato | CTA 不明确、产品图被装饰遮挡 |
| Developer Tool / IDE / AI Tool | Interactive Product Demo / Data-Dense | AI-Native UI / Minimalism | 中性深浅模式 + 单一高对比强调色 | JetBrains Mono + Inter | AI 紫蓝模板、不可解释的炫光背景 |
| Portfolio / Creative / Brand Site | Storytelling / Editorial Grid | Editorial / Motion-Driven | 品牌色 + 大面积留白 | Sora / Space Grotesk / Playfair Display | 内容缺少真实作品或案例 |

## 必填输出：UI Pro Max 推荐卡

UIUX 文档必须包含以下推荐卡，并把推荐卡的结论落实到后续 token、页面、组件和反模式章节。

| 字段 | 要求 |
|------|------|
| Query | 写明用于检索或手工推理的查询短语 |
| Source Mode | `external-search` 或 `manual-adapter` |
| Product Match | 匹配到的产品类型和行业 |
| Pattern | 页面/产品模式，如 Data-Dense Dashboard、Trust & Authority |
| Style | UI 风格名称和适用理由 |
| Colors | 主色、辅色、CTA/强调色、背景色、文字色 |
| Typography | 标题字体、正文字体、等宽字体 |
| Key Effects | 动效和交互强度，必须包含时长范围 |
| Anti-Patterns | 针对行业和页面类型必须避免的设计 |
| Stack Notes | 前端栈相关实现注意点 |

## 落地规则

1. 推荐卡只是决策入口，最终 UIUX 文档仍必须满足 `agents/ui-designer.md` 的硬性规则。
2. 所有颜色必须扩展为 spec-dev 设计 token，不允许只保留 UI Pro Max 的 5 个基础颜色。
3. 所有字体必须转为完整字体栈，不能只写字体名。
4. 外部检索给出的风格必须经过产品场景过滤。若风格与 PRD/Architecture 冲突，以 PRD/Architecture 为准。
5. 若 UI Pro Max 推荐的接口、组件或页面在 Architecture 中不存在，不得引用；需要标注 `[API 缺口 — 需 Architecture 补充]`。
6. 动效必须尊重 `prefers-reduced-motion`，常规过渡控制在 150-350ms。
7. 最终反模式清单必须同时包含通用反模式和推荐卡中的行业反模式。

## 交付前检查

- [ ] 已提取 Product Type、Industry、Audience、Page Type、Data Density、Stack、Tone。
- [ ] 已生成 UI Pro Max 推荐卡，并标注 Source Mode。
- [ ] 推荐卡的颜色、字体、风格已落到设计 token。
- [ ] 推荐卡的 Pattern 已落到页面层级和用户流程。
- [ ] 推荐卡的 Anti-Patterns 已合并到反模式清单。
- [ ] 外部检索不可用时已使用手工推理降级，且没有阻塞 UIUX 阶段。
