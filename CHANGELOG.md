# SWITCH changelog

## Release 2: experience upgrade (23 Oct 2026, evening)

Baseline: `SWITCH_FINAL_SUBMISSION_READY_TERRACOTTA_SKY_BG.zip`. That ZIP was release 1 plus your theme toggle and the
terracotta light theme; both are preserved unchanged.

### Assistant (highest priority)
- **Root cause of the raw JSON on screen:**
  - The panel offered "Show tool result", which printed the whole MCP response with `JSON.stringify`.
  - Read-only tools had no `say` text, so the backend's `content[0].text` fell back to `json.dumps(result)` and that
    reached the chat bubble.
  - Both paths are removed.
- **New architecture** (interpretation kept separate from execution and from presentation):
  - `src/assistant/assistant.js`: deterministic intent router (18 intents, including draft, clarify, confirm, cancel,
    diff, replay, explain failure, repair, report, approve, reject, saved rules, routines, status, reset, navigate and
    help), candidate resolution ("it" means the conversation focus, then the UI selection, then the newest pending
    change), and typed view models (`toCard`) for every tool result.
  - `src/assistant/session.js`: conversation engine with context tracking:
    - Tracks the draft, requirement, focused candidate, latest run and latest failing run.
    - Explicit pending confirmations; a bare "yes" with nothing pending does nothing.
    - Before replay, repair or approval it refreshes candidate state from the backend.
    - Approval is never offered for an unchecked or failing candidate.
    - Duplicate sends are blocked while busy.
    - Offline and network errors become error cards with **Retry**, which reconnects first.
    - Conversation history survives closing and reopening the panel.
  - `src/ui/AlexaPanel.jsx` (rewritten): renders the cards for draft, clarification (answer chips re-interpret with the
    chosen device), saved requirement, requirement list, routines, diff (with a step diff), replay verdict, failure
    explanation (expected vs observed, trace events, link to the evidence timeline), proposed repair (before/after
    diff, NOT VERIFIED), decision (Deployed: No), integration status and error. "Technical details" is a readable
    key/value list, never JSON. Also adds a typing indicator, Enter-to-send, Escape to close and a Clear button.
- **Backend** (`app/alexa_adapter.py`, additive):
  - Every tool now returns human `say` text, and `content[0].text` is never serialized JSON.
  - New read-only tool `switch_list_requirements`.
  - `switch_list_routines` reports each candidate's latest full run.
  - `switch_get_replay_report` adds `failure_details` (requirement title, expected behaviour, trace events).
  - The preview and repair tools return before/after routines for a readable diff.

### Landing page
- `src/landing/Landing.jsx` and `TypewriterWordmark.jsx`:
  - Giant SWITCH wordmark typed S→W→I→T→C→H with a natural rhythm and a blinking cursor.
  - No layout shift (all letters are laid out from the first frame); `aria-label="SWITCH"`; runs once per page load.
  - Reduced motion shows the full word immediately.
- Headline, supporting copy and two working CTAs:
  - **Explore Your Home** opens Home Overview.
  - **Talk to SWITCH** opens the app with the assistant.
- Below the hero: a live 3D villa preview (the real `HouseViewer`, loaded only when scrolled into view), the 9-step
  verification workflow and a final CTA.
- The landing shows when the URL has no page hash (or `#/welcome`). The sidebar logo returns to it.

### React Bits Orb
- `src/components/reactbits/Orb/`: upstream React Bits Orb (JS + CSS, commit e12c221), licence included. Minimal,
  documented changes:
  - an `onStatus` callback;
  - `React` imported for this project's classic JSX runtime;
  - deferred context release so React StrictMode's dev remount doesn't reuse a lost WebGL context.
- Used with `colors={['#9c43fe','#4cc2e9','#101499']}`, `hoverIntensity`, `trail`, `rotateOnHover`, `followCursor` and
  click pulse. The SWITCH logo sits at its centre. It is paused under reduced motion, and the component itself pauses
  off-screen and in hidden tabs. An error boundary plus an honest CSS fallback ("WebGL2 isn't available here") covers
  failure.

### Brand
- `public/brand/switch-logo.png` (+96 px): the S-sphere logo cut from the supplied intro video's final frame. It is
  used on the landing page, the sidebar and the favicon.

### Floating dock
- `src/ui/Dock.jsx` has 10 working items: Home, Search (focuses the command search), Assistant, Routines/Replay Lab,
  House view, Saved Requirements (draft badge), Reports, Notifications (alert badge; opens the alerts popover), Theme
  and Settings.
- Frosted glass, hover magnification, activation bounce, tooltips, active-page dots, ←/→/Home/End keyboard navigation
  and reduced-motion support.
- On phones it becomes a compact full-width bar. It hides in 3D fullscreen and moves aside when the assistant drawer is
  open on desktop.

### Other
- Backend CORS now allows any loopback port (`localhost` / `127.0.0.1`), so the app works when Vite picks :5174. `GET /` describes the API instead of returning 404. Covered by a test.
- `start-switch.bat` / `.ps1` fall back to `python` when the `py` launcher is missing.
- Readable AC step text (no JSON in diffs).
- The top-bar assistant button is now "Assistant · simulated Alexa+".
- Docs: `docs/JUDGE_WALKTHROUGH.md`, `docs/TROUBLESHOOTING.md`, README Windows step-by-step and an updated
  `FINAL_SUBMISSION_STATUS.md`.

### Tests
- `tests/assistant.test.mjs` (9 tests, part of `npm test`): routing, view-model safety, offline and network failure,
  approval gates, duplicate-send guard, explicit confirmation, and the whole spoken journey against a real backend
  process.
- pytest: 2 new adapter tests (no JSON in tool text; failure and repair evidence).
- `tools/e2e_journey.mjs`: landing (typewriter, no layout shift, cursor, Orb, themes, phone, both CTAs, reduced
  motion), the assistant journey from the dock (including outage → honest error → Retry after restore), dock
  destinations and keyboard.

## Release 1: final submission integration (23 Oct 2026)
See `FINAL_SUBMISSION_STATUS.md` §2–§8 (build and Replay Lab fixes, canonical contract, Person 2 ↔ Person 3C
reconciliation, Route C adapter, canonical workflow in the UI, reports, accessibility).
