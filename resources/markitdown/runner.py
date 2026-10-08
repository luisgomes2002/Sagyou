"""Small, JSON-only boundary around MarkItDown for the Electron main process."""

import json
import sys

from markitdown import MarkItDown


MAX_DOCUMENT_CHARS = 50_000


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Caminho do arquivo ausente"}))
        return 2

    try:
        markdown = MarkItDown().convert(sys.argv[1]).markdown or ""
        truncated = len(markdown) > MAX_DOCUMENT_CHARS
        print(
            json.dumps(
                {
                    "text": markdown[:MAX_DOCUMENT_CHARS],
                    "truncated": truncated,
                }
            )
        )
        return 0
    except Exception as error:  # The app receives a controlled error, never a traceback.
        print(json.dumps({"error": str(error) or "Falha ao processar o documento"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
