"""Deterministic Bayesian Knowledge Tracing for active memory and baselines.

The original baseline accepts independent binary observations. The first
Math Mate evolution is the active learner model: it distinguishes independent,
assisted and after-solution opportunities and applies bucketed time-based
forgetting. Its pooled parameters remain explicit, unfitted hypotheses and are
kept versioned so future fitted replacements can be evaluated honestly.
"""

from dataclasses import dataclass


MODEL_VERSION = 'bkt-shadow-v1'
CONTEXT_MODEL_VERSION = 'bkt-context-time-v1'
INDEPENDENT = 'independent'
ASSISTED = 'assisted'
AFTER_SOLUTION = 'after_solution'
ATTEMPT_CONTEXTS = (INDEPENDENT, ASSISTED, AFTER_SOLUTION)


@dataclass(frozen=True)
class Parameters:
    initial_mastery: float = 0.5
    learn: float = 0.1
    slip: float = 0.1
    guess: float = 0.2

    def __post_init__(self):
        for name, value in vars(self).items():
            if not 0.0 <= value <= 1.0:
                raise ValueError(f'{name} must be between 0 and 1')


BASELINE = Parameters()


@dataclass(frozen=True)
class ContextParameters:
    """Pooled, versioned starting parameters for the contextual experiment.

    Values are deliberately shared by every skill because the project does not
    yet have enough evidence to estimate a parameter set per outcome. Assisted
    correctness has a higher guess probability, so it is weaker proof of
    existing mastery. A shown solution contributes no correctness observation;
    only its learning transition is applied.
    """

    initial_mastery: float = 0.5
    independent_learn: float = 0.10
    independent_slip: float = 0.10
    independent_guess: float = 0.20
    assisted_learn: float = 0.20
    assisted_slip: float = 0.10
    assisted_guess: float = 0.40
    after_solution_learn: float = 0.25
    forget_16_30_days: float = 0.02
    forget_31_60_days: float = 0.05
    forget_over_60_days: float = 0.10

    def __post_init__(self):
        for name, value in vars(self).items():
            if not 0.0 <= value <= 1.0:
                raise ValueError(f'{name} must be between 0 and 1')
        if self.assisted_guess < self.independent_guess:
            raise ValueError('assisted_guess must not be lower than independent_guess')


@dataclass(frozen=True)
class ContextUpdate:
    mastery_before: float
    mastery_after_forgetting: float
    mastery_after_observation: float
    mastery_after: float
    forgetting_bucket: str
    forget_probability: float
    observation_used: bool


CONTEXT_BASELINE = ContextParameters()


def evidence_confidence(observation_count):
    """How strongly runtime decisions may trust a personalized BKT state.

    This is not mastery and does not alter Bayesian updates. It prevents one
    observation from moving the Socratic starting level. The curve matches the
    former two-observation prior strength: 0, 1 and 2 observations yield 0,
    0.333 and 0.5 confidence respectively.
    """
    count = max(0, int(observation_count))
    return round(count / (count + 2), 3) if count else 0.0


def probability_correct(mastery, parameters=BASELINE):
    """Probability of a correct independent response before seeing its result."""
    return mastery * (1.0 - parameters.slip) + (1.0 - mastery) * parameters.guess


def update(mastery, correct, parameters=BASELINE):
    """Return mastery after one binary observation and one learning opportunity."""
    if correct:
        numerator = mastery * (1.0 - parameters.slip)
        denominator = numerator + (1.0 - mastery) * parameters.guess
    else:
        numerator = mastery * parameters.slip
        denominator = numerator + (1.0 - mastery) * (1.0 - parameters.guess)
    posterior = numerator / denominator if denominator else mastery
    return posterior + (1.0 - posterior) * parameters.learn


def forgetting(elapsed_days, parameters=CONTEXT_BASELINE):
    """Return the named time bucket and mastered-to-unmastered transition."""
    if elapsed_days is None or elapsed_days <= 15:
        return '0_15_days', 0.0
    if elapsed_days <= 30:
        return '16_30_days', parameters.forget_16_30_days
    if elapsed_days <= 60:
        return '31_60_days', parameters.forget_31_60_days
    return 'over_60_days', parameters.forget_over_60_days


def apply_forgetting(mastery, elapsed_days, parameters=CONTEXT_BASELINE):
    """Project stored mastery to the present without mutating the state."""
    bucket, probability = forgetting(elapsed_days, parameters)
    before = min(1.0, max(0.0, float(mastery)))
    return before * (1.0 - probability), bucket, probability


def context_values(context, parameters=CONTEXT_BASELINE):
    if context == INDEPENDENT:
        return parameters.independent_learn, parameters.independent_slip, parameters.independent_guess
    if context == ASSISTED:
        return parameters.assisted_learn, parameters.assisted_slip, parameters.assisted_guess
    if context == AFTER_SOLUTION:
        return parameters.after_solution_learn, None, None
    raise ValueError(f'Unknown BKT attempt context: {context}')


def context_probability_correct(mastery, context=INDEPENDENT, parameters=CONTEXT_BASELINE):
    """Forecast correctness in a context without changing mastery."""
    _, slip, guess = context_values(context, parameters)
    if slip is None or guess is None:
        raise ValueError('After-solution work is not a diagnostic correctness observation')
    return mastery * (1.0 - slip) + (1.0 - mastery) * guess


def contextual_update(mastery, correct, context, elapsed_days=None, parameters=CONTEXT_BASELINE):
    """Apply forgetting, contextual observation evidence and contextual learning."""
    before = min(1.0, max(0.0, float(mastery)))
    after_forgetting, bucket, forget = apply_forgetting(before, elapsed_days, parameters)
    learn, slip, guess = context_values(context, parameters)
    observation_used = context != AFTER_SOLUTION
    if observation_used:
        if correct:
            numerator = after_forgetting * (1.0 - slip)
            denominator = numerator + (1.0 - after_forgetting) * guess
        else:
            numerator = after_forgetting * slip
            denominator = numerator + (1.0 - after_forgetting) * (1.0 - guess)
        posterior = numerator / denominator if denominator else after_forgetting
    else:
        posterior = after_forgetting
    after = posterior + (1.0 - posterior) * learn
    return ContextUpdate(before, after_forgetting, posterior, after, bucket, forget, observation_used)
