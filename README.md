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
├── Frontend (React 19 + TypeScript + Vite + TailwindCSS v4)
│   ├── CommitGraph: Topologically-sorted Git DAG with canvas/SVG links
│   ├── DiffViewer: Split / Unified line-by-line Diff with hunk capsules
│   ├── AIExplanationDrawer: Live SSE reader & dynamic Action Trail HUD
│   └── SettingsModal: Config-driven Agent runtime & Prompt editor
│
└── Backend (Node.js + Express + Simple-Git)
    ├── agentEngine: Autonomous ReAct loop with true SSE token streaming
    ├── agentTools: Git-indexed high-speed symbol & file locator
    ├── aiService: Direct fast diff review stream
    └── gitService: Local repository inspect, branches & commit DAG generator
```

---

## 🚀 快速开始与安装指引

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
> 该命令会使用 `concurrently` 同时启动前端开发服务器（`http://localhost:5173`）与后端 Express 引擎（`http://localhost:3001`）。

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
  * 最大探查轮数（1~12 轮滑块，支持极速、均衡与深度预设）
  * 单轮超时控制（20s ~ 90s）与断线自动重试次数（0 ~ 3 次）
  * 全局审查提示词与 5 大场景一键预设

---

## 🤝 贡献与开源协议

欢迎提交 Issue 与 Pull Request！本项目采用 [MIT License](LICENSE) 开源协议。
