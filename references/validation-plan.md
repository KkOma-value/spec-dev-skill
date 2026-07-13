# 极速验证计划

在 `pre_code` 阶段写入 `.spec-dev/VALIDATION_PLAN.json`。命令必须使用 argv 数组，不使用 shell 拼接。

```json
{
  "schema_version": 1,
  "scopes": {
    "frontend": {
      "applicable": true,
      "inputs": ["frontend", "package.json", "package-lock.json"],
      "required_kinds": ["build", "test"],
      "checks": [
        {
          "id": "frontend-build",
          "kind": "build",
          "cwd": "frontend",
          "argv": ["npm", "run", "build"]
        },
        {
          "id": "frontend-coverage",
          "kind": "coverage",
          "satisfies": ["test", "coverage"],
          "cwd": "frontend",
          "argv": ["npm", "test", "--", "--coverage", "--run"]
        }
      ]
    },
    "backend": {
      "applicable": false,
      "inputs": [],
      "required_kinds": [],
      "checks": []
    }
  }
}
```

规则：

- `applicable` 必须与 tasks 中 `[FE]`、`[BE]`、`[SHARED]` 标签一致；`[SHARED]` 同时激活两侧。
- 适用 scope 至少声明一个 `inputs`，且 `required_kinds` 必须包含 `build`、`test`。
- `checks[].argv` 是直接执行的参数数组；不得放入 `&&`、管道或重定向。
- coverage 命令实际运行完整测试时，用 `satisfies: ["test", "coverage"]`，不要再添加重复 test 命令。
- 输入列出源码根、构建配置、依赖清单和锁文件。共享文件同时放入前后端 inputs。
- 不把 `.spec-dev/`、`output/`、依赖缓存或构建产物作为输入。
- 开发中每个任务仍执行自身定向验证；本计划只定义阶段末全量验证。
