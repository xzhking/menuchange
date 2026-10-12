# Changelog

## 1.0.0

首个版本。

- 把任意命令固定到右键菜单顶部（编辑器内右键 / 资源管理器右键 / 标签页右键 / 终端右键）
- 隐藏指定菜单项（把 `when` 置为 `false`）
- 改动可逆：每个扩展清单改动前自动备份为 `<package.json>.menuPinner.bak`，所有改动记入 `pins.json`
- 启动自检：被改扩展更新导致清单被覆盖时，提示一键"重新应用"
- `%key%` 形式标题解析（读 `package.nls.json` / `package.nls.<locale>.json`），选择列表显示真实文案
- 修改清单采用"只替换目标字符区间 + 改完 JSON 校验"，不会破坏文件其余内容
- 纯 Node 打包脚本（零依赖）生成 VSIX；GitHub Actions 在打 tag 时自动发 Release

### 关于"一键自动重启"

开发中试过两版，都不成立，最终移除，改为提示用户手动重启：

1. 固定延迟启动新实例 —— 撞上单实例锁，新实例转发给老实例后自己退出，结果是"VS Code 关了没起来"；
2. 独立助手进程等老进程退出后再拉起 —— VS Code 用 Job Object 管子进程并设置 kill-on-job-close，VS Code 退出时助手被一起杀掉（`detached: true` 也逃不出 Job）。
