"""Check the private solutions bucket, or create it with --apply."""

import argparse

from ..app.services.storage import Storage, StorageError

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        Storage().ensure_bucket(create=args.apply)
        print('Private solution-image bucket is ready.')
    except StorageError as error:
        raise SystemExit(str(error)) from None
