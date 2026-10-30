# 发布与分发

## 方式一：发布到 GitHub（推荐，零成本）

仓库已经准备好（`main` 分支、首个提交、GitHub Actions 工作流）。你只需要把它推到 GitHub：

### 用 GitHub Desktop（你机器上已安装，最简单）

1. GitHub Desktop → **File → Add local repository…** → 选择 `D:\dsh-vscode-panel`
2. 右上角出现 **Publish repository** → 取消勾选 *Keep this code private*（要给别人用就公开）
3. 点 **Publish repository** —— 完成，仓库地址就是 `https://github.com/<你的账号>/dsh-vscode-panel`

### 用命令行（已有 GitHub 账号时）

```powershell
cd D:\dsh-vscode-panel
git remote add origin https://github.com/<你的账号>/dsh-vscode-panel.git
git push -u origin main
```

### 发一个 Release，别人直接下载装

```powershell
git tag v1.0.0
git push origin v1.0.0
```

推送 tag 后，仓库里的 `.github/workflows/build-vsix.yml` 会自动：
打包桥接 → 编译 → 生成 VSIX → **上传到该 Release 的附件**。

别人在 Release 页面下载 `dsh-vscode-panel-1.0.0.vsix`，在 VS Code 里
「扩展 → ⋯ → 从 VSIX 安装」即可。桥接插件已经打在里面，装完执行
**`DeepSeek Harness: 安装桥接插件到桌面版`** 一键写入桌面版 profile。

## 方式二：发布到 VS Code 市场（能被搜索到）

需要两样只有你能提供的东西：

1. **publisher**：<https://marketplace.visualstudio.com/manage> 创建，ID 要和
   `extension/package.json` 的 `publisher` 一致（现在是 `hzx-ink`）。
2. **PAT**：Azure DevOps → Personal access tokens，勾 **Marketplace → Manage**。

然后：

```powershell
$env:VSCE_PAT = '你的PAT'
powershell -ExecutionPolicy Bypass -File scripts\publish.ps1
```

发布成功后，VS Code 扩展面板搜索 **DeepSeek Harness** 即可安装（索引有几分钟延迟）。

## 方式三：Open VSX（免费，GitHub 登录）

适合 VSCodium / code-server。

1. <https://open-vsx.org> 用 GitHub 登录，创建同名 publisher（`hzx-ink`）。
2. User Settings → Tokens 生成 token。
3. `$env:OVSX_PAT='...'; powershell -File scripts\publish.ps1 -OpenVsx`

## 本地出包（不发任何地方）

```powershell
npm run vsix
# -> extension\dsh-vscode-panel-1.0.0.vsix
```
