"""Bounded photo decoding and readable page compression, without AI or merging."""

import hashlib
import io
import warnings
from dataclasses import dataclass
from threading import BoundedSemaphore

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_STORED_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 25_000_000
MAX_EDGE = 2200
PROCESSING = BoundedSemaphore(1)


class InvalidImage(ValueError):
    pass


class ImageBusy(RuntimeError):
    pass


@dataclass(frozen=True)
class CompressedPage:
    data: bytes
    width: int
    height: int
    upload_sha256: str
    sha256: str
    original_bytes: int


def compress_page(raw: bytes) -> CompressedPage:
    if not raw or len(raw) > MAX_UPLOAD_BYTES:
        raise InvalidImage('Choose an image smaller than 10 MB.')
    if not PROCESSING.acquire(blocking=False):
        raise ImageBusy('An image is being processed. Please try again in a moment.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as probe:
                if probe.format not in {'JPEG', 'PNG', 'WEBP'}:
                    raise InvalidImage('Use a JPEG, PNG or WebP photo.')
                if getattr(probe, 'n_frames', 1) != 1:
                    raise InvalidImage('Use a still image, not an animated image.')
                if probe.width * probe.height > MAX_PIXELS or min(probe.size) < 64:
                    raise InvalidImage('Use an image between 64 pixels per side and 25 megapixels.')
                probe.verify()
            with Image.open(io.BytesIO(raw)) as source:
                page = ImageOps.exif_transpose(source)
                page.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
                if min(page.size) < 64:
                    raise InvalidImage('Crop the photo to a readable solution page before uploading.')
                if page.mode in {'RGBA', 'LA', 'P'}:
                    rgba = page.convert('RGBA')
                    rgb = Image.new('RGB', page.size, 'white')
                    rgb.paste(rgba, mask=rgba.getchannel('A'))
                else:
                    rgb = page.convert('RGB')
                # Re-encoding removes EXIF/GPS and embedded metadata. Size is a
                # soft target: do not crush handwriting to meet a tiny byte cap.
                for quality in (88, 82, 76):
                    buffer = io.BytesIO()
                    rgb.save(buffer, format='JPEG', quality=quality, optimize=True, subsampling=0)
                    data = buffer.getvalue()
                    if len(data) <= 1024 * 1024:
                        break
                if len(data) > MAX_STORED_BYTES:
                    raise InvalidImage('This image is too detailed to store safely. Crop to the solution page and try again.')
                return CompressedPage(data, rgb.width, rgb.height,
                    hashlib.sha256(raw).hexdigest(), hashlib.sha256(data).hexdigest(), len(raw))
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise InvalidImage('The image could not be read. Choose a valid JPEG, PNG or WebP photo.') from error
    finally:
        PROCESSING.release()
