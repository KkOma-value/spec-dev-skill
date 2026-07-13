# Go 安全检查

- `database/sql` 查询使用占位符；禁止 `fmt.Sprintf` 拼接用户输入。
- `os/exec` 参数必须分离并使用 allowlist；禁止把输入交给 shell。
- HTTP handler 检查认证 middleware、对象权限、body 大小限制、超时和安全响应头。
- `filepath.Clean` 后确认路径仍在允许根目录；归档解压逐项验证目标路径。
- go.mod/go.sum 变化时运行 `govulncheck ./...`。
