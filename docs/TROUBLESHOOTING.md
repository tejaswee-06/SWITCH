# SWITCH: integration troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Top bar shows **Backend offline · local fallback**; the assistant says the backend is offline | The FastAPI backend isn't running on port 8000, or the browser can't reach it | Start it with `start-switch.bat` / `./start-switch.sh`, or manually (`cd switch_backend`, `.venv\Scripts\python -m app` on Windows, `.venv/bin/python -m app` elsewhere). Check that http://127.0.0.1:8000/health returns `"status":"ok"`, then click the ↻ on the engine chip or press **Retry** in the assistant. |
| Backend is running but the app still shows offline | The app is on an origin the backend does not allow. Release 2 allows any `localhost` / `127.0.0.1` port (e.g. Vite moving to :5174); other hosts are refused | Open the app on http://127.0.0.1:5173 (`npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`). For a different host, set `SWITCH_CORS_ORIGINS` (comma-separated) before starting the backend. |
| The app talks to the wrong API | `VITE_SWITCH_API_URL` points elsewhere | Copy `.env.example` to `.env.local`, set `VITE_SWITCH_API_URL=http://127.0.0.1:8000`, then restart `npm run dev`. |
| Assistant: "That did not go through … not allowed in this household" | The token's role can't perform the action (approve / confirm need the owner) | The default demo token is the owner (`demo-owner-token`, demo only). Don't change `VITE_SWITCH_DEMO_TOKEN` unless you are testing roles. |
| Assistant: "I can't ask you to approve … latest check is FAIL" | Approval gate: only a candidate whose latest full replay PASSes can be approved | Say "Fix it", then "Run the checks again", then "Approve it". |
| Assistant: "Something changed since the last check" | A requirement or scenario changed after the last replay (stale run) | Say "Run the checks again". |
| `/demo/reset` returns 404 | The backend isn't in demo mode | Start with `SWITCH_ENV=demo` (the launchers and `python -m app` set it by default). |
| `pip install` fails on scikit-learn / NumPy | Python older than 3.11 | Install Python 3.13 (recommended) or 3.11+, delete `switch_backend/.venv` and rerun the launcher. |
| Landing orb shows "WebGL2 isn't available here" | The browser or GPU has no WebGL2 (some VMs, remote desktops or locked-down browsers) | The rest of the app works. Enable hardware acceleration, or use a current Chrome / Edge / Firefox. |
| 3D villa is slow | Software rendering (no GPU) | Settings → graphics quality "Low", or turn on reduced motion. The viewer pauses when off-screen. |
| http://127.0.0.1:8000 shows a JSON page | That address is the API, not the app | Open the app at http://127.0.0.1:5173. |
| Port 5173 or 8000 already in use | Another dev server is running | Close it. Any other local port (e.g. `npm run dev -- --port 5174`) also works with release 2. |
| Windows: `py` not found | Python launcher not installed | Install Python from python.org with "Add to PATH" and the "py launcher" ticked. |
| Start the story again | — | Ask the assistant "Reset the demo" (confirm with "yes"), or use Settings → Reset demo. |

**Health endpoints:**
- `GET /health`: backend, persistence, simulator version, interpreter mode and Alexa+ route (always SIMULATED DEMO).
- `GET /integrations/alexa/status`: the simulated adapter's status and the blockers to a live Alexa+ connection.
- `POST /integrations/alexa/test`: a harmless self-test of the adapter. It contacts no Amazon endpoint.
