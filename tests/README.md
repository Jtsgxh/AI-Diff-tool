# Learn graph performance regression

Run the scheduler tests:

```sh
node --import tsx --test tests/graphFrameScheduler.test.ts tests/learnCommunityLayout.test.ts
```

For real canvas/React checks, run `npm run client` and open
`http://localhost:5173/tests/learn-graph-performance.html` (use the configured client port if different).
This fixture uses 2,400 synthetic class nodes, 14,400 directed edges and 24 communities.
It imports the production component, runs in React StrictMode, and updates its parent every 500ms
like a streaming workbench. It does not load a repository, call the backend or request AI analysis.

1. Switch to **丰富**, then click
   **采样 2 秒**. `draws`, `curves`, `callbacks` and `callbackMs` should all be zero while idle.
   The community layout is immediately drawable: there is no multi-frame physics simulation.
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
   animation frames. A second click on the already-active mode should draw nothing. Returning to
   rich mode should reproduce the same first-node position. Resizing the pane should not discard
   either mode's stored community arrangement.
8. After visiting both modes, click **更新图数据** and switch modes again. Select the first class:
   its updated label (`UpdatedService0`), degree (42) and community must be used even though its ID
   is unchanged. This checks that cached layouts cannot survive a source-graph update.

The fixture is a separate development entry point and is not included in the production bundle.
