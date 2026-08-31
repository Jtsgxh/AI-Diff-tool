# AI-Diff-Tool 🚀

> **基于自主 ReAct 智能体引擎与 Git 原生索引的高性能语义代码审查与可视化工作台**  
> *AI-Powered Semantic Git Diff & Multi-File Code Review Workbench with Autonomous Agent Engine*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://reactjs.org/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38bdf8.svg)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 🌟 核心亮点与设计理念

在复杂的现代工程（如 Unity / C# / 大型后端单体仓库）中，审查代码如果**仅看当前的局部 Diff 片段**，往往无法看清真实改动的影响范围。**AI-Diff-Tool** 专为解决这一核心痛点而生：

1. **🧠 自主 ReAct 智能体架构 (Autonomous Codebase Agent)**
   - 具备只读代码库环境与决策能力，能主动调用工具跨文件阅读基类定义、接口契约与依赖文件；
   - 探查与收敛决策两阶段解耦，探查完毕后自动触发终审合成，绝不半路中断。

2. **⚡ Git 原生索引高速符号检索 (Git Grep & Indexing)**
   - 抛弃低效的同步文件遍历，底层深度接入 `git grep -E` 与 `git ls-files`；
   - 毫秒级快速检索下游调用方、类继承与符号引用，自动遵循 `.gitignore`，在大规模仓库中极速响应。

3. **🌊 纯真 HTTP SSE 实时 Token 流式响应 (Zero-Latency Streaming)**
   - 拒绝伪流式打字机延迟，报告生成阶段直通大模型服务端 SSE 数据流，Token 实时吐出，零等待感知。

4. **🎯 专家级代码审查体系 (Before vs After)**
   - 强制对比「改动前旧实现」与「改动后新实现」；
   - 深度拆解核心代码逻辑、参数语义与状态迁移，彻底告别空洞套话。

5. **🎛️ 100% 纯配置驱动与预设定制**
   - 底层代码零死板模板，提供「极简直解」、「架构全景」、「性能/GC优化」、「边界测试用例」、「Clean Code」等 5 大常用预设，亦支持任意手写自定义 Prompt。

6. **🗂️ 沉浸式 Fork 风格 Git DAG 图谱与面板折叠收纳**
   - 还原现代化 Git DAG 拓扑分支树，支持单提交审查、双提交多选对比（`Ctrl/Cmd` 单击对比）及未提交 Working Tree 实时审查；
   - 一键收起左侧历史面板，释放 100% 全屏空间进行沉浸式双栏（Split Diff）代码阅读。

---

## 📸 核心界面预览

* **拓扑提交图谱 (DAG)**：支持任意提交分支拓扑可视化与多选对比；
* **双模式审查切换**：`[ 🧠 关联解释 (Agent) ]` vs `[ ⚡ 直接 Diff 解释 ]` 毫秒级随意切换；
* **探查轨迹实时 HUD**：探查节点数、耗时、动作记录动态可视化展示；
* **左侧历史一键收纳**：支持折叠为紧凑收纳条，释放超大代码对比区域。

---

## 🛠️ 技术栈架构

```
AI-Diff-Tool
├── shared/types.ts ................ 前后端共用的唯一类型契约（Git 领域 + AI 配置 + SSE 事件）
│
├── src/ (React 19 + TypeScript + Vite + TailwindCSS v4)
│   ├── hooks/
│   │   ├── useRepository ............ 仓库元信息、提交列表、选区与 Diff 加载（含竞态防护）
│   │   └── useDeferredMount ......... 视口驱动的延迟挂载，用于超大 Diff
│   ├── services/
│   │   ├── sseClient ................ 统一的 SSE 传输层（两个流式端点共用）
│   │   ├── api ...................... REST + 流式接口封装与请求去重
│   │   ├── aiCache .................. 惰性水合的多级持久化缓存
│   │   └── aiLogger ................. 批量通知的 AI 调用记录中心
│   └── components/
│       ├── CommitGraph .............. 拓扑排序 Git DAG 与 SVG 分支连线
│       ├── DiffViewer ............... 工具栏 / HunkBlock / HunkRows 分层，逐块记忆化
│       ├── AIExplanation ............ 抽屉视图 + useReviewSessions 会话状态机
│       └── SettingsModal ............ 配置驱动的引擎运行参数与提示词编辑器
│
└── server/ (Node.js + Express + Simple-Git)
    ├── routes/ ...................... system / repo / ai 三组路由
    ├── http/ ........................ SseStream（含客户端断连传播）与统一错误中间件
    ├── config/providers ............. 各模型服务商的默认端点与模型解析
    ├── prompts ...................... 全部提示词与 Diff 截断上限
    ├── agentEngine .................. 自主 ReAct 循环与真实 SSE Token 流
    ├── agentTools ................... Git 索引高速符号与文件检索沙箱
    ├── aiService .................... 直接 Diff 快速审查流
    ├── gitService ................... 仓库检视、提交 DAG 与带缓存的 Diff 计算
    └── cache/lru .................... 不可变提交 Diff 的有界缓存
```

---

## 🚀 快速开始与安装指引

### 0. 环境要求

| 依赖 | 版本 | 校验命令 |
| --- | --- | --- |
| Node.js | **≥ 22.12**（`openai@7` 要求 ≥ 22，`vite@8` 要求 ≥ 22.12） | `node -v` |
| Git | 任意近期版本，且 `git` 必须在 `PATH` 中 | `git --version` |

> 后端的符号检索直接调用 `git grep` / `git ls-files`，**Git 不在 `PATH` 里智能体探查会失效**。
> Windows 用户请安装 [Git for Windows](https://git-scm.com/download/win)，安装时选择「Git from the command line」。

### 1. 克隆代码仓库

```bash
git clone https://github.com/Jtsgxh/AI-Diff-tool.git
cd AI-Diff-tool
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动开发服务

```bash
npm run dev
```
> 该命令会使用 `concurrently` 同时启动前端开发服务器（`http://localhost:5173`）与后端 Express 引擎（`http://localhost:4000`）。
> 浏览器只需打开 **`http://localhost:5173`**，`/api` 请求由 Vite 代理转发到后端，无需直接访问后端端口。

若需分别启动（便于单独重启某一侧）：

```bash
npm run server   # 仅后端
npm run client   # 仅前端
```

#### 🪟 Windows 启动说明

上述命令在 **PowerShell、cmd 与 Git Bash** 下均可直接使用，无需额外适配。

**修改端口**：不要用 `PORT=4001 npm run dev` —— 那是 POSIX 写法，在 cmd / PowerShell 下无效。
请在项目根目录建 `.env` 文件（三种终端与三大平台行为一致，Vite 代理会自动跟随新端口）：

```ini
PORT=4001          # 后端端口
CLIENT_PORT=5273   # 前端端口（可选）
```

**Windows 常见启动问题**：

| 现象 | 原因与处理 |
| --- | --- |
| `EADDRINUSE`，但用 `netstat` 查不到占用者 | Hyper-V / WSL / Docker 会预留端口段。用 `netsh interface ipv4 show excludedportrange protocol=tcp` 查看被保留的区间，然后在 `.env` 里换一个区间外的端口 |
| PowerShell 报「无法加载文件 npm.ps1，禁止运行脚本」 | 执行策略限制。改用 `npm.cmd run dev`，或以管理员执行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| 页面能开，但所有 `/api` 请求失败 | 后端没起来或端口不一致。先单独跑 `npm run server` 看报错；确认 `.env` 的 `PORT` 与后端日志里打印的端口一致 |
| 仓库路径含空格或中文导致输入出错 | 点「打开仓库」使用**系统原生文件夹选择器**（该功能为 Windows 专属，底层调用 PowerShell 的 `FolderBrowserDialog`） |
| 超长路径的仓库 `git` 报错 | 执行 `git config --system core.longpaths true` |

### 4. 生产打包

```bash
npm run build
```

---

## ⚙️ AI 模型与引擎配置

打开应用后，点击右上角 **「⚙️ AI 引擎配置」** 即可连接您的真实模型：

* **支持的模型提供商**：
  * 🟢 **DeepSeek**（官方推荐，超强代码逻辑推理能力，模型名：`deepseek-chat`）
  * 🔵 **OpenAI**（`gpt-4o`, `gpt-4o-mini`）
  * 🔴 **Google Gemini**（`gemini-1.5-flash`, `gemini-1.5-pro`）
  * 🟣 **Ollama 本地私有模型**（`qwen2.5-coder`, `deepseek-r1`，免 API Key）
  * 🟡 **自定义 OpenAI 兼容中转站**
* **Codex 智能体运行参数**：
  * 自动规划使用 10 轮安全上限，也可手动设置最大探查轮数
  * 单次模型/工具调用与 SSE 静默超时控制（20s ~ 1800s），支持断线自动重试
  * 全局审查提示词与 5 大场景一键预设

---

## 🤝 贡献与开源协议

欢迎提交 Issue 与 Pull Request！本项目采用 [MIT License](LICENSE) 开源协议。
