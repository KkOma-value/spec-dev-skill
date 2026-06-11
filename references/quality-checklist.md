# 质量门禁检查清单 — Quality Gate Checklist

> 用于 quality-reviewer agent 在 quality 阶段执行全面质量检查。
> 所有检查项必须在 delivery 前通过。未通过项按严重级别处理。

---

## 严重级别定义

| 级别 | 标识 | 含义 | 处理规则 |
|------|------|------|---------|
| **CRITICAL** | `[CRIT]` | 安全漏洞、数据丢失风险、编译失败 | **BLOCK** — 必须修复后才能通过门禁 |
| **HIGH** | `[HIGH]` | Bug、重大质量缺陷、功能缺失 | **BLOCK** — 必须修复后才能通过门禁 |
| **MEDIUM** | `[MED]` | 可维护性问题、轻微偏离规范 | **WARN** — 建议修复，记录为已知问题后可放行 |
| **LOW** | `[LOW]` | 风格建议、优化机会 | **NOTE** — 记录建议，不阻塞门禁 |

## 通过标准

- **通过（PASS）**：零 CRITICAL，零 HIGH。MEDIUM 项已记录并获确认。
- **有条件通过（CONDITIONAL_PASS）**：零 CRITICAL，零 HIGH。MEDIUM 项已记录，用户确认后可进入 delivery。
- **不通过（FAIL）**：存在任何 CRITICAL 或 HIGH 项。修复后重新检查。

---

## 一、安全检查（Security Check）

> 安全问题是最高优先级。任何 CRITICAL 项直接阻断门禁。

### 1.1 密钥与凭证

- [ ] `[CRIT]` 无硬编码的 API 密钥、密码、Token、私钥
- [ ] `[CRIT]` 所有密钥使用环境变量或密钥管理服务（Vault / KMS / ConfigMap）
- [ ] `[HIGH]` 启动时验证必需的环境变量是否存在（fail-fast 策略）
- [ ] `[MED]` 曾暴露的密钥已轮换

**检查方法**：grep 搜索 `password\s*=\s*["'][^"']+["']`、`apiKey\s*=\s*["'][^"']+["']`、`secret\s*=\s*["'][^"']+["']` 等模式。

### 1.2 注入防护

- [ ] `[CRIT]` SQL 查询使用参数化查询或 ORM，无字符串拼接
- [ ] `[CRIT]` 动态排序/分组字段使用白名单校验（禁止直接拼接 `ORDER BY ${userInput}`）
- [ ] `[HIGH]` 命令执行使用参数化数组而非字符串拼接
- [ ] `[MED]` LDAP / NoSQL 查询无拼接注入风险

**检查方法**：搜索字符串拼接模式（Java: `+ variable +`、MyBatis `${}`）、检查 ORM native query 使用方式。

### 1.3 跨站脚本（XSS）

- [ ] `[CRIT]` 用户输入的 HTML 内容在输出前经过转义
- [ ] `[HIGH]` 富文本输入使用白名单标签过滤（非仅黑名单）
- [ ] `[MED]` HTTP 响应设置了 `Content-Type` 头（禁止 `text/html` 时由浏览器嗅探）
- [ ] `[LOW]` 设置了 `X-XSS-Protection` 或 CSP 头

**检查方法**：检查 Controller 返回的 HTML/JSON 内容、模板引擎（Thymeleaf / JSP）是否启用自动转义。

### 1.4 跨站请求伪造（CSRF）

- [ ] `[CRIT]` 状态变更接口（POST / PUT / PATCH / DELETE）有 CSRF 保护
- [ ] `[HIGH]` 使用 SameSite Cookie 属性（Lax 或 Strict）
- [ ] `[MED]` 敏感操作需要二次确认或验证码

**检查方法**：检查 Security 配置中的 CSRF 设置、Cookie 属性配置。

### 1.5 认证与授权

- [ ] `[CRIT]` 所有非公开接口有认证检查（无未授权匿名访问）
- [ ] `[CRIT]` 接口级权限校验存在且与需求定义的角色匹配
- [ ] `[HIGH]` 数据级权限校验存在（用户只能访问自己的数据，除非有管理员角色）
- [ ] `[HIGH]` JWT / Session 有过期时间且合理
- [ ] `[MED]` 权限变更后旧 Token 失效机制存在

**检查方法**：遍历所有新增/修改的 Controller 端点，确认 `@PreAuthorize` / `@Secured` / 拦截器配置。

### 1.6 路径遍历

- [ ] `[CRIT]` 文件下载/读取接口校验路径参数（禁止 `../` 穿越）
- [ ] `[HIGH]` 文件路径使用规范化（`Path.normalize()`）后校验是否在允许目录内
- [ ] `[MED]` 文件上传限制可写目录和文件类型

**检查方法**：搜索 `FileInputStream`、`FileReader`、`Paths.get()` 等文件操作，检查入参来源。

### 1.7 数据暴露

- [ ] `[CRIT]` 错误消息不泄露堆栈跟踪、SQL 语句、内部路径
- [ ] `[HIGH]` API 响应不返回密码哈希、Token、内部 ID（如自增主键）
- [ ] `[MED]` 日志中敏感字段（手机号、身份证、银行卡）脱敏
- [ ] `[LOW]` 生产环境禁用 DEBUG 级别日志

**检查方法**：检查全局异常处理器、DTO/VO 序列化字段、日志脱敏配置。

### 1.8 速率限制

- [ ] `[HIGH]` 登录/注册/短信等接口有速率限制
- [ ] `[MED]` 公开 API 接口有速率限制或配额
- [ ] `[LOW]` 批量操作接口有并发限制

**检查方法**：检查 Gateway 层限流配置、`@RateLimiter` 注解、Redis 计数器实现。

### 1.9 依赖安全

- [ ] `[HIGH]` 无已知 CVE 的依赖版本（使用 `mvn dependency-check` 或 `npm audit`）
- [ ] `[MED]` 依赖版本可追溯（无 SNAPSHOT 或非官方仓库依赖）

**检查方法**：运行 `mvn org.owasp:dependency-check-maven:check`、`npm audit --production`、`pip-audit`。

### 1.10 输入验证

- [ ] `[CRIT]` 所有 Controller 入参有 `@Valid` / `@Validated` 校验
- [ ] `[HIGH]` 字符串长度、数值范围、枚举值有约束
- [ ] `[HIGH]` 正则表达式有防 ReDoS 保护（无不安全的正则回溯）
- [ ] `[MED]` 文件上传限制大小和类型

**检查方法**：检查 DTO 类中的 Bean Validation 注解、Controller 方法参数注解。

---

## 二、代码质量（Code Quality）

### 2.1 可读性与命名

- [ ] `[HIGH]` 类名、方法名、变量名清晰表达意图（无 `a`、`b`、`temp`、`data` 等无意义命名）
- [ ] `[MED]` 布尔变量使用 `is` / `has` / `should` / `can` 前缀
- [ ] `[MED]` 常量使用 `UPPER_SNAKE_CASE` 且有注释说明用途
- [ ] `[LOW]` 魔法数字已替换为命名常量（`-1`、`0`、`1`、`200` 除外）
- [ ] `[LOW]` 注释解释「为什么」而非「做什么」（代码自解释优于注释）

**检查方法**：人工审查 + IDE 静态分析（SonarLint / Checkstyle）。

### 2.2 函数与文件规模

- [ ] `[HIGH]` 函数不超过 50 行（超出需拆分）
- [ ] `[MED]` 文件不超过 800 行（超出需拆分为独立模块）
- [ ] `[MED]` 单个参数不超过 5 个（超过用 DTO 封装）
- [ ] `[LOW]` 嵌套深度不超过 4 层（使用提前返回 / 提取方法降低嵌套）

**检查方法**：使用 `cloc` 或 IDE 统计函数行数和文件行数，grep 检测深层嵌套。

### 2.3 错误处理

- [ ] `[CRIT]` 无 `try { } catch (Exception e) { }` 空 catch 块（静默吞异常）
- [ ] `[HIGH]` catch 块有日志记录或向上抛出（二选一，不能同时做）
- [ ] `[MED]` 业务异常使用项目统一的异常类（非泛型 `RuntimeException`）
- [ ] `[MED]` 资源（流、连接、锁）使用 try-with-resources 或在 finally 中关闭
- [ ] `[LOW]` 异常消息有足够上下文（用户 ID、操作类型、失败原因）

**检查方法**：搜索 `catch\s*\(\s*Exception` 和 `printStackTrace()` 调用。

### 2.4 无调试残留

- [ ] `[HIGH]` 无 `console.log`、`System.out.println`、`printStackTrace()` 等调试输出
- [ ] `[HIGH]` 无被注释掉的代码块（使用版本管理而非注释保留）
- [ ] `[MED]` 无 `TODO` / `FIXME` / `HACK` 标记（除非有对应的跟踪 issue）
- [ ] `[MED]` 无 `@Disabled` / `@Ignore` 的测试（除非有明确的跳过原因注释）

**检查方法**：grep 搜索以上模式，检查测试注解。

---

## 三、构建验证（Build Verification）

### 3.1 编译

- [ ] `[CRIT]` 项目编译通过（Java: `mvn compile -q`，Node: `npm run build`，Python: `python -m compileall .`）
- [ ] `[CRIT]` 测试编译通过（Java: `mvn test-compile`）
- [ ] `[HIGH]` 无编译警告（deprecated API 使用、unchecked cast 等）

**检查方法**：执行完整构建命令，检查退出码和输出。

### 3.2 代码风格与静态分析

- [ ] `[HIGH]` Lint 检查通过（Java: Checkstyle / SpotBugs，JS: ESLint，Python: ruff/pylint）
- [ ] `[MED]` 代码格式化一致（遵循项目 .editorconfig 或格式化配置）
- [ ] `[LOW]` Import 语句有序且无未使用的 import

**检查方法**：运行项目配置的 lint 命令。

### 3.3 类型检查

- [ ] `[HIGH]` TypeScript 项目 `tsc --noEmit` 通过
- [ ] `[MED]` Python 项目 mypy / pyright 通过（若项目配置了类型检查）
- [ ] `[MED]` Java 泛型无不安全的 raw type 使用

**检查方法**：运行项目对应的类型检查命令。

---

## 四、Spec-Code 一致性（Spec-Code Consistency）

### 4.1 任务完成度

- [ ] `[CRIT]` spec 中所有任务标记为 `[x]` 已完成（无遗漏）
- [ ] `[HIGH]` 每个任务的验收标准已实际验证通过（非仅标记完成）
- [ ] `[MED]` 任务完成时间已记录

**检查方法**：逐项对比 `.spec-dev/changes/{requirement_name}/tasks.md` 中的任务与实际代码变更。

### 4.2 无冗余代码

- [ ] `[HIGH]` 无 spec 未定义的额外功能（scope creep）
- [ ] `[MED]` 无未使用的 import、变量、方法
- `[LOW]` 无死代码路径（永远不会执行的分支）

**检查方法**：对比 spec 任务清单与 git diff，IDE 检测未使用代码。

### 4.3 API 路径一致性

- [ ] `[CRIT]` 前端 fetch URL 与后端 `@RequestMapping` / `@GetMapping` 路径完全匹配
- [ ] `[HIGH]` API 请求方法和参数名与接口定义一致
- [ ] `[HIGH]` API 路径常量集中定义（便于前后端同步）
- [ ] `[MED]` 响应格式遵循项目统一的响应信封（`{code, data, message}` 或等效格式）

**检查方法**：对比前端 HTTP 调用代码与后端 Controller 定义，grep API 路径字符串。

---

## 五、性能检查（Performance）

### 5.1 N+1 查询

- [ ] `[HIGH]` 无 N+1 查询问题（循环内执行数据库查询）
- [ ] `[HIGH]` 关联查询使用 JOIN 或批量加载替代逐条查询
- [ ] `[MED]` ORM 懒加载使用合理（不存在意外的 N+1）

**检查方法**：检查 Service 层循环内是否调用 Mapper/Repository 方法，检查 MyBatis/JPA 的 SQL 日志。

### 5.2 分页与数据量控制

- [ ] `[HIGH]` 列表查询接口有分页参数（`page` / `size` 或 `offset` / `limit`）
- [ ] `[HIGH]` 分页参数有最大值限制（防止单次查询全表）
- [ ] `[MED]` 导出类接口有数据量上限或异步处理
- [ ] `[MED]` 数据库查询有 `LIMIT` 或等效限制

**检查方法**：检查 Controller 列表接口参数、Service 层查询逻辑。

### 5.3 缓存

- [ ] `[MED]` 高频读取且变更不频繁的数据配置了缓存
- [ ] `[MED]` 缓存有合理的过期时间和淘汰策略
- [ ] `[HIGH]` 缓存更新/删除与数据库操作在事务内保持一致（或使用 TTL 容忍不一致）

**检查方法**：检查 `@Cacheable` / `@CacheEvict` 注解、Redis 使用。

### 5.4 查询优化

- [ ] `[HIGH]` 数据库查询使用了合适的索引（新增查询需确认索引覆盖）
- [ ] `[MED]` 无 `SELECT *` 查询所有字段（仅选择需要的列）
- [ ] `[MED]` 批量操作使用批量插入/更新而非逐条操作
- [ ] `[LOW]` 大数据量操作使用异步或分批处理

**检查方法**：检查 Mapper XML 中的 SQL、JPA 查询方法、explain plan 输出。

---

## 六、测试检查（Testing）

### 6.1 单元测试

- [ ] `[CRIT]` 新增/修改的核心业务逻辑有单元测试
- [ ] `[CRIT]` 单元测试覆盖率 >= 80%（新增代码）
- [ ] `[HIGH]` 测试使用 AAA 模式（Arrange-Act-Assert）
- [ ] `[HIGH]` 测试方法名描述被测行为（`should_xxx_when_xxx` 或 `testXxx`）
- [ ] `[MED]` 边界条件和异常路径有覆盖
- [ ] `[MED]` 测试之间独立（无执行顺序依赖，无共享可变状态）

**检查方法**：运行 `mvn test` 并查看 JaCoCo 报告，检查测试类命名和结构。

### 6.2 集成测试

- [ ] `[HIGH]` 新增/修改的 API 端点有集成测试
- [ ] `[HIGH]` 数据库操作有集成测试（使用 TestContainers 或 H2 等测试数据库）
- [ ] `[MED]` 外部服务调用有 Mock/Stub 测试（使用 WireMock 或 Mockito）
- [ ] `[MED]` 事务回滚测试（验证异常时数据完整性）

**检查方法**：检查 `*IT.java` 或 `*IntegrationTest.java` 文件、`@SpringBootTest` 测试类。

### 6.3 E2E 测试

- [ ] `[HIGH]` 关键用户流程有 E2E 测试覆盖
- [ ] `[MED]` E2E 测试覆盖正常路径和关键异常路径
- `[LOW]` E2E 测试有清晰的步骤描述和断言

**检查方法**：确认 spec 中标记为「关键流程」的场景在 E2E 测试中有覆盖。

---

## 七、UI 一致性（UI Consistency）

> 仅适用于涉及前端/UI 变更的需求。纯后端需求跳过此章节。

### 7.1 UIUX 文档一致性

- [ ] `[CRIT]` UI 实现与 `output/*-uiux.md` 中的页面结构和组件定义一致
- [ ] `[HIGH]` 交互流程（导航、表单提交、错误反馈）与 UIUX 文档描述一致
- [ ] `[HIGH]` 响应式断点和布局与设计稿匹配

**检查方法**：逐页对比 UIUX 文档与实现代码，使用浏览器 DevTools 验证。

### 7.2 图标规范

- [ ] `[CRIT]` 无 emoji 作为功能图标或占位符（禁止 `🚀` `✅` `❌` `⭐` 等 Unicode emoji）
- [ ] `[HIGH]` 所有图标来自声明的图标库（Lucide / Heroicons / Tabler Icons / 项目指定库）
- [ ] `[MED]` 图标使用方式与图标库文档一致（组件导入方式、尺寸属性）

**检查方法**：grep emoji Unicode 范围 `[\u{1F300}-\u{1F9FF}]`，检查图标 import 来源。

### 7.3 颜色系统

- [ ] `[CRIT]` 无硬编码颜色值（所有颜色引用 design tokens / CSS 变量）
- [ ] `[HIGH]` 无紫色/粉色渐变主题（除非 UIUX 文档明确指定）
- [ ] `[HIGH]` 颜色使用符合设计系统的语义 token（`--color-primary`、`--color-error` 等）
- [ ] `[MED]` 暗色模式 / 亮色模式颜色变量完整

**检查方法**：grep 硬编码颜色（`#xxxxxx`、`rgb(`、`hsl(`），检查 CSS 变量定义。

### 7.4 字体与排版

- [ ] `[HIGH]` 字体族来自声明的设计系统（非仅 `system-ui` / 浏览器默认字体）
- [ ] `[MED]` 字号、行高、字重遵循设计 token 的排版层级
- [ ] `[MED]` 标题层级（h1-h6）语义正确且样式连贯
- [ ] `[LOW]` 无过多字体族（通常不超过 3 种字体）

**检查方法**：检查 `font-family` 声明、CSS 排版变量、页面标题层级结构。

---

## 检查执行流程

1. **读取产物文档**：读取 PRD、Architecture、Tasks 和 UIUX（如适用）文档
2. **获取代码变更**：`git diff` 获取所有变更文件清单
3. **逐节执行检查**：按上述 7 个章节的顺序执行检查
4. **记录检查结果**：对每项标记 `[x]`（通过）/ `[ ]`（未通过）/ `N/A`（不适用）
5. **输出检查报告**：汇总 CRITICAL / HIGH / MEDIUM / LOW 项，给出 PASS / CONDITIONAL_PASS / FAIL 结论

## 检查报告模板

```markdown
# 质量门禁检查报告 — {需求名称}

## 基本信息

| 字段 | 值 |
|------|-----|
| 检查日期 | {YYYY-MM-DD} |
| 检查范围 | {变更文件数} 个文件 |
| 需求名称 | {需求名称} |
| 检查结论 | PASS / CONDITIONAL_PASS / FAIL |

## 逐节结果

| 章节 | 状态 | CRIT | HIGH | MED | LOW |
|------|------|------|------|-----|-----|
| 一、安全检查 | PASS / FAIL | {n} | {n} | {n} | {n} |
| 二、代码质量 | PASS / FAIL | {n} | {n} | {n} | {n} |
| 三、构建验证 | PASS / FAIL | {n} | {n} | {n} | {n} |
| 四、Spec-Code 一致性 | PASS / FAIL | {n} | {n} | {n} | {n} |
| 五、性能检查 | PASS / FAIL | {n} | {n} | {n} | {n} |
| 六、测试检查 | PASS / FAIL | {n} | {n} | {n} | {n} |
| 七、UI 一致性 | PASS / N/A | {n} | {n} | {n} | {n} |

## CRITICAL / HIGH 项详情

（逐项列出问题和修复建议）

## MEDIUM 项记录

（逐项列出已知问题和建议）

## 最终结论

- [ ] 通过 / 有条件通过 / 不通过
- 签名: quality-reviewer agent
- 日期: {YYYY-MM-DD}
```
