# Mobile review regression

仓库对话回归：`node --import tsx --test tests/repositoryConversation.test.ts tests/deepSeekReasoning.test.ts tests/structuredLearnSynthesis.test.ts`。
运行前把 `AI_DIFF_CONVERSATION_DIR` 指向临时目录，隔离生产历史。测试覆盖审查与学习隔离、跨模式前缀、重启恢复、工具消息完整性、仓库隔离、排队取消、清除防写回和预算上限；模型响应全部模拟。
同时覆盖无工具请求不携带工具声明、直接解释/块释义/伪代码的仅思考 `stop` 响应最多补一次正文，以及空响应或意外工具调用不误报成功。

With the Vite client running and Playwright available, run `node tests/mobile-review.mjs`.
Set `MOBILE_TEST_URL` to the client URL (default `http://localhost:5173`),
`MOBILE_TEST_BROWSER` to an installed Chromium channel (default `msedge`), and
optionally `MOBILE_TEST_OUTPUT` for screenshots. If Playwright is provided by an
external runtime, set `NODE_PATH` to its `node_modules` directory.

The isolated touch browser context intercepts all API calls. It verifies commit →
file → unified Diff → AI navigation, file and hunk navigation, full-file mode,
long code wrapping and horizontal background coverage, touch commit range selection
(including reverse endpoints, hidden intermediate commits and cancellation), background review completion without duplicate requests,
action-menu dismissal after selection, mode changes, inline/external explanations, outside taps and Escape,
per-hunk code/explanation pages with native touch swiping, width changes, closing and full-file mode,
floating full-file diff navigation (previous/next, direct jump and landscape focus),
workspace restoration after reload and tab recreation (commit range, selected file,
Diff/full-file mode, wrapping and scroll position), per-repository isolation and invalid-selection fallback,
draft/scroll preservation, widths 320/390/430/767, phone landscape focus with controls
hidden/revealed for Diff and full-file reading, portrait restoration, a short viewport, and restoration
of desktop panel sizes and split view. It generates screenshots in the system temp
directory by default. No live model calls or repository writes are made.

# Learn graph performance regression

Run the scheduler and layout tests:

```sh
node --import tsx --test tests/graphFrameScheduler.test.ts tests/learnCommunityLayout.test.ts tests/learnGraphLabels.test.ts tests/learnGraphFilter.test.ts tests/learnBusinessBus.test.ts tests/structuredLearnSynthesis.test.ts tests/sseClient.test.ts
```

`learnBusinessBus.test.ts` covers the strict v2 AI envelope, structural binding,
shared cross-route nodes, repeated methods, deterministic layout, hidden-step gaps,
manual supplements and recursive drill-down prompts. It also checks that initial
whole-repository prompts build an entry-coverage plan, target 4–8 verified routes for
complex repositories, and do not apply that count target to supplements or drill-downs.

`structuredLearnSynthesis.test.ts` covers the isolated JSON Output and prose stages,
exact field-path validation, one full regeneration after malformed structured data,
and continuation when a prose response stops before its completion marker. These use
intercepted provider responses and do not make live model requests.

For real canvas/React checks, run `npm run client` and open
`http://localhost:5173/tests/learn-graph-performance.html` (use the configured client port if different).
This fixture uses 2,400 synthetic class nodes, 14,400 directed edges and 24 communities.
It imports the production component, runs in React StrictMode, and updates its parent every 500ms
like a streaming workbench. It does not load a repository, call the backend or request AI analysis.

1. Switch to **丰富**, wait for **正在后台整理社区布局** to disappear, then click
   **采样 2 秒**. `draws`, `curves`, `callbacks` and `callbackMs` should all be zero while idle.
   The grid preview is immediately drawable. The original community-anchored layout settles in a
   worker and replaces the preview once; it does not repaint the whole graph on every physics step.
   These are instrumented JavaScript/canvas submission measurements, not end-to-end GPU frame times.
2. Click **选中首个类**, then **批量中键拖动**. The 100 pointer moves should coalesce to one draw,
   `selectionUnchanged` should be true, `panPixels` should be 100, and `textMeasures` should be zero
   after the selected frame has painted. The helper bypasses native pointer capture only for its
   synthetic events; also check real pointer interaction in the browser.
3. Click **拖到视口外**. The selected node remains selected and `lastFrameCurves` becomes zero.
   **适应视图** must restore the complete graph; viewport culling must not remove graph data.
4. Close the panel and sample: zero redraws. Reopen: the graph reappears. Resize it in both
   directions and check canvas dimensions and visibility. Background tabs should also pause.
5. Check wheel zoom, hover direction highlights, left-click selection, route selection, search,
   community hiding (Shift-click), and simple/rich switching after layout is idle. Each must
   trigger a fresh frame, preserving curved arrows, edge types, route badges and connection lists.
6. Unmount and sample: zero redraws/callbacks. Mount again to check effect/observer cleanup.
7. Toggle **简化 / 丰富** repeatedly, leaving at least 1.2 seconds between clicks for the measurement
   window. `density-measurements` records first canvas submission latency and draw count, not GPU
   presentation latency. Every switch should take only the initial/resize paint(s), never 180/420
   animation frames. A first visit may also paint the worker result once. A second click on the
   already-active mode should draw nothing. Returning to
   rich mode should reproduce the same first-node position. Resizing the pane should not discard
   either mode's stored community arrangement.
8. After visiting both modes, click **更新图数据** and switch modes again. Select the first class:
   its updated label (`UpdatedService0`), degree (42) and community must be used even though its ID
   is unchanged. This checks that cached layouts cannot survive a source-graph update.
9. In rich mode, run **连续拖动采样**, **连续缩放采样** and **连续悬停采样** separately. Each sends
   40 interactions across separate animation frames, not 100 events merged into a single paint.
   `continuous` reports frame-interval median/p95/max, all submitted curves (including the offscreen
   background), bitmap composites, selection preservation and `detailsUnchanged` (checked on every
   frame, not just at the end). These frame intervals include browser
   rendering delays; `callbackMs` alone does not measure that cost. Keep the test tab foreground.

   - Within the buffered viewport, panning should reuse background pixels (`bitmapBlits` increases,
     with no background curve submissions); only focused connections are drawn live.
   - Wheel gestures scale the background buffer while nodes/focus remain live. About 120ms after the
     last wheel event the background is rebuilt at exact scale. Check both the smooth gesture and
     the final crisp image; the gesture timing does not include this deferred redraw.
   - Crossing a partial buffer's boundary, changing the graph/hidden communities, resizing or switching
     density must rebuild the background. A buffer containing the whole graph can be panned any distance
     without rebuilding. Large panning must not leave blank strips or stale lines.
   - Hide/show the pane after zooming, and unmount during zoom. There must be no recurring frames or
     retained rendering work after cleanup.
10. Check `workers` after both modes have settled: repeated density switches must not increase
    `started`. Update source data during a calculation and check that the old worker cannot restore
    stale nodes. Unmount: `active` must become zero. StrictMode's initial discarded mount may start
    and cancel one extra worker; it must not prevent the second mount from finishing its layout.
11. Click **聚焦高连接枢纽**: the first class has 252 connections. Its name takes precedence over
    neighbor names and relation captions; labels should move to alternate positions or be omitted
    when there is no space, never pile up. All 2,400 classes and 14,640 edges remain in rich mode.
    The selected node pins its complete name and incoming/outgoing connection details. Use **取消固定**
    to resume hover previews. Route number badges
    and the toolbar reserve their own space, and community headings are painted above edge lines.
    Shrink the pane and use **适应视图**: the camera must leave room for the wrapped toolbar above
    the graph instead of fitting the top-row nodes underneath those controls.
12. After rich-mode layout settles, click **固定路线回归**. This exercises the production pointer
    handlers and compares both the details panel and the actual submitted highlight curves, not
    just the selected React prop. Every check must pass: node clicks pin on release, hover/leave,
    blank clicks, left/middle drags (including drags starting on another node), pointer cancellation
    and lost capture preserve the pin. Moving back to the drag's origin must not count as a click.
    Zoom redraws without changing the pin, fit restores its curves, a new click switches the pin,
    and the production **取消固定** button clears highlights and restores hover previews.
    Also check these interactions with a real mouse and in simple mode. Choosing a business route
    explicitly clears the node pin; switching density, resizing or hiding/reopening the pane does not.

Measured on the local in-app browser with this synthetic fixture (not the user's repository):

| Rich-mode interaction | Before (median ms/frame) | After (median ms/frame) |
| --- | ---: | ---: |
| Continuous pan | 444.6 | 16.5 |
| Continuous wheel zoom | 570.6 | 16.6 |

The pan comparison submitted 576,000 background curves before and reused 40 bitmap composites
after. Initial rendering, buffer-boundary rebuilds and the final post-zoom redraw are still work;
these measurements do not claim that every operation on every repository runs at 60fps.
After restoring the settled layout and adding label placement, the 252-connection hub variant
also measured 16.7ms median / 18.1ms p95 for continuous pan. Repeated simple/rich switches did not
start new workers, and idle/hidden/unmounted samples had zero draws and zero rendering callbacks.

The fixture is a separate development entry point and is not included in the production bundle.

## Learn session manual-analysis regression

Open `http://localhost:5173/tests/learn-session.html` and click **验证手动分析**.
This StrictMode fixture runs the production workbench, hook, report validator and SSE client.
All fetches are intercepted; AI responses and cache entries are in memory, with no real model
requests or user-cache writes. Unexpected request paths fail instead of reaching the backend.

All 27 checks must pass: entering/reentering without a cache, restoring a valid cache, invalid
or unmapped reports, source/HEAD/repository/model/prompt changes, failed or cancelled analyses
must not automatically call AI. Explicit analysis, reanalysis, manual graph expansion, recursive
node drill-down and file questions still work. Drill-down checks cover two levels, leaf empty-state,
breadcrumb return and path-specific cache reuse. Long mixed Chinese/Latin labels must remain inside
their business nodes and route-label lane.
Leaving the page cancels an unfinished stream, and changing the prompt during that stream must
not silently replace it with a new request. The expected nine intercepted requests are all
explicit test actions, including two nested drill-down analyses.

## Test-node display filter regression

In the same session fixture, click **验证测试节点过滤**. All 17 checks must pass. The mixed graph
contains five production classes and three test classes (including test-directory-only matches).
The filter defaults on, works in both densities, removes incident edges and test-only communities,
updates community details, and remembers its setting when reentering the workbench. `AbilitySpec`,
`LatestSnapshot` and `ContestReward` remain visible. Turning it off restores all eight nodes/edges,
including when the filtered graph is completely empty. The same fixture checks the default
business-bus tab, source-only evidence label, route step counts and hidden-step gaps.

Only one intercepted AI request is expected, from the fixture's explicit analysis click to create
routes. Filter toggles do not call AI or rewrite cached reports. A route with a hidden middle step
must report 2/3 visible steps and submit **zero** highlighted route curves, not a shortcut between
the remaining classes; restoring that step must submit the original two curves. A wholly hidden
test route is disabled with a filtering explanation, not an unmappable-data warning.

After the checks, the normal mixed graph is available with filtering off. In rich mode, click
`Entry` to pin it and turn filtering on: the pin stays, but its test neighbor and incident line
disappear from both connection panels. Turn filtering off, pin `CombatTestPipelineAbilitySpec`,
and enable filtering again: its pin/details must clear, and turning filtering off must not
resurrect the old pin. Zooming/panning a retained business node must still preserve its pin.

# VS Code 与跟写测试

`followService.test.ts` 在真实临时 Git 仓库中检查连续路线、已合并分支进入主线、多条可用路线时的父节点优先顺序、合并冲突结果、squash 原提交的祖先关系、独立克隆、中文路径、Git 换行归一化、误改和额外文件、进度恢复及路径边界。`vscodeHost.test.ts`、`vscodeWorkbench.test.ts` 和 `vscodeExtension.test.ts` 使用模拟页面或 VS Code API，验证实际桥接代码、真实本地服务和原生命令衔接；不会声称已经验证真实语言扩展的补全。

沿用测试命令 `node --import tsx --test tests/*.test.ts`。受限环境可通过已有的 esbuild 将测试转为 JavaScript 后使用 `node --test` 执行；若用户目录不可写，运行前将已有的 `AI_DIFF_CONVERSATION_DIR` 指向独立的可写测试目录，避免模型测试写入用户历史。

新建练习默认只包含结束提交一个目标；范围测试确认中间新增后删除的文件不会成为跟写任务，只在最终快照完整一致后完成。兼容测试显式创建旧逐提交模式，并检查旧记录缺省模式恢复、主动合并保留所有已写文件与原始基准、未保存草稿不被自动保存，以及未知模式和非法合并进度被拒绝。合并范围允许非祖先的两个端点，逐提交模式保留原有祖先校验。

提交选择优先展示可直接点选的历史，手动输入位于末尾。原生命令测试覆盖说明、作者、日期和引用展示与筛选选项、加载更早记录后选择基准、直接选择结束点，以及全程不调用手动输入框的真实练习创建；同时保留手动输入和切换窗口不关闭的兼容检查。

`followGhost.test.ts` 覆盖差异规划、未保存输入、目标缓存与失效、读取错误及重试。用户截图证明 0.1.6 的单行装饰和 0.1.7 的代码透镜都不符合正文多行虚影需求；0.1.8 因此改为检查真实注册的内联提供器，不再断言错误的代码透镜交互。新增空文件多行正文、LF/CRLF、已有 import 后缀保护、先删除再插入、自动闭合、普通补全匹配与冲突、光标恢复、设置关闭、前缀模式、长行、分块上限及 Unicode/CRLF 边界检查。只在实际练习编辑器触发原生请求，不发送全局隐藏命令。差异定位使用 `diff`，保留行级与字符级超时及线性降级。

`followGhost.native.cjs` 是真实扩展宿主回归，不加入模拟 API 的 `*.test.ts` 套件。先运行 `npm run build:vscode`，再运行 `node tests/followGhost.native.cjs --prepare .validation/native-follow-<唯一名称>`，准备实际 Git 练习和独立 profile。启动 VS Code，分别传入 `--user-data-dir=<fixture>/profile`、`--extensions-dir=<fixture>/extensions`、`--extensionDevelopmentPath=<repo>/vscode`、`--extensionTestsPath=<repo>/tests/followGhost.native.cjs` 和 `<fixture>/practice`。测试通过实际跟写命令打开空文件和 import 文件，验证未提前写入答案、输入首行后继续提供原生建议、删除旧字再跟写、保存后完整快照可完成；结果写在 `<fixture>/result.json`。

原生验收另通过测试窗口的 Chromium 调试端口只读获取 DOM 布局和截图。若创建 `<fixture>/capture-enabled`，先运行 `node tests/followGhost.capture.mjs <fixture> <port>`（端口默认 9238），再启动使用该独立调试端口、测试 profile、扩展目录和 `.git/ai-diff-follow.code-workspace` 的测试实例；测试在各检查点写出 `capture-request.json` 并等待驱动写入 `captured-<name>`，缺少驱动会明确失败。检查器同时覆盖原生行内灰色节点和额外虚影行，断言新增 import 的整行或尚未输入部分与实际灰色文字精确相等，已有 `FishActivityInfo` 导入位于另一行且没有被染成虚影；只检查两行纵坐标不同无法发现共同前缀被拆分的问题。

整行插入必须避免把已有行及其相同前缀一并交给宿主重新计算字符差异。文件中间从上一行末尾的换行开始；文件首行前插入时先提示用户按 Enter，再把光标移回用户创建的空行。原生用例覆盖首次显示、首行 Enter 准备、逐字符 `imp`、接受候选和最终快照校验；单元测试另覆盖 LF/CRLF。按 Enter 是用户操作，扩展不能为了显示虚影直接修改文件或代写目标。

本机实际原生验收使用工作区内同版本 VS Code 1.138.0 的隔离运行副本，避免安装版的更新锁；仅该副本的发行目标设为 archive，保留原安装和更新锁，并因测试环境的渲染沙箱启动失败而只对隔离运行进程使用 `--no-sandbox`。使用内置语法与独立扩展目录，未验证用户现场的全部 AI 和 Java 语言扩展组合。

实际 VS Code 手工验收：从仓库 F5 启动扩展，选择跨多个提交的范围创建练习，确认侧栏只显示一个合并目标，文件列表只包含两端净变化；点击文件确认默认打开单个原生编辑器、自动定位差异且虚影直接来自结束提交，没有直接写入文件。删除标红旧内容并跟着虚影输入，确认提示逐步更新、普通补全与定义跳转仍可用；通过状态栏定位下一处，故意误改其他文件并确认不能完成，所有文件一致后一次完成，关闭后重开练习目录检查进度。另打开旧逐提交练习，保留未保存草稿后执行合并命令，确认草稿和已写内容保留、目标切至最终提交。原工作台另验收 AI 流式输出、取消、学习图谱及其布局 Worker。需要使用已配置的语言扩展和模型服务。
