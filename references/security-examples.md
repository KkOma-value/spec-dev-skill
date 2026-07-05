# 安全审查示例与参考资料

> 按需读取。由 `agents/security-reviewer.md` 引用。

## 已知高危依赖版本

| 组件 | 高危版本 | CVE | 修复版本 |
|------|---------|-----|---------|
| Log4j 2.x | < 2.17.1 | CVE-2021-44228 (Log4Shell) | >= 2.17.1 |
| Spring Framework | < 5.3.18 / 5.2.20 | CVE-2022-22965 (Spring4Shell) | >= 5.3.18 |
| Fastjson | < 1.2.83 | 多个反序列化 RCE | >= 1.2.83 |
| Jackson-databind | < 2.13.2 | 多个反序列化漏洞 | >= 2.13.2 |
| Apache Shiro | < 1.10.0 | CVE-2022-40664 | >= 1.10.0 |
| Apache Struts2 | 多个旧版 | 多个 RCE | 最新稳定版 |
| Spring Security | < 5.6.9 / 5.7.5 | CVE-2023-20860 | >= 5.6.9 |

## SQL 注入修复模板

### Java — MyBatis `${}` → `#{}`

```java
// 危险
@Select("SELECT * FROM t_order WHERE status = ${status}")

// 安全：使用 #{} 参数化
@Select("SELECT * FROM t_order WHERE status = #{status}")
```

### Java — ORDER BY 白名单

```java
private static final Set<String> ALLOWED_SORT_FIELDS = Set.of("id", "name", "create_time");

public List<Order> queryByOrder(String sortField) {
    if (sortField == null || !ALLOWED_SORT_FIELDS.contains(sortField)) {
        throw new IllegalArgumentException("Invalid sort field: " + sortField);
    }
    return mapper.queryByOrder(sortField);
}
```

### Java — JPA 原生查询

```java
// 危险
@Query(nativeQuery = true, value = "SELECT * FROM t_order WHERE status = " + status)

// 安全
@Query(nativeQuery = true, value = "SELECT * FROM t_order WHERE status = :status")
List<Order> findByStatus(@Param("status") Integer status);
```

## 路径遍历修复模板

### Java

```java
// 危险
Path file = Paths.get("/data/files/" + userInput);

// 安全
Path base = Paths.get("/data/files/").toRealPath();
Path resolved = base.resolve(userInput).normalize();
if (!resolved.toRealPath().startsWith(base)) {
    throw new SecurityException("Path traversal detected");
}
```

### Node.js

```javascript
const path = require('path');
const fs = require('fs');

// 安全
const base = path.resolve('/data/files/');
const resolved = path.resolve(base, userInput);
if (!resolved.startsWith(base)) {
    throw new Error('Path traversal detected');
}
```

## XSS 修复模板

### React — DOMPurify

```jsx
// 危险
<div dangerouslySetInnerHTML={{ __html: userInput }} />

// 安全
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userInput) }} />
```

### Vue — v-html 替代

```vue
<!-- 危险 -->
<div v-html="userInput"></div>

<!-- 安全：使用文本插值 -->
<div>{{ userInput }}</div>

<!-- 或使用 DOMPurify -->
<div v-html="sanitizedHtml"></div>
<script>
import DOMPurify from 'dompurify';
export default {
  computed: {
    sanitizedHtml() { return DOMPurify.sanitize(this.userInput); }
  }
}
</script>
```

## 速率限制示例

### Spring Boot + Guava RateLimiter

```java
private final RateLimiter loginLimiter = RateLimiter.create(5.0); // 5 req/s

public Result login(LoginRequest req) {
    if (!loginLimiter.tryAcquire(1, TimeUnit.SECONDS)) {
        return Result.fail("请求过于频繁，请稍后再试");
    }
    // ... 正常逻辑
}
```

### Express.js — express-rate-limit

```javascript
const rateLimit = require('express-rate-limit');
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 分钟
    max: 10,
    message: '登录尝试次数过多，请稍后再试'
});
app.post('/api/login', loginLimiter, loginHandler);
```

## 敏感数据脱敏示例

### Java 日志脱敏

```java
// 危险
log.info("用户登录: phone={}, password={}", phone, password);

// 安全：脱敏后记录
log.info("用户登录: phone={}", maskPhone(phone)); // 138****1234

private String maskPhone(String phone) {
    if (phone == null || phone.length() < 11) return phone;
    return phone.substring(0, 3) + "****" + phone.substring(7);
}
```

## Zip Slip 修复

```java
// 解压时逐条目检查
try (ZipInputStream zis = new ZipInputStream(new FileInputStream(zipFile))) {
    ZipEntry entry;
    Path base = targetDir.toRealPath();
    while ((entry = zis.getNextEntry()) != null) {
        Path resolved = base.resolve(entry.getName()).normalize();
        if (!resolved.startsWith(base)) {
            throw new SecurityException("Zip Slip detected: " + entry.getName());
        }
        // ... 安全写入
    }
}
```
