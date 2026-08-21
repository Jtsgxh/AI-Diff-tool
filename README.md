# Git 语义对比与可视化工具 (Git Semantic Diff & Codex Agent Reviewer)

> 🎨 一个高颜值、类 **Fork** 风格的现代 Git 可视化审查工作台，深度集成了 **OpenAI Codex / Agents SDK 智能体架构**，具备**文件系统探查、全库符号检索与自主决策**能力，彻底打破孤立 Diff 审查的信息孤岛。

---

## 🌟 核心特性

### 1. 🌿 现代 Git 工作台 (Fork 风格视觉与交互)
- **提交图谱 (Commit DAG Tree)**：多分支贝塞尔曲线拓扑连线、分支与 Tag 徽章截断保护、作者、时间与提交信息。
- **跨版本对比 (Compare Commits)**：按住 `Ctrl` / `Cmd` 选择任意两个提交，即刻进入对比模式。
- **工作区变更检视 (Working Tree)**：一键查看工作区当前所有暂存与未暂存的修改。
- **变更文件树 (Changed Files Panel)**：支持新增 (A)、修改 (M)、删除 (D)、重命名 (R) 状态徽章，提供实时 `+` / `-` 代码量统计。

---

### 2. ⚡ 专业代码差异对比 (Diff Viewer)
- **双模式秒级切换**：支持 **Split (Side-by-Side 双栏对比)** 与 **Unified (单栏内联)** 视图。
- **纯净标准的 Diff 布局**：保持与 Fork/GitHub 一致的标准清晰排版，没有任何遮挡干扰。
- **悬浮块级感知与操作**：鼠标悬浮在任意改动块 (Hunk) 上时，右上角浮出快捷操作胶囊。
- **多块联合选择 (Multi-Hunk Selection)**：支持跨文件任意勾选多个改动块，底部升起浮动操作条，一键发起多块联合关联分析。

---

### 3. 🧠 OpenAI Codex 智能体审查引擎 (Codex Agentic Reviewer)
- **官方开源 SDK 集成**：深度整合 `@openai/codex-sdk` 与 `@openai/agents` 架构。
- **代码库只读探查工具箱**：
  - `read_file(filePath, startLine, endLine)`：智能体自主阅读跨文件类定义、基类继承与下游实现；
  - `search_code(query, fileExtension)`：全局检索修改符号的所有调用方（Callers），全面评估破坏性变更 (Breaking Changes)；
  - `find_files(pattern)`：模糊匹配关联单元测试与契约接口。
- **完全自主决策循环**：AI 面对不同复杂度的修改，自主决定探查哪些文件、检索多少步，并在收集充分上下文后自动收敛并输出跨模块深度报告。
- **动态探索轨迹 (Live Action Trail)**：抽屉顶部实时展现 AI 的思考进度、工具调用与文件阅读过程，全流程透明可视。

---

### 4. 🎨 显式双模式自由切换
每个审查入口均提供明确的视觉区分与切换控制：
- 🧠 **文件关联解释 (Codex Agent)**：启用文件系统探查，输出跨文件、系统级全景架构审查报告。
- ⚡ **直接 Diff 解释 (Fast Direct)**：极速聚焦当前选定的增删代码行，不读取外部文件。

---

### 5. ⚙️ 多大模型与本地离线支持
- **DeepSeek** (`deepseek-chat` / `deepseek-reasoner`，内置 DSML 工具调用解析)
- **OpenAI** (`gpt-4o` / `gpt-4o-mini`)
- **Google Gemini** (`gemini-1.5-flash` / `gemini-1.5-pro`)
- **本地私有 Ollama** (`qwen2.5-coder` / `deepseek-r1` / `llama3.3`，源码 100% 不出内网，完全免费)

---

## 🛠️ 安装与运行指引

### 1. 环境准备
确保您的计算机已安装：
- **Node.js** >= 18.0.0
- **Git** >= 2.30.0
- **npm** >= 9.0.0

### 2. 克隆仓库与安装依赖
```bash
# 克隆仓库
git clone https://github.com/your-username/peaceful-shannon.git

# 进入目录
cd peaceful-shannon

# 安装全部依赖（包含 @openai/agents 与 @openai/codex-sdk）
npm install
```

### 3. 启动开发环境（一键启动前端 + 后端）
```bash
npm run dev
```

启动成功后：
- 🖥️ **前端界面**：[http://localhost:5173](http://localhost:5173)
- 🚀 **后端服务**：[http://localhost:4000](http://localhost:4000)

---

## 📖 使用说明

1. **打开本地 Git 仓库**：
   - 首次打开时，在弹窗中选择或输入您电脑上任意 Git 仓库的本地绝对路径（如 `C:/Users/username/Projects/my-project` 或 `/Users/username/Projects/my-project`）。
2. **配置 AI 模型**：
   - 点击右上角 **「⚙️ AI 引擎配置」**；
   - 选择服务商（如 **DeepSeek**、**OpenAI**、**Gemini** 或 **Ollama**）并填入对应的 API Key（若使用本地 Ollama 则无需 Key）。
3. **发起审查**：
   - **整体改动审查**：点击变更文件列表顶部的 **「✨ AI 语义解析整体改动」**；
   - **单文件审查**：在 Diff 视图右上角点击 **「Codex 关联解释此文件」** 或 **「直接解释此文件」**；
   - **改动块审查**：鼠标悬浮在任意改动块上，点击 **`🧠 关联解释 (Codex)`** 或 **`⚡ 直接解释`**；
   - **多块联合审查**：勾选多个改动块，在底部浮动栏点击 **`🧠 Codex 关联联合解释`**。

---

## 📁 项目工程结构

```
peaceful-shannon/
├── server/                      # 后端 Node.js Git 服务与 Codex 引擎
│   ├── index.ts                 # Express 服务端入口 (REST & SSE 流式接口)
│   ├── gitService.ts            # Simple-Git 封装 (Log, Diff, Working Tree, Compare)
│   ├── agentEngine.ts           # Codex 智能体多轮 Tool-Calling 决策循环与 DSML 解析
│   ├── agentTools.ts            # 代码库只读工具箱 (read_file, search_code, find_files)
│   └── aiService.ts             # 快速单 Diff 流式解析服务
├── src/                         # 前端 React 19 + TypeScript + Tailwind CSS
│   ├── components/
│   │   ├── Header.tsx           # 顶部导航、仓库切换、AI 配置入口
│   │   ├── CommitGraph/         # Fork 风格 Commit DAG 提交图谱 (SVG 贝塞尔拓扑)
│   │   ├── FilesPanel.tsx       # 变更文件列表与提交级全局解析入口
│   │   ├── DiffViewer/          # 双模式 Split / Unified 代码差异查看器与悬浮块级操作
│   │   ├── AIExplanation/       # Codex 探索轨迹 Action Trail 与 Markdown 审查抽屉
│   │   ├── SettingsModal.tsx    # AI Provider 与 API Key 设置弹窗
│   │   └── OpenRepoModal.tsx    # 切换与管理本地 Git 仓库弹窗
│   ├── utils/
│   │   ├── graphLayout.ts       # 提交图谱分支拓扑泳道算法
│   │   └── diffParser.ts        # Git Raw Diff 解析器 (Split/Unified/Hunk 划分)
│   ├── services/
│   │   └── api.ts               # 前端 API 请求与 SSE 流式事件监听 (Tool Events & Chunks)
│   ├── types/                   # TypeScript 类型定义
│   ├── App.tsx                  # 三栏式主工作台布局容器
│   └── main.tsx                 # 前端入口
├── package.json
└── README.md
```

---

## 📦 常用命令

| 命令 | 说明 |
| :--- | :--- |
| `npm run dev` | 同时启动后端服务与前端 Vite 开发热重载服务器 |
| `npm run server` | 单独启动后端 Express 服务 (`localhost:4000`) |
| `npm run client` | 单独启动前端 Vite 界面 (`localhost:5173`) |
| `npm run build` | 编译 TypeScript 并构建前端生产资源文件到 `dist/` |

---

## 📄 开源许可证

本项目基于 [ISC License](LICENSE) 开源。
