# Node.js / TypeScript 安全检查

- 搜索 `dangerouslySetInnerHTML`、`innerHTML`、`eval`、`new Function`、`child_process`；确认输入不可控或经过上下文正确编码。
- SQL/NoSQL 查询必须参数化；禁止把请求字段直接拼入查询对象、排序字段或原生 SQL。
- Express/Next API 检查鉴权 middleware、CSRF/CORS、Cookie `httpOnly`/`secure`/`sameSite`。
- 服务端 fetch/axios URL 必须限制协议、域名和解析后 IP。
- manifest/lockfile 变化时运行项目锁文件对应的 `npm audit`、`pnpm audit` 或 `yarn npm audit`。
