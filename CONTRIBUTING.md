# Contributing

感谢参与 Worldweave（织界）。

## 开发流程

1. Fork 仓库并从 `main` 创建分支。
2. 安装依赖并跑通测试：

   ```bash
   npm install
   npm test
   cd server && npm install && npm test
   ```

3. 前端构建：

   ```bash
   npm run build
   ```

4. 提交 PR，说明改动目的、影响范围和验证方式；界面改动请附截图。

## 约定

- 不提交 `.env`、密钥、数据库导出、上传快照或未授权的校园数据。
- 新增接口时同步补测试；涉及权限的改动请说明角色边界。
- 大功能或架构调整先开 Issue 讨论，避免大段返工。
- 保持现有代码风格与中文产品文案；新增用户可见文案请考虑中英文可读性。

## 许可证

贡献代码即同意以 [CC BY-NC-SA 4.0](LICENSE) 许可证发布；示例校园数据、校名与校徽不在授权范围内。
