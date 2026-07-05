# 质量门禁检查清单

> 纯检查表。严重级别定义见 `agents/quality-reviewer.md` 与 `agents/security-reviewer.md`。

## 一、安全检查

- [ ] `[CRIT]` 无硬编码 API 密钥/密码/Token/私钥
- [ ] `[CRIT]` SQL 使用参数化查询，无字符串拼接
- [ ] `[CRIT]` 动态排序字段使用白名单
- [ ] `[CRIT]` 用户输入 HTML 经过转义
- [ ] `[CRIT]` 状态变更接口有 CSRF 保护
- [ ] `[CRIT]` 非公开接口有认证检查
- [ ] `[CRIT]` 文件操作路径无 `../` 穿越
- [ ] `[CRIT]` 错误消息不泄露堆栈/SQL/内部路径
- [ ] `[CRIT]` Controller 入参有 `@Valid` 校验
- [ ] `[HIGH]` 登录/注册/验证码接口有速率限制
- [ ] `[HIGH]` 无已知 CVE 的依赖版本
- [ ] `[HIGH]` 启动时验证必需环境变量存在
- [ ] `[HIGH]` JWT/Session 有过期时间且合理
- [ ] `[MED]` 日志中敏感字段脱敏
- [ ] `[MED]` 文件上传限制大小和类型
- [ ] `[LOW]` 生产环境禁用 DEBUG 级别日志

## 二、代码质量

- [ ] `[HIGH]` 类/方法/变量名清晰表达意图
- [ ] `[HIGH]` 函数 ≤ 50 行
- [ ] `[MED]` 文件 ≤ 800 行
- [ ] `[MED]` 嵌套深度 ≤ 4 层
- [ ] `[MED]` 参数 ≤ 5 个
- [ ] `[CRIT]` 无空 catch 块
- [ ] `[HIGH]` 无 `console.log` / `print` 调试残留
- [ ] `[HIGH]` 无被注释掉的代码块
- [ ] `[MED]` TODO/FIXME/HACK 有对应跟踪 issue
- [ ] `[LOW]` 魔法数字已替换为命名常量

## 三、构建验证

- [ ] `[CRIT]` 项目编译通过
- [ ] `[CRIT]` 测试编译通过
- [ ] `[HIGH]` Lint 检查通过
- [ ] `[MED]` 代码格式化一致
- [ ] `[LOW]` Import 有序无未使用

## 四、Spec-Code 一致性

- [ ] `[CRIT]` tasks.md 所有任务 `[x]` 已完成
- [ ] `[CRIT]` 前端 fetch URL 与后端路径完全匹配
- [ ] `[HIGH]` API 请求方法和参数名与 contract 一致
- [ ] `[HIGH]` 无 spec 未定义的额外功能
- [ ] `[MED]` 响应格式遵循项目统一信封

## 五、性能检查

- [ ] `[HIGH]` 无 N+1 查询
- [ ] `[HIGH]` 列表查询有分页且含最大限制
- [ ] `[MED]` 高频读取数据有缓存
- [ ] `[MED]` 批量操作使用批量而非逐条
- [ ] `[HIGH]` 大事务不含外部 API 调用/文件 I/O

## 六、测试检查

- [ ] `[CRIT]` 核心业务逻辑有单元测试
- [ ] `[CRIT]` 覆盖率 ≥ 80%
- [ ] `[HIGH]` 边界条件和异常路径有覆盖
- [ ] `[HIGH]` 测试间独立无共享状态
- [ ] `[MED]` 新增 API 端点有集成测试

## 七、UI 一致性

- [ ] `[CRIT]` 无 emoji 作为功能图标
- [ ] `[HIGH]` 图标来自声明的图标库（Lucide/Heroicons/Tabler）
- [ ] `[CRIT]` 无硬编码颜色值（全部引用 design tokens）
- [ ] `[HIGH]` 无紫色/粉色渐变主题
- [ ] `[HIGH]` 字体族来自声明的设计系统
- [ ] `[MED]` 每个页面覆盖 5 种交互状态（loading/empty/error/success/edge-case）
- [ ] `[MED]` 暗色/亮色模式颜色变量完整
