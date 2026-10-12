# Menu Pinner

**中文** | [English](README.en.md)

<img src="icon.png" width="96" alt="icon">

把**任意命令固定到 VS Code 右键菜单顶部**，或**隐藏**不想要的菜单项。

比如让 `Open with Live Server`、`Run Code`、`Open In Default Browser` 出现在右键菜单第一行，而不是埋在一堆扩展项中间。

- 支持菜单：编辑器内右键、资源管理器右键、编辑器标签页右键、终端右键
- 可搜索命令、也能手填命令 ID
- 改动**可逆**：每个清单自动备份，随时一键还原
- 扩展更新覆盖后能**一键重新应用**

---

## 安装

两种方式**只做其中一种**即可，不要都做。装好后扩展 ID 是 `menuchange.menu-pinner`。

### 方式一：装 VSIX 包（推荐 —— 不用手动改任何文件）

**第 1 步 · 拿到 `.vsix` 文件**（下面三条任选一条，不用全做）：

| 来源 | 怎么做 |
|---|---|
| **本仓库直接下载**（最省事） | 点这里 → [`dist/menuchange.menu-pinner-1.0.0.vsix`](dist/menuchange.menu-pinner-1.0.0.vsix)，在文件页点 **Download** |
| **Releases 页面** | 仓库右侧 **Releases** → 对应版本的 **Assets** → `menuchange.menu-pinner-x.y.z.vsix`（打 tag 时由 GitHub Actions 自动生成） |
| **自己从源码打包** | `node tools/package-vsix.js`（零依赖，产物落在 `dist/`） |

**第 2 步 · 安装**（下面两种**任选一种**，不是依次执行）：

- **界面**：VS Code 里 `Ctrl+Shift+P` → **Extensions: Install from VSIX...** → 选中第 1 步拿到的 `.vsix`
- **命令行**：`code --install-extension <第 1 步的文件路径>`，例如：

  ```bash
  code --install-extension dist/menuchange.menu-pinner-1.0.0.vsix
  ```

  若提示 `code` 不是内部或外部命令，说明 VS Code 的 `bin` 没在 PATH 里，用完整路径，例如 Windows：
  `& "D:\...\Microsoft VS Code\bin\code.cmd" --install-extension <路径>`

**第 3 步 · 重启 VS Code**（完全退出所有窗口再打开）。

### 方式二：手动放文件夹（适合想直接跑源码的人）

与方式一**只做其一**。把仓库里的 `package.json`、`extension.js`、`icon.png`、`lib/` 复制到下面这个目录（目录名必须是 `menuchange.menu-pinner-1.0.0`）：

| 系统 | 目录 |
|---|---|
| Windows | `%USERPROFILE%\.vscode\extensions\menuchange.menu-pinner-1.0.0\` |
| macOS / Linux | `~/.vscode/extensions/menuchange.menu-pinner-1.0.0/` |

然后完全退出并重启 VS Code。VS Code 启动扫描时会自动收录它（日志里会出现 `Added extensions to default profile from external source`）；如果扩展列表里没看到，再重启一次。

> 这种方式不会被自动更新，改动也不会被登记版本；长期使用建议回到方式一。

### 升级

| 当前装法 | 怎么升级 |
|---|---|
| 方式一（VSIX） | 重新装一次新版本 VSIX，同 ID 会覆盖：`code --install-extension dist/menuchange.menu-pinner-<新版本>.vsix --force` |
| 方式二（文件夹） | 用新源码覆盖该目录里的文件，重启 VS Code |

---

## 用法

`Ctrl+Shift+P` → 输入 `Menu Pinner`：

| 命令 | 作用 |
|---|---|
| **把命令固定到右键菜单顶部** | 选菜单 → 选命令（可搜索，也可手填命令 ID）→ 自动改好并提示重启 |
| **隐藏某个右键菜单项** | 把该项的显示条件改成 `false`，菜单里不再出现 |
| **查看 / 还原已改动项** | 多选列表，勾选即还原；也能打开 `pins.json` 看原始记录 |
| **重新应用全部改动** | 扩展更新把清单覆盖回去之后，一键重做 |
| **按记录还原全部改动** | 按记录把原始 `group` / `when` 写回去 |
| **用备份文件覆盖还原** | 拿 `.menuPinner.bak` 整体覆盖（最彻底的回滚） |
| **还原并卸载本扩展** | 一条命令收尾：还原所有改动 + 清理记录 + 卸载本扩展（详见 [卸载](#卸载)） |

### 三步上手

1. 运行 **Menu Pinner: 把命令固定到右键菜单顶部**
2. 选「编辑器内右键菜单」→ 输入 `live server` → 选中 `Open with Live Server`
3. **完全退出 VS Code**（关闭所有窗口）再打开 —— 它就在菜单第一项了

> ⚠️ `Developer: Reload Window` 和 `Restart Extension Host` **都无效**。菜单顺序写在扩展清单里，只有重启才会重新读取。

---

## 原理

VS Code 的右键菜单顺序来自扩展清单（`package.json`）里的**静态贡献**，没有运行时 API 可以改：

```jsonc
"contributes": {
  "menus": {
    "editor/context": [
      { "command": "extension.liveServer.goOnline", "group": "myGrp@liveServer", "when": "resourceLangId == html" }
    ]
  }
}
```

排序规则（在 VS Code 1.141 的 `workbench.desktop.main.js` 里核对过）：

```js
if (a.group === "navigation") return -1;   // navigation 组永远排最前
if (b.group === "navigation") return 1;
// 其余组按 group 名 localeCompare；同组内按 @ 后面的数字升序
order = Number(group.substr(c + 1)) || undefined
```

所以本扩展做的是：**找到贡献这个菜单项的那个扩展**，把它的 `group` 改成 `navigation@-1000`（内置项的 order 最小值实测是 `-11`，`-1000` 稳赢）。多个置顶项依次用 `-1000 / -1001 / …`，最近固定的排最上面。

## 安全性

它会修改**你已安装的其他扩展**的 `package.json`，因此做了这些保护：

- 改动前自动备份为 `<package.json>.menuPinner.bak`（每个清单只备份一次）
- 只在原文上替换目标字符区间，**其余字节完全不动**（键顺序、缩进、注释都不受影响）
- 改完立刻 `JSON.parse` 校验，非法就放弃、**绝不写坏文件**
- 所有改动记在 `pins.json`，可逐项还原，也可用备份整体覆盖
- 每次改写在 **Menu Pinner** 输出面板里打印具体改了哪一行

状态文件位置：

| 系统 | 路径 |
|---|---|
| Windows | `%APPDATA%\Code\User\globalStorage\menuchange.menu-pinner\pins.json` |
| macOS | `~/Library/Application Support/Code/User/globalStorage/menuchange.menu-pinner/pins.json` |
| Linux | `~/.config/Code/User/globalStorage/menuchange.menu-pinner/pins.json` |

> `pins.json` 由扩展独占写入：VS Code **运行时**手工编辑它，会被扩展内存里的状态覆盖。要改就在扩展里改（"查看 / 还原已改动项"）。

### 卸载

**一条命令搞定**：`Menu Pinner: 还原并卸载本扩展`。它会依次：

1. 按记录把每一项改动写回原始 `group` / `when`；
2. 用 `<package.json>.menuPinner.bak` 把被改过的扩展清单**整体覆盖**回原样（连手工改过的残留也一并抹掉），成功还原的备份文件随即删除；
3. 清空记录，并调用 VS Code 的卸载命令移除本扩展。

完成后**完全退出 VS Code 再打开**即可。

> 卸载**不会**自动删掉 `globalStorage` 里的状态目录（VS Code 的一贯行为）。第 3 步会顺手删掉 `pins.json`，如果目录还在（只剩空壳），可以自己删。

手动等价操作（不想用命令时）：

1. 运行 **Menu Pinner: 按记录还原全部改动**（或 **用备份文件覆盖还原**，更彻底）
2. 在扩展页里 Uninstall，或 `code --uninstall-extension menuchange.menu-pinner`
3. 重启 VS Code

⚠️ 注意：如果**不先还原**就卸载，被改过的扩展清单会保持现状 —— 菜单顺序仍然是你改过的样子（功能正常，只是不再受本扩展管理）。此时用第 2 步的"用备份文件覆盖还原"，或者直接手动把 `<package.json>.menuPinner.bak` 复制回 `package.json` 也能恢复。

---

## 已知限制

1. **必须手动重启 VS Code**。作者试过两版"一键自动重启"，都不成立：
   - 固定延迟启动新实例：撞上单实例锁，新实例会转发给老实例后自己退出，结果是"关了没起来"；
   - 独立助手进程等老进程退出再拉起：VS Code 用 Job Object 管子进程并设置 kill-on-job-close，VS Code 一退出助手就被一起杀掉（日志文件都来不及写）。

   所以本扩展只提示你手动重启，不给你的编辑器"关了就回不来"的风险。
2. **VS Code 内置命令**（如"格式化文档"）的菜单项藏在程序本体里，**无法隐藏**；置顶时会在原位置之外**多出一项**（菜单里出现两个同名项）。同理，装在 `resources/app/extensions` 下的自带扩展也按内置处理。
3. 菜单改动是**写进扩展清单**的，所以被改扩展一旦更新就会被覆盖 —— 本扩展在启动 3 秒后自检，发现被覆盖会提示"重新应用"。
4. 面向**本地桌面**使用。远程 / WSL / Dev Container 场景下扩展跑在远端，改的是远端的清单，行为需要自行验证。
5. 需要 VS Code **1.75+**。

---

## 开发

```bash
git clone <this-repo>
cd menuchange

# 跑测试（纯 node，无需安装依赖）
node test/manifest-utils.test.js       # 清单改写引擎：解析/插入/替换/删除/多补丁偏移/JSONC 容错/真实清单回放
node test/nls.test.js                  # %key% 本地化标题解析

# 看看某个菜单里都有哪些项（只读）
node test/scan-preview.js explorer/context

# 重新生成图标
node tools/make-icon.js

# 打包 VSIX → dist/menuchange.menu-pinner-<version>.vsix
node tools/package-vsix.js
```

- `lib/manifest-utils.js`：纯文本层面的清单改写引擎（不依赖 `vscode`，可单测）
- `lib/nls.js`：把清单里的 `%key%` 标题解析成 `package.nls*.json` 里的真实文案
- 发版：改 `package.json` 的 `version` → `git tag v1.0.0 && git push --tags`，GitHub Actions 会自动打包并把 VSIX 挂到 Release 上

### 发布前请改这三处

1. `package.json` 里的 `"publisher": "menuchange"` → 换成你的 GitHub ID（会影响扩展 ID 和安装目录名）
2. 本文档里的仓库地址占位符
3. 如果改过 `publisher`/`name`，`extension.js` 顶部的 `SELF_ID` 要同步改成 `"<publisher>.<name>"`

### 想发到 VS Code Marketplace

需要 Azure DevOps 组织 + Personal Access Token，然后：

```bash
npx @vscode/vsce publish -p <token>
```

（本仓库默认的 GitHub Release 分发不需要这些。）

## License

[MIT](LICENSE)
