"""Answer-leak heuristic on LaTeX and plain text."""

from backend.app.tutoring.leak_guard import answer_tokens, leaks, normalise, without_student_text


def test_normalise_latex_and_spacing():
    assert normalise('$p = 62$') == 'p=62'
    assert normalise(r'$x=-\dfrac{1}{6}$') == 'x=-1/6'
    assert normalise(r'$\left(3c\right)(2a - 9)$') == '(3c)(2a-9)'


def test_tokens_drop_qualifiers_short_values_and_printed_numbers():
    assert answer_tokens('$p=62$.', 'Tanish pays $9.10 for 5 bars and 8 packets.') == ('p=62', '62')
    assert answer_tokens('$3c(2a-9)$ or $-3c(9-2a)$, final answer.') == ('3c(2a-9)', '-3c(9-2a)')
    assert answer_tokens('$(-2,-16)$.') == ('(-2,-16)',)
    assert answer_tokens('$x=3$') == ('x=3',)
    assert answer_tokens('$12$', 'A box costs 12 dollars.') == ()


def test_leaks_match_standalone_tokens_only():
    tokens = answer_tokens('$p=62$.')
    assert leaks('So $p = 62$ is the value.', tokens)
    assert leaks('You should get 62 here.', tokens)
    assert not leaks('There are 620 apples.', tokens)
    assert not leaks('Try p = 6 first.', tokens)


def test_tokens_the_student_wrote_may_be_confirmed():
    tokens = answer_tokens('$p=62$.')
    assert without_student_text(tokens, 'I think p = 62?') == ()
    assert without_student_text(tokens, 'p = 302') == tokens
