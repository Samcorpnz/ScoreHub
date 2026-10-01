# Runbook: switching to manual control on bridge/hardware failure

**Audience:** venue operators running the control panel during a live match.
**When to use this:** the Saturn/Vega console, serial cable, or the bridge
laptop itself stops working mid-match.

You do **not** need to restart anything or wait for IT. The control panel
can take over scoring on the same match instantly — the relay does not
care whether updates come from the bridge or from a human.

## 1. Recognize the failure

Look at the connection badge on the control panel ([ConnectionBadge](../../frontend/app/components/ConnectionBadge.tsx)),
top of the page. It tells you *what* has failed:

| Badge | Meaning | What to do |
|---|---|---|
| 🟡 **FEED STALE** | The bridge is still connected to the relay, but no hardware update has arrived in 8+ seconds. The Saturn/Vega console or serial cable has likely stopped sending data. | Go to step 2. |
| 🔴 **OFFLINE** (briefly) | The relay connection itself dropped. Normally recovers on its own within ~5 seconds (this is the automatic multi-region failover, not a venue-side problem). | Wait 5–10 seconds. If it doesn't clear, go to step 2 anyway — manual control still works while OFFLINE locally reconnects. |
| 🔴 **RELAY UNREACHABLE** | The relay has been unreachable for over a minute — a genuine outage, not a blip. | Go to step 2. Note the time for the incident report (step 5). |

If none of these are showing and the score just looks wrong or frozen, the
hardware feed may have failed silently — don't wait for a badge before
acting if the score clearly isn't updating with real play.

## 2. Take over scoring manually

Nothing needs to be toggled "into" manual mode — just use the controls:

- **Score**: use the `+1`/`+5` (or sport-specific) buttons next to each team.
- **Clock**: press **Start/Pause** to take control of the game clock, then
  use the quick-adjust buttons or the MM:SS input to correct the time if
  the hardware left it wrong.
- **Period/quarter**: edit directly in the period field.
- **Possession**: use the home/visitor/none toggle if your sport tracks it.

These are the exact same controls you'd use normally — there is nothing
hardware-specific about them. The display screens and any broadcast
overlay update from these the same way they would from the bridge.

**Do not press "Reset Match."** It zeroes both scores and cannot be
undone from the UI. Use it only if you are deliberately starting a new
match, never to "fix" a failover.

## 3. Why it's safe to take over mid-match

The relay accepts whichever update has the higher sequence number,
regardless of source. Every manual edit you make advances that number, so:

- The current score/clock at the moment of failure is preserved — you're
  correcting from where it stopped, not resetting.
- If the bridge unexpectedly reconnects while you're mid-correction, its
  next update will be rejected automatically (it doesn't know about your
  edits, so its sequence number is behind) — it will not silently
  overwrite what you've entered.

## 4. Handing back to the bridge

Once the hardware/bridge issue is fixed:

1. Confirm the bridge UI on the venue laptop shows **Running** with a
   live relay connection (not just "started" — check the relay badge in
   that UI too).
2. Watch the control panel for one real scoring event to confirm the
   bridge's updates are landing correctly before you stop touching the
   manual controls. On reconnect, the bridge picks up the relay's current
   sequence number automatically, so its very next hardware update should
   land — you don't need to wait for several events "to catch up."
3. Stop making manual edits once you've confirmed it — there's no
   "switch back" action needed, you just stop and let the bridge resume.

If you make a manual edit *after* the bridge has already reconnected (for
example, a one-off correction), that's fine — the same automatic resync
applies next time the bridge sends an update. The one case this doesn't
cover: a bridge running software from before this fix was deployed will
not resync and can stay silently locked out for the rest of the match —
if step 2 doesn't show a real scoring event landing within a few seconds
of reconnecting, stay on manual control for the rest of the match and
flag it in the incident note (step 5) so engineering can check the
bridge's version.

## 5. Who to notify

- Note the approximate time the failure started and was resolved.
- Notify whoever owns the venue/event relationship (so they're aware if a
  broadcast viewer or remote stakeholder noticed a glitch).
- If the cause was a relay outage (RELAY UNREACHABLE) rather than venue
  hardware, also flag it so the engineering side can check Sentry/Fly.io
  logs for the underlying cause.

---

**Acceptance test for this runbook (SA-59):** a simulated bridge
disconnect mid-match, performed by someone unfamiliar with the codebase
using only this document, with no score/clock data lost during the
switch to manual. This has not yet been rehearsed — see the open task in
SA-59.
