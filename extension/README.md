# DeepSeek Harness

在 VS Code 侧边栏直接使用**桌面版 DeepSeek Harness**：同一批会话、同一批模型、同一份历史。

- **不内置任何模型或运行时**：所有回答都由你电脑上的桌面版生成，并同步显示在桌面版的会话里。
- **模型来自桌面版**：面板里的模型目录就是桌面版已配置的模型（含推理强度）。
- **历史同步**：会话列表与历史直接读桌面版的会话库。
- **选中代码入框**：`Ctrl+Alt+A` 把选区带路径与行号加入输入框。
- **流式输出**：思考过程可折叠，每条回复带 token 用量。
- **结构化工具卡片**：read 显示文件片段、edit 显示 diff、bash 显示命令与输出。
- **图片**：输入框内粘贴或拖入图片随消息发送。
- **会话操作**：右上角「⋯」重命名 / 创建分支。
- **模型置顶与最近使用**。

## 开始使用

1. 电脑上已安装并运行**桌面版 DeepSeek Harness**。
2. 首次使用：命令面板（`Ctrl+Shift+P`）执行 **`DeepSeek Harness: 安装桥接插件到桌面版`**
   ——桥接插件已内置在扩展里，点「安装」即可写入桌面版 profile，然后重启桌面版。
3. 展开 VS Code 右侧栏（辅助侧边栏），点顶部图标条里的 DeepSeek Harness 图标。
4. 右侧栏收起时，`Ctrl+Alt+D` 会自动展开并聚焦面板。

> 只有本扩展、没有桌面版时无法工作：面板不内置模型，全部回答由你电脑上的桌面版生成。

## 命令

| 命令 | 说明 |
| --- | --- |
| `DeepSeek Harness: 打开对话面板` | 聚焦面板（`Ctrl+Alt+D`） |
| `DeepSeek Harness: 将选中代码加入对话` | 选区入框（`Ctrl+Alt+A`，编辑器右键菜单、标题栏「＋」同样可用） |
| `DeepSeek Harness: 将当前文件加入对话` | 整文件入框 |
| `DeepSeek Harness: 新建会话` | 开一段新对话 |
| `DeepSeek Harness: 历史会话` | 打开会话列表 |
| `DeepSeek Harness: 选择模型` | 快速切换模型 |
| `DeepSeek Harness: 刷新连接与会话` | 重新发现桌面版 |
| `DeepSeek Harness: 启动 DeepSeek Harness 桌面版` | 未运行时拉起桌面版 |
| `DeepSeek Harness: 显示日志` | 打开扩展输出，排查连接与选区问题 |
| `DeepSeek Harness: 查看「加入对话」的快捷键绑定` | 打开快捷键设置并定位到该命令，便于检查/改键 |

选中代码后，右下角状态栏会显示 `DSH 已引用 N 段`：快捷键是否生效一眼可见，点击即可打开面板。

## 前提

桌面版需要安装配套桥接插件 `dsh-vscode-panel-bridge`（本扩展的安装脚本会自动完成）。面板只连接 `127.0.0.1`，令牌保存在 `%USERPROFILE%\.dsh\vscode-panel\bridge.json`。

## 设置

`dsh.bridgeFile`、`dsh.home`、`dsh.desktopPath`、`dsh.maxContextLines`、`dsh.contextFormat`。
