# Rust 安全检查

- `unsafe` 块说明不变量并限制边界；检查原始指针、FFI、并发共享状态。
- SQL 使用参数绑定；命令参数不得通过 shell 拼接。
- Web handler 检查认证 extractor、资源权限、请求大小、超时和错误脱敏。
- 文件路径 canonicalize 后确认仍在允许根目录。
- Cargo.toml/Cargo.lock 变化时运行 `cargo audit`。
