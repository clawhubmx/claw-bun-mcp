# Live staging1 incomplete-reply probe

- **Tab**: 8922 (logged-in Notion AI; also created tab 74aa at /ai)
- **Helpers**: v36
- **Identical-stuck repro**: 0/3 standard JSON stress prompts

## Standard full-wait results (production runner)
### p02-json-guard
- pass=True identicalStuck=False issues=[]
- submit: error=None answerLen=549 hash=`1335c17db98b19d7` looksFinal=True helpers=36
- polls executed: 0 (none required — completed on submit)
- preview: {"name":"Vespera Nix","mass_earth":1.34,"moon_count":2,"atmosphere":"Nitrogen-oxygen with high-altitude noctilucent ice 

### p03-streaming-stress
- pass=True identicalStuck=False issues=[]
- submit: error=None answerLen=3151 hash=`4254801c72d8584f` looksFinal=True helpers=36
- polls executed: 0 (none required — completed on submit)
- preview: {"query":"Fed interest rate decision June 2026","time_period":"2026-06-09T00:00:00Z/2026-06-15T23:59:59Z","unique_topics

### p05-preamble-edge
- pass=True identicalStuck=False issues=[]
- submit: error=None answerLen=233 hash=`be82256d019d92be` looksFinal=True helpers=36
- polls executed: 0 (none required — completed on submit)
- preview: {"probe":"preamble","ok":true,"note":"edge-case"}

## Fourth prompt (short-wait stress)
- Planned: **p02-json-guard-short-wait** (3s submit + 3× waitOnly @ 30s)
- Not successfully recorded end-to-end; see JSON `fourthPromptNote` / `shortSubmitWaitOnlyAttempts`.

## Skipped
- p01-control, p04-prose-control (per JSON stress focus)