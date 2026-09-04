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
