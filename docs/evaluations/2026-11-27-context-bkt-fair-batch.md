# Fair-start contextual BKT evaluation — 27 November 2026

## Decision

Keep weighted mastery active. `bkt-context-time-v1` did not outperform it in this small controlled batch. The contextual pipeline worked as designed, but its current unfitted parameters were too reactive and overconfident after instructional support.

## Protocol

- A fresh synthetic learner began with no responses, learning events or model states.
- Weighted mastery and contextual BKT received the same nine Marker labels in the same order for outcome `2.5.1`.
- The sequence was fixed before forecasts were read: six independent, two assisted and one after-solution interaction.
- Every question was a one-mark, text-only question.
- Correctness after the shown solution was stored but was not used as BKT mastery evidence.
- Only the six independent attempts were scored.
- All interactions occurred on the same day, so every update used `0_15_days`; this batch did not test forgetting.

## Independent forecasts

| Order | Part | Actual | Weighted | Context-time BKT |
|---:|---|---:|---:|---:|
| 1 | `4024-s23-11-q4-a-i` | 0 | 0.500000 | 0.550000 |
| 2 | `4024-s24-11-q6-b` | 1 | 0.429000 | 0.541600 |
| 3 | `4024-w22-22-q5-a-i` | 0 | 0.579000 | 0.810665 |
| 4 | `4024-w22-21-q8-a` | 1 | 0.440000 | 0.424114 |
| 5 | `4024-w24-22-q10-a` | 0 | 0.517000 | 0.698028 |
| 6 | `4024-w25-12-q22-a` | 1 | 0.455000 | 0.418432 |

Lower is better:

| Model | Brier score | Log loss |
|---|---:|---:|
| Weighted mastery | **0.298199** | **0.790124** |
| `bkt-context-time-v1` | 0.387820 | 1.000398 |

## Interpretation

The clearest error occurred after one assisted-correct and one after-solution learning opportunity. Contextual BKT raised mastery from `0.829838` to `0.872379` after the shown solution and predicted the next independent answer as `0.810665`; the fixed next answer was incorrect. The after-solution correctness observation was correctly ignored, but the `P(T | after_solution) = 0.25` transition still raised an already-high state. Current pooled learning transitions, especially after a solution, should be treated as candidate parameters rather than accepted values.

Final state after all nine interactions was `0.514` for weighted mastery and `0.704058` for contextual BKT. A mastery number is not itself evidence of quality; the forecast metrics above determine the comparison.

## Paid usage

- Provider/model: `deepseek` / `deepseek-flash`
- Provider requests: 9
- Successful requests: 9
- Repairs, retries, failures and image requests: 0
- Cache-hit input tokens: 9,344
- Cache-miss input tokens: 2,727
- Completion tokens: 1,701, including 262 reasoning tokens
- Recorded cost: **US$0.002915**

## Limitations and next experiment

Six scored forecasts are enough to validate the machinery, not enough to fit or select a learner model. The answer pattern was synthetic and deliberately balanced. The next legitimate evaluation should collect real independent attempts across multiple learners. Parameter fitting must use a training set, while Brier score and log loss must be reported on different held-out future attempts. Time-based forgetting requires genuine longer gaps or a separately designed historical replay study; it cannot be validated by pretending that same-day attempts occurred months apart.
