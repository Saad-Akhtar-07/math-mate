# Math Mate BKT learner model

Math Mate uses `bkt-context-time-v1` as its active learner model. Reliable Marker attempts update a separate mastery probability for each user and syllabus outcome. The Socratic policy reads that probability and its evidence confidence when choosing the starting help level. BKT does not mark work, interpret chat or write replies; Marker, Listener, policy and Composer keep those separate responsibilities.

The earlier weighted formula and standard BKT remain evaluation baselines so the recorded experiments can still be reproduced. They do not guide live tutoring.

## Model versions

### `bkt-shadow-v1`

The standard baseline uses only independent marked attempts. Full marks is a correct binary observation; every lower score is incorrect. It has no forgetting and uses the same parameters for every outcome:

| Parameter | Value |
|---|---:|
| Initial mastery `P(L0)` | 0.50 |
| Learning `P(T)` | 0.10 |
| Slip `P(S)` | 0.10 |
| Guess `P(G)` | 0.20 |

### `bkt-context-time-v1`

This is Math Mate's first active BKT model. It is a pooled, unfitted parameterization informed by research on contextual guess/slip, tutoring scaffolds and time-aware BKT. The parameters are shared by every outcome because current data is too small for reliable skill-specific estimation. The fair-start experiment below remains evidence that these values are not yet proven better than weighted mastery.

| Context | `P(T)` | `P(S)` | `P(G)` | How the observation is used |
|---|---:|---:|---:|---|
| Independent | 0.10 | 0.10 | 0.20 | Correct/incorrect updates mastery normally |
| Assisted | 0.20 | 0.10 | 0.40 | Higher guess makes assisted correctness weaker evidence |
| After solution | 0.25 | — | — | Correctness is ignored; only learning is applied |

These values are versioned hypotheses, not fitted facts and not evidence that the model is better. Any fitted replacement must use a new model version so earlier forecasts and tutoring decisions remain reproducible.

## New-user and online-learning behaviour

A new student has no skill-state rows. On the first validated attempt for an outcome, BKT starts from `P(L0) = 0.50`, processes the Marker label and stores the resulting personal state. Each later attempt reads that student's previous state and updates it online. This is personalized Bayesian state updating, not retraining the global guess, slip, learning or forgetting parameters.

The tutor treats a state as uncertain until it has repeated diagnostic observations. Runtime confidence is `n / (n + 2)`, where `n` counts independent and assisted Marker observations; after-solution repetitions do not increase diagnostic confidence. One observation therefore has confidence `0.333`, two have `0.500`, and six have `0.750`.

Existing accounts can rebuild the active state from their append-only Marker history without a model call:

```powershell
.\.venv\Scripts\python.exe -m backend.scripts.rebuild_context_bkt_states
.\.venv\Scripts\python.exe -m backend.scripts.rebuild_context_bkt_states --apply
```

The first command is a read-only plan. Rebuilding updates current states only; it never invents retrospective predictions or audit transitions.

## Where context comes from

The assessment workflow establishes context without asking an LLM:

| Stored assessment state | BKT context | Historical evidence weight |
|---|---|---:|
| No completed tutor assistance before submission | `independent` | 1.00 |
| Tutor assistance occurred, no full solution | `assisted` | 0.50 |
| The tutor showed the full solution | `after_solution` | 0.25 |

Ordinary chat does not update BKT. Only a completed, validated Marker result creates an attempt event. Full marks maps to `correct`; partial or zero marks map to `incorrect`.

## Update equations

Let `L` be mastery before the interaction.

First apply the elapsed-time forgetting transition:

```text
L_forgetting = L × (1 - F_bucket)
```

For independent and assisted correct observations:

```text
L_observation = L_forgetting × (1 - S)
                -----------------------------------------------
                L_forgetting × (1 - S) + (1 - L_forgetting) × G
```

For incorrect observations:

```text
L_observation = L_forgetting × S
                -------------------------------------------------
                L_forgetting × S + (1 - L_forgetting) × (1 - G)
```

After a shown solution, `L_observation = L_forgetting`; the submitted correctness is retained for audit but deliberately not used as mastery proof.

Finally apply contextual learning:

```text
L_next = L_observation + (1 - L_observation) × T_context
```

The scored prediction for an independent attempt is made before observing its result:

```text
P(correct next) = L_forgetting × (1 - S_independent)
                  + (1 - L_forgetting) × G_independent
```

## Forgetting buckets

| Elapsed time since the previous attempt event | Bucket | `P(F)` |
|---|---|---:|
| 0–15 days | `0_15_days` | 0.00 |
| 16–30 days | `16_30_days` | 0.02 |
| 31–60 days | `31_60_days` | 0.05 |
| More than 60 days | `over_60_days` | 0.10 |

Forgetting is applied when the learner next interacts with that outcome, not by a background job. This keeps the state deterministic and avoids changing memory merely because a clock passed.

## Fair historical initialization

When contextual BKT first encounters a user/outcome with no v2 state, it replays earlier append-only attempt events in chronological order. Evidence weights recover the three contexts shown above. Replay initializes the state and evidence count only; it does not create fake historical predictions. The first scored v2 prediction is therefore a genuine forecast made before a future independent result, while both weighted memory and contextual BKT have had access to the learner's earlier evidence.

## Stored research data

- `bkt_states`: latest mastery, evidence count and time per user, outcome and model version. The tutor reads only `bkt-context-time-v1`.
- `bkt_updates`: audit trail for new contextual transitions, containing context, observed label, whether the label was used, elapsed time, forgetting stage and mastery stages. Replayed historical inputs remain in `learning_events`.
- `learner_model_predictions`: pre-observation forecasts for independent attempts only.
- `user_outcome_state`: legacy weighted projection retained only for evaluation.

These tables contain no answer text, prompts, API keys or private image locations. The tutoring policy reads only the active version in `bkt_states`; Marker, Listener and Composer do not query learner-model tables directly.

## Evaluation

Run the read-only report for all outcomes:

```powershell
.\.venv\Scripts\python.exe -m backend.scripts.evaluate_shadow_bkt
```

Or restrict it to one learner and outcome:

```powershell
.\.venv\Scripts\python.exe -m backend.scripts.evaluate_shadow_bkt --user-id USER_UUID --outcome-code 2.5.1
```

Compare cold-start, follow-up and overall Brier score and log loss. Lower is better. The research question is whether a model predicts the **next independent result**, not whether its mastery number looks reasonable. Report standard BKT, contextual BKT and weighted memory separately; never tune parameters on the same forecast rows used to claim improvement.

## Research basis and limits

- Baker, Corbett and Aleven describe contextual estimation of BKT guess and slip and evaluate future-performance prediction: [More Accurate Student Modeling through Contextual Estimation of Slip and Guess Probabilities](https://www.cs.cmu.edu/afs/cs/Web/People/rsbaker/BCA2008V.pdf).
- Sao Pedro, Baker and Gobert incorporate scaffolding and tutor context into BKT: [Incorporating Scaffolding and Tutor Context into Bayesian Knowledge Tracing](https://files.eric.ed.gov/fulltext/ED558215.pdf).
- Qiu and colleagues evaluate time between opportunities in BKT: [Does Time Matter? Modeling the Effect of Time in Bayesian Knowledge Tracing](https://files.eric.ed.gov/fulltext/ED537453.pdf).

Those studies justify context and forgetting; they do not prove that Math Mate's initial parameters improve predictions. The preserved [fair-start evaluation](evaluations/2026-11-27-context-bkt-fair-batch.md) found weighted mastery better on six synthetic independent forecasts. Future parameters must be fitted on training data and evaluated on different held-out students or future attempts.
