# v8 Professional UI/UX Plan — Modbus Engineering Workbench

**Status:** canonical UI/UX design specification  
**Baseline:** v7 analyzer UI + v8 all-in-one Modbus workbench roadmap  
**Primary target:** Windows desktop engineering workstation, also usable in local browser  
**Design goal:** faster, safer and clearer than separate Modbus Poll / Modbus Slave / ModScan / ModSim style tools while preserving dense engineering workflows.

## 1. Product UX principles

1. **Engineering-first density, not consumer-app minimalism.** Tables may be dense, but hierarchy, alignment and state must remain clear.
2. **One application, clearly separated operating modes.** Passive Analyzer, Active Master, Slave Server, TCP Proxy, Discovery, Replay and Lab modes must never be visually confused.
3. **Safety is visible before action.** Any transmit/write/fault-injection action must expose channel, target, Unit/Slave, function, address and risk before execution.
4. **No hidden connection ownership.** Every physical/virtual connection shows exactly which workspace owns it and whether it can transmit.
5. **Keyboard and mouse parity.** Common field-engineering workflows must be fast without requiring drag/drop or repeated dialogs.
6. **Progressive disclosure.** Daily workflows remain simple; byte-order, TLS, flow control, raw PDU and diagnostic controls remain available without cluttering every screen.
7. **Evidence everywhere.** Reads/writes/tests/discovery actions can be traced back to raw traffic and timestamps.
8. **Large-data safe.** Tables virtualize, charts are bounded, logs stream, and UI never renders unbounded DOM rows.
9. **No color-only meaning.** Status text/iconography accompanies color.
10. **Stable spatial model.** Primary navigation, connection state and safety controls stay in consistent locations across workspaces.

## 2. Application shell

Use a desktop-workbench shell with five persistent regions:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ App bar: Project | Connection | Mode | Command palette | Global actions   │
├──────────────┬─────────────────────────────────────────┬───────────────────┤
│ Primary nav  │ Workspace / document area              │ Inspector         │
│              │                                         │ contextual        │
│ Connections  │ tabs / tables / charts / editors       │ details / actions │
│ Master       │                                         │                   │
│ Slave        │                                         │                   │
│ Analyzer     │                                         │                   │
│ Discovery    │                                         │                   │
│ Traffic      │                                         │                   │
│ Test Center  │                                         │                   │
│ Charts       │                                         │                   │
│ Automation   │                                         │                   │
│ HMI Builder  │                                         │                   │
│ Projects     │                                         │                   │
│ Reports      │                                         │                   │
├──────────────┴─────────────────────────────────────────┴───────────────────┤
│ Status bar: active channels | Tx/Rx | errors | capture | writes | clock   │
└────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 App bar

Persistent items:

- Product name and version.
- Active project selector.
- Active connection/channel selector.
- Current mode badge.
- Global Start/Stop/Pause state where applicable.
- Write-lock state.
- Capture state.
- Command palette button.
- Theme selector.
- Notifications/problems indicator.
- Help / protocol reference.

### 2.2 Primary navigation

Navigation order should follow engineering workflow:

1. Dashboard
2. Connections
3. Master
4. Slave Simulator
5. Analyzer
6. Discovery
7. Traffic
8. Register Lab
9. Test Center
10. Charts & Logger
11. Automation
12. HMI Builder
13. Intelligence
14. Projects
15. Reports
16. Settings

Allow compact icon-only mode, but default to icon + label.

### 2.3 Context inspector

A collapsible right inspector avoids modal overload. It shows details for the selected entity:

- connection properties;
- poll job settings;
- selected register engineering metadata;
- raw transaction decode;
- simulator point properties;
- assertion result;
- chart series configuration;
- HMI widget properties.

The inspector must preserve unsaved state warnings and support keyboard focus.

### 2.4 Bottom status bar

Always visible on desktop:

- active connection count;
- active Master jobs;
- active Slave servers;
- current Rx/s and Tx/s;
- timeout/error counters;
- capture recording state;
- write lock (`LOCKED`, `ENABLED`, countdown if timed);
- current project dirty/saved state;
- local time / capture time in replay.

## 3. Visual design system

### 3.1 Themes

Support `System`, `Light`, `Dark`. Extend the current v7 semantic-token model rather than introducing page-specific colors.

Core tokens:

- app/sidebar/surface/elevated/input backgrounds;
- primary/secondary/muted text;
- border/subtle-border/focus;
- accent/info/success/warning/danger;
- passive/active/server/proxy/replay/lab mode colors;
- read/write traffic colors;
- chart grid/axis/series palette;
- selected/hover/edited/conflict states.

### 3.2 Density

Offer `Comfortable`, `Compact`, `Dense` table density. Dense is recommended for register and traffic workspaces.

Minimum desktop assumptions:

- 1366×768 supported;
- 1920×1080 optimized;
- high-DPI/Retina aware;
- narrow browser windows collapse inspector first, then labels.

### 3.3 Typography

- UI font: readable system sans-serif.
- Protocol/raw/register numeric columns: tabular numerals.
- HEX/ASCII/raw PDU: monospace.
- Avoid tiny text; dense tables reduce padding rather than font size excessively.

### 3.4 Status language

Every channel has one explicit mode label:

- `PASSIVE ANALYZER`
- `MASTER ACTIVE`
- `SLAVE SERVER`
- `TCP PROXY`
- `ACTIVE DISCOVERY`
- `REPLAY`
- `OFFLINE CAPTURE`
- `LAB TEST`
- `FAULT INJECTION`

Never show `RX ONLY` while a channel is capable of transmitting.

## 4. Connection Center

Connections become first-class objects and the starting point for Master/Slave/Test workflows.

### 4.1 Main layout

Left: connection profiles/groups.  
Center: connection cards/table.  
Right inspector: exact configuration and diagnostics.

Each connection card shows:

- friendly name;
- transport;
- COM or local/remote endpoint;
- serial framing / TLS state;
- owner mode;
- connected/listening/error state;
- Rx/Tx counters;
- last activity;
- write permission;
- quick Open Traffic action.

### 4.2 Connection wizard

Stepper:

1. Role: Master / Slave / Passive Analyzer / Proxy / Lab.
2. Transport: RTU / ASCII / TCP / UDP / TLS / tunnel.
3. Interface/endpoint.
4. Protocol framing/options.
5. Timeouts/reconnect.
6. Safety/write policy.
7. Test connection.
8. Save profile/start.

Advanced serial settings remain collapsed unless selected.

### 4.3 Ownership conflict UX

If COM7 is owned by Passive Analyzer, trying to start Master on COM7 must show:

- current owner;
- why simultaneous access is unsafe/impossible;
- actions: Cancel / Stop current owner and switch;
- never silently stop or steal the port.

## 5. Dashboard

Dashboard must answer four questions quickly: What is running? Is it healthy? Is anything transmitting? What needs attention?

Top KPIs:

- active channels;
- confirmed devices;
- active Master jobs;
- active Slave devices;
- traffic rate;
- timeouts/exceptions;
- write count since start;
- problems requiring attention.

Main panels:

- bounded Traffic Activity chart;
- channel health cards;
- current mode/ownership summary;
- recent writes;
- recent errors/timeouts;
- active tests/recipes;
- recent discoveries;
- quick resume recent project.

Dashboard filters: `All`, transport, channel, mode.

## 6. Master workspace

### 6.1 Document model

Master uses tabbed **Poll Documents**. Each document can contain one or more jobs sharing a logical task. Avoid legacy MDI windows while retaining multi-document behavior.

Document header:

- name;
- connection;
- run/pause/stop;
- cycle status;
- write-lock state;
- error policy;
- logging state.

### 6.2 Poll jobs grid

Columns:

- enabled;
- Unit/Slave ID;
- FC;
- start address;
- quantity;
- interval;
- timeout;
- retries;
- state;
- last RTT;
- success/error count;
- last value/update.

Support inline editing, multi-select enable/disable, duplicate job, drag reorder for explicit serial order, and scheduler mode for automatic fair scheduling.

### 6.3 Register result grid

Frozen identity columns followed by values. User-selectable representations:

- raw decimal;
- signed/unsigned;
- hex;
- binary;
- ASCII;
- float/int 32/64;
- engineering scaled;
- enums/bitfields.

Cells indicate:

- changed since previous read;
- stale;
- write pending;
- write confirmed;
- exception/error;
- threshold warning.

### 6.4 Write flow

Single register/coil:

1. Select cell/action.
2. Write drawer opens with current raw + engineering value.
3. Enter new value using chosen format.
4. Show encoded raw payload and target.
5. Confirm.
6. Execute.
7. Optional read-back verify.
8. Show success/mismatch and audit link.

Multi-write adds stronger confirmation with range and quantity. Broadcast write requires explicit phrase/checkbox and shows `NO RESPONSE EXPECTED`.

### 6.5 Master quick actions

- Read now.
- Pause/resume selected job.
- Scan Unit IDs.
- Scan addresses.
- Open selected transaction in Traffic.
- Add selected values to Chart.
- Start logger.
- Convert selected job to Test Recipe step.
- Save as template/profile.

## 7. Slave Simulator workspace

Three-pane model:

- left: virtual devices tree;
- center: memory/register editor;
- right: selected device/point/generator properties.

### 7.1 Device tree

```text
TCP Server A
  Unit 1 — Energy Meter
    Coils
    Discrete Inputs
    Holding Registers
    Input Registers
  Unit 2 — Inverter
Serial RTU Server B
  Slave 5 — Generator Controller
```

Show client count, request rate and last request per server/device.

### 7.2 Memory editor

Spreadsheet-like grid with:

- address;
- name;
- raw value;
- engineering value;
- type/order;
- access;
- generator;
- last write/source;
- quality/state.

Bulk paste/import, fill range, increment addresses, copy blocks and CSV/XLSX mapping import are essential.

### 7.3 Simulator runtime controls

- Start/Stop server.
- Freeze dynamic generators.
- Reset values.
- Reset counters.
- Open live requests.
- Client sessions.
- Fault injection master switch.

Fault injection always opens a warning banner and uses visually distinct LAB styling.

## 8. Analyzer workspace

Preserve v7 strengths but reorganize into professional sub-tabs:

- Overview;
- Devices;
- Polling;
- Timing;
- Errors;
- Register map;
- Topology;
- Findings.

Keep passive safety state prominent and provide one-click cross-navigation to Traffic/Register Lab/Discovery.

## 9. Discovery workspace

Two clearly separated zones:

### Passive Discovery

Always safe while capture runs. Shows observed channels, devices, FCs, register blocks, identity evidence and first/last seen.

### Active Discovery

Separate card with stronger visual boundary. Wizard shows:

- connection;
- Unit range;
- FC43-first strategy;
- optional address scan;
- timeout/rate;
- estimated request count/duration;
- RTU exclusive-bus confirmations;
- Start/Cancel.

Progress view shows responding/silent/exception addresses without turning silence into a false confirmed device.

## 10. Unified Traffic workspace

Traffic is the universal evidence timeline for every mode.

### 10.1 Table columns

- timestamp;
- channel;
- source mode;
- direction;
- Unit/Slave;
- FC;
- address/quantity;
- TID;
- RTT;
- status;
- summary;
- raw length.

### 10.2 Detail inspector

Tabs:

- Decoded;
- Raw HEX;
- ASCII;
- Request/Response pair;
- Timing;
- Engineering mapping;
- Related test/write/discovery evidence.

### 10.3 Traffic tools

- live/frozen;
- clear view without deleting capture;
- filters;
- full-text/raw-hex search;
- bookmarked frames;
- copy as HEX/PDU/JSON;
- export selection;
- stop on exception/timeout/assertion/write;
- jump to previous/next error.

Use virtualization and a bounded in-memory view while capture persists separately.

## 11. Register Lab

Register Lab is the common data-inspection/editing environment independent of whether values came from Master, Analyzer, Capture or Simulator.

Split view:

- left: register list/table;
- center: interpretation matrix;
- right: engineering definition.

Interpretation matrix can display candidate values for ABCD/BADC/CDAB/DCBA and 64-bit permutations side-by-side with confidence where analyzer intelligence exists.

Support:

- scale/offset;
- two-point scaling;
- units;
- precision;
- enum editor;
- bitfield editor;
- min/max;
- conditional formatting;
- notes/source/provenance;
- save to project profile.

Writes are exposed only if the selected source is an active Master connection with write permission.

## 12. Test Center

Two sub-workspaces: **Raw Frame Studio** and **Recipe Runner**.

### 12.1 Raw Frame Studio

Professional packet editor layout:

- connection selector;
- transport/framing;
- HEX editor;
- decoded structure beside it;
- auto CRC/LRC/MBAP switches;
- send once/repeat;
- expected response;
- compare mask;
- save template.

Show exact outgoing bytes before Send.

### 12.2 Recipe Runner

Left: recipe tree/steps.  
Center: editor.  
Right: variables/assertions/properties.  
Bottom: execution console.

Execution state per step:

- pending;
- running;
- pass;
- fail;
- skipped;
- cancelled.

Top controls: Validate, Dry Run where possible, Run, Pause, Stop, Repeat count, Evidence capture.

Recipe failures link directly to Tx/Rx traffic and assertion details.

## 13. Charts & Logger

### 13.1 Chart workspace

Chart documents are tabbed and saveable to project.

Features:

- multiple series;
- left/right axes;
- per-series unit/scale;
- legend visibility;
- zoom/pan;
- cursor/crosshair;
- markers for writes/errors/timeouts/test events;
- current/min/max/avg;
- rolling/fixed window;
- pause/autopan;
- PNG/CSV export.

Never allow chart canvas to control page layout height. Use bounded containers and virtualized/decimated data for long sessions.

### 13.2 Logger setup

Wizard:

1. choose tags/registers;
2. trigger: every sample / fixed period / change-only;
3. include quality/errors;
4. storage: CSV/TSV/JSONL/SQLite;
5. rotation/retention;
6. output folder;
7. preview columns;
8. start.

Show disk usage and dropped-write/storage errors prominently.

## 14. Automation workspace

Sections:

- API explorer;
- WebSocket event viewer;
- CLI command builder;
- JavaScript examples;
- Python examples;
- scheduled recipes/tasks;
- API token/local-access policy if remote automation is later enabled.

Provide generated examples based on the selected connection/job instead of generic documentation only.

## 15. HMI Builder

Low priority but design now to avoid future architecture conflict.

Builder layout:

- widget palette left;
- canvas center;
- property/binding inspector right;
- layer/page tree;
- preview/run toggle.

Widgets:

- numeric display/input;
- lamp/switch;
- bar/gauge;
- trend;
- text/state;
- image;
- bitfield panel;
- button/recipe trigger.

Every write widget uses central write-lock/audit service; no widget may implement its own direct Modbus write path.

## 16. Projects and workspace persistence

Project home should show:

- site/customer metadata;
- connections;
- master documents;
- slave models;
- profiles/maps;
- recipes;
- charts/loggers;
- HMI screens;
- captures;
- discovery evidence;
- reports;
- recent activity.

Support project templates and `Save As`. Show unsaved/dirty state at shell level.

Autosave is allowed for safe metadata but never silently commits dangerous runtime actions such as enabling writes or starting servers.

## 17. Reports workspace

Report center cards:

- Engineering Handover;
- Test Report;
- Traffic/Capture Export;
- Master Poll Summary;
- Slave Simulation Model;
- Discovery Report;
- Write Audit;
- Historian Export;
- Project Backup.

Each report shows scope, included evidence, output format and timestamp. Preview before generating long PDFs when practical.

## 18. Settings architecture

Settings categories:

- Appearance & density;
- Address notation;
- Default timeouts/retries;
- Serial defaults;
- TCP/UDP defaults;
- TLS certificates;
- Capture/history/storage;
- Logging;
- Write safety;
- Keyboard shortcuts;
- Accessibility;
- Automation/API;
- Updates/diagnostics.

Dangerous global defaults must explain their effect and avoid silently changing already-running channels.

## 19. Keyboard and command workflow

Required global shortcuts:

- `Ctrl+K` command palette;
- `Ctrl+P` quick open project/document;
- `Ctrl+Shift+P` command search if needed;
- `Ctrl+F` workspace search;
- `F5` read/run selected safe action contextually;
- `Shift+F5` stop selected running task;
- `Ctrl+L` focus connection selector;
- `Ctrl+T` open Traffic;
- `Ctrl+S` save project/document;
- `Ctrl+Shift+E` export selected evidence.

Write shortcuts must never execute immediately without the same safety policy as mouse actions.

## 20. Notifications, problems and errors

Use three mechanisms, not one generic toast:

- **Toast:** short success/info confirmation.
- **Problems panel:** persistent errors/warnings requiring investigation.
- **Blocking dialog/drawer:** destructive or safety-critical confirmation.

Every technical error should expose:

- human summary;
- affected channel/device;
- timestamp;
- actionable suggestion;
- expandable technical details/error code;
- link to relevant traffic/log where available.

Avoid alert spam by grouping repeated identical errors with counts.

## 21. Safety UX specification

### Write lock

Global shell always exposes current write state. Write permission is scoped per active connection and never inherited by a newly created connection.

Recommended states:

- `WRITES LOCKED`;
- `WRITES ENABLED`;
- `WRITES ENABLED · 04:32` timed expiry;
- `BROADCAST ARMED` temporary special state.

### Production vs Lab

Fault injection/raw malformed-frame functions require LAB mode. Production TCP proxy and passive analyzer must not expose them as one-click actions.

### Replay/offline

Replay data uses a strong `REPLAY` banner and disables physical writes even if a project previously had write permission.

## 22. Accessibility and internationalization

- WCAG-style usable contrast for normal/muted/status text.
- Visible focus rings.
- Semantic form labels and table headers.
- Keyboard access to dialogs, grids and inspectors.
- Screen-reader labels for status icons.
- Reduced-motion preference respected.
- Never use color as sole error/state signal.
- Keep UI strings centralized to permit future localization; engineering identifiers/units remain unchanged.

## 23. Performance UX budgets

Targets for a typical engineering workstation:

- shell navigation response <100 ms for already-loaded pages;
- scrolling 10k+ register/traffic rows remains smooth via virtualization;
- live table visual updates throttled/batched without losing captured data;
- no more than bounded chart points rendered per series; decimate historical display;
- heavy export/import/scan operations run as cancellable background jobs;
- visible progress for operations >500 ms;
- UI remains responsive during capture, logging and report generation.

## 24. Professional acceptance scenarios

UI is not complete until automated/manual scenarios cover:

1. Engineer creates RTU Master, polls two slaves and charts selected registers.
2. Engineer enables writes, performs FC06, verifies readback, then lock expires.
3. Engineer runs TCP Master and TCP Slave simulator in one project on different endpoints.
4. Engineer imports capture, creates simulator profile and runs PLC/HMI against it.
5. Engineer filters 100k+ traffic events without freezing the UI.
6. Engineer uses Light/Dark/System themes and dense register layout at 1366×768 and 1920×1080.
7. Engineer intentionally tries to start Master on a COM port already owned by Passive Analyzer and receives a clear ownership conflict.
8. Engineer runs active RTU discovery and must satisfy maintenance/exclusive-bus interlock.
9. Engineer runs recipe with writes/assertions and exports traceable pass/fail evidence.
10. Engineer enables fault injection and sees unmistakable LAB state.
11. Engineer restarts app/project and all documents/layouts restore safely without re-enabling writes or automatically starting dangerous modes.
12. Keyboard-only user can create/select connection, run read-only job, inspect traffic and export results.

## 25. Implementation order for UI

Do not redesign every page before protocol engines exist. Build the shell/design system first, then vertical slices:

1. Design tokens + shell + navigation + inspector + status bar.
2. Connection Center and connection ownership UI.
3. Master MVP vertical slice (TCP first plus virtual transport).
4. Slave Simulator MVP vertical slice.
5. Unified Traffic and Register Lab integration.
6. RTU Master/Slave and serial safety UX.
7. Test Center/Recipe Runner.
8. Charts/Logger/Historian.
9. Discovery/Analyzer migration into new shell.
10. TLS/UDP/tunnelling configuration UX.
11. Automation workspace.
12. HMI Builder.
13. Full accessibility/performance/polish pass.

## Final UX direction

v8 should feel like an industrial engineering IDE rather than a collection of unrelated pages. Connections are first-class, active modes are unmistakable, every Tx/write is traceable, dense data is fast to inspect, and Master/Slave/Analyzer/Test workflows share one visual language and one safety model.