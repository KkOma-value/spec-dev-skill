# Python 安全检查

- 搜索 `eval`、`exec`、`pickle.loads`、不安全 YAML load、`subprocess(..., shell=True)`。
- ORM 使用参数绑定；禁止 f-string、`%`、format 拼接 SQL。
- Django/FastAPI/Flask 路由检查认证依赖、对象权限、CSRF/CORS 和 debug 设置。
- 文件与归档操作检查路径规范化、Zip Slip、上传大小和类型。
- requirements/lockfile 变化时运行 `pip-audit` 或项目配置的等价工具。
