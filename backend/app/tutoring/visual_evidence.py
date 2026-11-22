"""Compact, neutral measurements from a submitted visual overlay.

This module never awards marks. It converts student-created vector objects into
facts the multimodal Marker can use without estimating exact coordinates from
pixels. Unknown fields are ignored so the answer format can grow compatibly.
"""

import math


def _point(value):
    if not isinstance(value, list) or len(value) != 2:
        return None
    try:
        point = [round(float(value[0]), 6), round(float(value[1]), 6)]
    except (TypeError, ValueError):
        return None
    return point if all(math.isfinite(item) for item in point) else None


def build(visual_answer):
    if not visual_answer:
        return None
    objects, observations = [], []
    for index, raw in enumerate(visual_answer.get('objects') or []):
        if not isinstance(raw, dict):
            continue
        object_id = str(raw.get('id') or f'S{index + 1}')[:80]
        kind = raw.get('type')
        item = {'id': object_id, 'type': kind}
        if kind == 'point':
            at = _point(raw.get('at'))
            if at:
                item['at'] = at
        elif kind == 'line':
            start, end = _point(raw.get('from')), _point(raw.get('to'))
            if start and end:
                item.update({'from': start, 'to': end})
                dx, dy = end[0] - start[0], end[1] - start[1]
                if abs(dx) > 1e-9:
                    gradient = round(dy / dx, 6)
                    intercept = round(start[1] - gradient * start[0], 6)
                    observations.append({'id': f'O{len(observations) + 1}', 'type': 'line_equation',
                                         'object_id': object_id, 'gradient': gradient,
                                         'y_intercept': intercept})
                else:
                    observations.append({'id': f'O{len(observations) + 1}', 'type': 'vertical_line',
                                         'object_id': object_id, 'x': start[0]})
        elif kind in ('curve', 'stroke', 'shade', 'polygon'):
            points = [_point(point) for point in raw.get('points') or []]
            points = [point for point in points if point]
            if points:
                # Keep enough shape evidence without repeating hundreds of pointer samples.
                stride = max(1, len(points) // 24)
                item['points'] = points[::stride][:25]
                item['point_count'] = len(points)
        elif kind == 'circle':
            centre = _point(raw.get('at'))
            try:
                radius = round(float(raw.get('radius')), 6)
            except (TypeError, ValueError):
                radius = None
            if centre and radius is not None and math.isfinite(radius):
                item.update({'at': centre, 'radius': radius})
        elif kind == 'label':
            at = _point(raw.get('at'))
            if at:
                item['at'] = at
            item['text'] = str(raw.get('text') or '')[:100]
        else:
            continue
        objects.append(item)
    return {
        'version': 'visual-evidence-v1',
        'primary_source': visual_answer.get('primary_source'),
        'editor_mode': visual_answer.get('editor_mode'),
        'base_block_id': visual_answer.get('base_block_id'),
        'objects': objects,
        'observations': observations,
    }
