from __future__ import annotations
import argparse
from pathlib import Path
from .pipeline import Pipeline


def main():
    p = argparse.ArgumentParser(description="Flathead County Economic Data Pipeline")
    sub = p.add_subparsers(dest="command", required=True)
    for name in ("discover", "fetch", "validate", "build"):
        sp = sub.add_parser(name)
        sp.add_argument("--config", default="config/config.yaml")
    args = p.parse_args()
    pipe = Pipeline(Path(args.config))
    getattr(pipe, args.command)()

if __name__ == "__main__":
    main()
