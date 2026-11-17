# dsh-aihub 本地目录安装说明

这个压缩包是 DeepSeek Harness（DSH）的插件源码目录。**无需联网安装依赖，也无需 npm/GitHub 访问。**

## 前提

1. 已安装 DeepSeek Harness，能正常打开 Web 界面
2. Node.js **≥ 22.5**（DSH 自带或系统安装均可）
3. 至少一个平台已在本机登录官方客户端：
   - Qoder：可在插件设置页粘贴 PAT
   - Trae：在本机 Trae CN / TRAE SOLO 客户端登录过
   - CodeArts：在本机 CodeArts 客户端登录过

## 安装

### 方式 A：界面安装

1. 把压缩包解压到任意目录，例如 `D:\plugins\`，得到 `dsh-aihub` 文件夹
2. 打开 DSH → 设置 → 插件（Plugin Manager）
3. 选择「从本地目录安装 / Install from folder」
4. 选择解压出来的 `dsh-aihub` 文件夹（**选文件夹本身，不是里面的 js 文件**）
5. 安装完成后**刷新页面**

### 方式 B：让 DSH Agent 安装

在 DSH 对话里说：

```
安装本地插件：D:\plugins\dsh-aihub
```

或者使用插件管理工具执行：

```
plugin_manager: install_bundle D:\plugins\dsh-aihub
```

> 路径请替换成你实际解压的位置；路径中尽量不要有中文以外的特殊字符，避免权限问题。

## 安装后

刷新页面，会出现：

- **设置 → AI Hub**：平台授权、模型选择、使用顺序、模式配置
- **模型选择器 → AI Hub → Dev / Dev Fast / Selftest**
- **左侧栏底部 → AI Hub 额度卡**：三家额度进度 + 行内签到

第一次使用：

1. 打开 设置 → AI Hub
2. 检查 Qoder / Trae / CodeArts 三张卡（未授权的按提示授权）
3. 在「模式配置」里选好 `Dev` 各平台使用的模型
4. 点「保存配置」
5. 模型选择器里选 **AI Hub → Dev**，开始对话

## 更新

用新版本的 `dsh-aihub` 文件夹替换旧文件夹，然后在插件管理器里重新安装一次（或先卸载再安装），刷新页面。

## 卸载

设置 → 插件 → 找到 `dsh-aihub` → 卸载，刷新页面。

## 安全说明

- 插件**不包含任何账号、token、cookie**
- Qoder PAT 保存在本机 `DSH_HOME/.aihub/qoder.json`（权限 0600）
- Trae 只读取官方客户端 `storage.json`，在内存中解密
- CodeArts 只读取本机账号文件；自动刷新时会写回轮换后的 `refresh_token`，并保留 `.aihub-backup` 备份
- 所有请求直接发往各厂商 API，插件自身没有远端服务器

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 安装后模型选择器没有 AI Hub | 刷新页面；确认插件状态是 enabled |
| 提示 provider 重复 / 已有 aihub | 先卸载旧的 AI Hub 插件，再安装这个 |
| 插件激活失败 | 确认 Node ≥ 22.5；确认选的是文件夹而不是压缩包 |
| 三个平台都显示未授权 | 先在官方客户端登录，或填写 Qoder PAT |
| 某个平台报错 | 正常，降级链会自动切到下一个平台 |

## 已知限制

- Trae 对话只支持 SOLO 通道认可的模型
- CodeArts 单账号最多 3 个并发会话
- 纯文本模型，图片按占位符处理
- 切换平台时不会传递上一模型的推理过程

许可证：MIT