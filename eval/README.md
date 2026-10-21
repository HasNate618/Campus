# eval/

A harness for measuring what Campus retrieval and answers actually do, so the
numbers in the README can be produced rather than guessed.

```bash
make eval                                    # retrieval on the demo course
make eval EVAL_QUESTIONS=eval/questions.local.yaml
python eval/run.py --no-answer               # retrieval only, never call a model
```

## What it measures

**Retrieval** runs every question in each mode the config supports (lexical
always; semantic when `embed_model` is set; hybrid when a rerank model is too)
and reports hit@1, hit@5 and MRR against `expected.files`. Each mode runs twice,
with the exact-phrase `instr()` promotion on and off, so the boost has to earn
its place in the results instead of being assumed useful.

**Answers** run only when an LLM endpoint is configured. Each question goes
through the real agent turn (`agent.chat.run_turn`), recording whether a
citation matched the expected file (and page, when given), whether the
`answer_contains` strings appeared, the tool-call count, wall-clock latency, and
token usage. Answer text is never written to the results file, because an answer
quotes course content.

**Cost** comes from `eval/prices.yaml` (gitignored). With no entry for the
model, the run reports tokens and says cost was not computed.

## Files

| Path | Committed | Purpose |
| --- | --- | --- |
| `run.py` | yes | The harness |
| `questions.example.yaml` | yes | Demo-course questions, so `make eval` works on a fresh checkout |
| `questions.local.yaml` | no | Real questions from your own courses |
| `prices.example.yaml` | yes | Price-file template |
| `prices.yaml` | no | Your provider's per-million prices |
| `results/` | no | Timestamped JSON plus a Markdown summary per run |

## Question format

```yaml
- id: q001
  course: "DEMO 101"           # optional; scopes retrieval and answer citations
  question: "What is the late penalty?"
  kind: exact_phrase           # exact_phrase | paraphrase | deadline | multi_hop
  expected:
    files: ["2026F/DEMO101/content/syllabus.md"]
    pages: [1]                 # optional
    answer_contains: ["10 percent"]   # optional
```

Every entry needs `id`, `question` and `expected.files`. A malformed entry is an
error rather than a skip, so the denominator cannot quietly change.

## What this deliberately does not do

It does not invent questions or results. `questions.example.yaml` points only at
the fictional demo course, and a run against it is a smoke test, not a quality
claim. Publishable numbers need `questions.local.yaml` filled in from real
courses and a run on the machine that holds them.
