# SWITCH: judge demonstration walkthrough (about 2 minutes)

Everything shown is a **SIMULATED DEMO**: a modeled household, a deterministic simulator and an in-app Alexa+-style
assistant. Nothing is connected to Amazon, an Alexa account or physical devices.

**Before you start:** run `start-switch.bat` (Windows) or `./start-switch.sh` (macOS/Linux) and open
**http://127.0.0.1:5173**. To restart the story, say "Reset the demo" to the assistant (then "yes"), or use
**Settings → Reset demo**.

| Time | What to do | What to point out |
|---|---|---|
| 0–10 s | Open the app. The landing page types **SWITCH** letter by letter. | The SWITCH logo sits inside the React Bits Orb. Move the cursor over the orb (it follows) and click it (pulse). Note the SIMULATED DEMO badge and "Backend connected". |
| 10–15 s | Click **Talk to SWITCH**. | The app opens on Home Overview with the assistant drawer, and the floating dock is at the bottom. |
| 15–30 s | Type: *Don't turn off the hallway light while someone is there.* | A **Draft rule** card appears: the human-readable rule, its condition and its expected behaviour. It is marked "DRAFT · not enforced". |
| 30–40 s | *Yes, save it as a rule* | The **Requirement saved** card shows the ID, version 1 and CONFIRMED status. This is the same record shown under Saved Requirements (dock → list icon). |
| 40–50 s | *What changed in Goodnight?* | A step-by-step diff of Goodnight v1 → v2. The hallway occupancy guard was removed, and the card lists the rules this change can affect. |
| 50–60 s | *Check it* | A deterministic replay run: **FAIL**, PASS 4 / FAIL 1, the failing rule and evidence event `E0006`. |
| 60–70 s | *Why did it fail?* | Expected "hallway lights must not be set to off"; observed the light set ON → OFF at 22:30 while the hallway was occupied. **Open the evidence timeline** jumps to Replay Lab, where the 3D villa highlights the hallway light. |
| 70–80 s | *Approve it* | It refuses: the latest check is FAIL. |
| 80–90 s | *Fix it* | A **Proposed repair** card with a before/after diff restoring the guard, marked **NOT VERIFIED**. |
| 90–100 s | *Run the checks again* | **PASS 5 / FAIL 0**, a new run ID. |
| 100–110 s | *Approve it* → **Yes** | **Decision recorded: APPROVED**. Deployed: No. "Nothing was deployed to any device." |
| 110–120 s | *Are you connected to my Alexa?* | Honest status: backend connected; Alexa+ SIMULATED DEMO, not connected to Amazon; physical devices not connected; no AI model configured (deterministic rules). Finish on **Reports** (dock) to show the run, versions, evidence and decision. |

**Closing line:** "SWITCH remembers the corrections you confirm, and checks them again whenever a routine changes.
Today it runs in a deterministic simulated home; a live Alexa+ connection is not configured."

**Optional extras:**
- Theme toggle (sun/moon in the dock or the top bar).
- Walk mode in the 3D villa.
- Reports → Export JSON / Markdown.
- Ask the assistant "Show my saved rules" or "Open Replay Lab".
