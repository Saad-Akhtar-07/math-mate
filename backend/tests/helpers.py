"""Request helpers shared by the database integration tests."""

from uuid import UUID, uuid4


def user_id(_connection, headers):
    return UUID(headers['Authorization'].removeprefix('Bearer '))


def user(_client):
    return {'Authorization': f'Bearer {uuid4()}'}


def part(connection):
    return connection.execute('select id from math_mate.question_parts where active order by id limit 1').fetchone()[0]


def save(client, headers, part_id, text, revision=0):
    return client.put(f'/api/v1/me/responses/{part_id}', headers=headers,
                      json={'typed_work': text, 'expected_revision': revision})
