"""Request helpers shared by the database integration tests."""

import hashlib


def learner_id(connection, headers):
    token = headers['Authorization'].removeprefix('Bearer ')
    return connection.execute('select learner_id from math_mate.learner_sessions where token_hash = %s',
                              (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()[0]


def guest(client):
    response = client.post('/api/v1/learner-sessions')
    assert response.status_code == 201
    assert response.headers['cache-control'] == 'no-store'
    return {'Authorization': f"Bearer {response.json()['access_token']}"}


def part(connection):
    return connection.execute('select id from math_mate.question_parts where active order by id limit 1').fetchone()[0]


def save(client, headers, part_id, text, revision=0):
    return client.put(f'/api/v1/me/responses/{part_id}', headers=headers,
                      json={'typed_work': text, 'expected_revision': revision})
