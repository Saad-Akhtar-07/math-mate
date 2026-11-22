import io

import pytest
from PIL import Image, ImageDraw

from backend.app.services.image_processing import InvalidImage, MAX_UPLOAD_BYTES, compress_page


def image_bytes(size=(2600, 3600), format='PNG'):
    image = Image.new('RGB', size, 'white')
    draw = ImageDraw.Draw(image)
    for y in range(100, size[1] - 100, 120):
        draw.text((100, y), '2x + 7 = 17     x = 5     y = x^2 / 3', fill='black', font_size=48)
    buffer = io.BytesIO()
    image.save(buffer, format=format)
    return buffer.getvalue()


def test_page_is_bounded_and_encoded_as_metadata_free_jpeg():
    raw = image_bytes(format='BMP')
    with pytest.raises(InvalidImage):
        compress_page(raw)
    raw = image_bytes(format='PNG')
    page = compress_page(raw)
    with Image.open(io.BytesIO(page.data)) as result:
        assert result.format == 'JPEG' and result.mode == 'RGB'
        assert max(result.size) == 2200
        assert result.width / result.height == pytest.approx(2600 / 3600, abs=.001)
        assert not result.getexif()
    assert page.original_bytes == len(raw)
    assert len(page.sha256) == len(page.upload_sha256) == 64


def test_compression_is_repeatable_and_reduces_large_photo_bytes():
    # A deterministic textured fixture exercises JPEG compression, not just a
    # blank page whose PNG may already be smaller than its JPEG equivalent.
    image = Image.effect_noise((2600, 2600), 35).convert('RGB')
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=98)
    raw = buffer.getvalue()
    one, two = compress_page(raw), compress_page(raw)
    assert one.sha256 == two.sha256
    assert len(one.data) < len(raw)
    assert one.width == 2200


def test_corrupt_oversize_and_animated_files_are_rejected():
    for raw in (b'', b'<svg>not a photo</svg>', b'x' * (MAX_UPLOAD_BYTES + 1)):
        with pytest.raises(InvalidImage):
            compress_page(raw)
    buffer = io.BytesIO()
    Image.new('RGB', (80, 80), 'white').save(buffer, format='WEBP', save_all=True,
        append_images=[Image.new('RGB', (80, 80), 'black')], duration=100, loop=0)
    with pytest.raises(InvalidImage, match='still image'):
        compress_page(buffer.getvalue())


def test_exif_rotation_and_transparency_are_handled():
    buffer = io.BytesIO()
    image = Image.new('RGB', (100, 200), 'white')
    exif = image.getexif()
    exif[274] = 6
    exif[270] = 'private metadata'
    image.save(buffer, format='JPEG', exif=exif)
    page = compress_page(buffer.getvalue())
    assert (page.width, page.height) == (200, 100)
    with Image.open(io.BytesIO(page.data)) as result:
        assert not result.getexif()
    buffer = io.BytesIO()
    Image.new('RGBA', (100, 100), (0, 0, 0, 0)).save(buffer, format='PNG')
    with Image.open(io.BytesIO(compress_page(buffer.getvalue()).data)) as result:
        assert result.getpixel((50, 50)) == (255, 255, 255)
