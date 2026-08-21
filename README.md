# Git Semantic Diff & Visualizer (Fork 风格 Git 可视化与 AI 语义对比工具)

一个高颜值、极速响应、类似 **Fork** 的现代 Git 可视化对比工具，并在代码检视与差异对比的核心路径上深度集成了 **AI 语义解析引擎**。

---

## ✨ 核心特性

### 1. 🌿 Fork 风格 Git 工作台
- **交互式提交图谱 (Commit DAG Tree)**：多分支贝塞尔曲线拓扑连线、HEAD / 分支 / Tag 徽章、作者、提交时间与短 SHA-1。
- **跨版本对比 (Compare Commits)**：按住 `Ctrl` / `Cmd` 单击任意两个提交，即可立即进入版本 Diff 对比模式。
- **未提交改动检视 (Working Tree)**：一键查看工作区当前所有已暂存与未暂存的改动。
- **变更文件树 (Changed Files Tree)**：支持新增 (A)、修改 (M)、删除 (D)、重命名 (R) 状态筛选，显示 `+` / `-` 代码行数统计。

### 2. ⚡ 专业双模式代码差异对比 (Diff Viewer)
- **Split (Side-by-Side 双栏对比)** 与 **Unified (单栏内联)** 视图秒级无缝切换。
- 精确的旧行号与新行号对齐。
- 代码块 (Hunk) 级快捷操作。

### 3. 🤖 AI 语义解析引擎 (AI Semantic Explainer)
- **多维度结构化分析**：
  - 📌 **改动核心概述 (Executive Summary)**：一两句话精炼提炼本次改动的核心目的。
  - 🎯 **架构与业务意图 (Intent & Architecture Impact)**：分析业务意图、设计模式变动与跨模块协作影响。
  - 🔍 **核心逻辑改动拆解 (Logic Breakdown)**：分点剖析算法、数据流、状态机与关键逻辑变更。
  - ⚠️ **潜在隐患与风险雷达 (Risk Radar)**：自动检测并发安全、空指针、内存泄漏、Breaking Changes 等隐患。
  - 💡 **优化与重构建议 (Optimization Suggestions)**：提出针对代码健壮性与单元测试的建议。
- **多层级一键唤起**：
  - 点击右上角或文件树顶部 **「AI 语义解析整体改动」**
  - 悬浮单文件点击 **「AI 解释此文件」**
  - 在 Diff 代码块上方点击 **「AI 解释此代码块」**
- **交互式深度追问 (Interactive Q&A)**：
  - 针对该差异直接与 AI 进行多轮对话追问（如：“为什么此处需要加读写锁？”、“如何编写对应的单元测试？”）。
  - 内置快捷提问胶囊。

### 4. ⚙️ 多模型与本地私网支持
- **体验模式 (Demo Mode)**：内置智能启发式分析引擎，无需配置任何 API Key 即可开箱全功能体验。
- **多提供商支持**：
  - **DeepSeek** (`deepseek-chat` / `deepseek-reasoner`)
  - **Google Gemini** (`gemini-1.5-flash` / `gemini-2.0-flash` / `gemini-1.5-pro`)
  - **OpenAI** (`gpt-4o` / `gpt-4o-mini`)
  - **Ollama 本地私有模型** (`qwen2.5-coder` / `deepseek-r1` / `llama3.3`，满足源码不出内网需求)
  - **自定义端点 (Custom Base URL)**：兼容任何 OpenAI 规范的 API 代理或私有化部署。

---

## 🚀 快速启动

### 1. 安装依赖
```bash
npm install
```

### 2. 启动开发环境（前端 + 后端）
```bash
npm run dev
```
- 后端服务运行于: `http://localhost:4000`
- 前端界面运行于: `http://localhost:5173`

### 3. 打开任意本地 Git 仓库
在应用顶部路径栏中输入您本地任意 Git 仓库的绝对路径（如 `C:\Users\username\Projects\my-repo` 或 `/Users/username/Projects/my-repo`），点击 **打开** 即可立即加载该仓库的提交图谱与差异！

---

## 📂 项目结构

```
peaceful-shannon/
├── server/                      # 后端 Node.js Git 服务与 AI 引擎
│   ├── index.ts                 # Express 服务端入口 (REST & SSE 流式接口)
│   ├── gitService.ts            # Simple-Git 封装 (Log, Diff, Working Tree, Compare)
│   ├── aiService.ts             # AI 语义解析引擎 (支持 DeepSeek/Gemini/OpenAI/Ollama/Demo)
│   └── demoRepoService.ts       # 内置演示仓库数据
├── src/                         # 前端 React 19 + TypeScript + Tailwind
│   ├── components/
│   │   ├── Header.tsx           # 顶部导航、仓库选择、未提交变更、AI 配置入口
│   │   ├── CommitGraph/         # Fork 风格 Commit DAG 提交图谱 (SVG 贝塞尔拓扑)
│   │   ├── FilesPanel.tsx       # 变更文件列表与状态徽章
│   │   ├── DiffViewer/          # 双模式 Split / Unified 代码差异查看器
│   │   ├── AIExplanation/       # AI 语义解析抽屉与交互式追问面板
│   │   └── SettingsModal.tsx    # AI Provider 与 API Key 设置弹窗
│   ├── utils/
│   │   ├── graphLayout.ts       # 分支拓扑泳道算法
│   │   └── diffParser.ts        # Git Raw Diff 解析器 (Split/Unified/Hunk)
│   ├── types/                   # TypeScript 类型定义
│   ├── App.tsx                  # 三栏式主工作台容器
│   └── main.tsx                 # 前端入口
└── package.json
```
