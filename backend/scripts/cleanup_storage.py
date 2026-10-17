"""Plan or remove unreferenced solution files older than 24 hours."""

import argparse

from ..app.services.storage_cleanup import cleanup
from ..app.services.storage import StorageError


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        count = cleanup(args.apply)
        print(f'{"Removed" if args.apply else "Eligible unused files"}: {count}')
        if not args.apply:
            print('Plan only; use --apply to remove eligible objects.')
    except StorageError as error:
        raise SystemExit(str(error)) from None
