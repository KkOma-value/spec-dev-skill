# Java 安全检查

- 检查 `Statement`、字符串拼接 SQL、MyBatis `${}`、动态 JPQL；改用参数绑定或字段 allowlist。
- Controller/Service 敏感操作检查 Spring Security 注解、资源归属和事务边界。
- 检查 CSRF/CORS 禁用、Actuator 暴露、默认错误页、反序列化和 XML 外部实体。
- 文件路径先 `normalize`，再确认 `startsWith(allowedRoot)`。
- pom/Gradle 锁定输入变化时运行 OWASP Dependency Check 或项目配置的等价工具。
