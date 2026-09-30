#!/usr/bin/env bash
# Prove opencontext.requirements.lock is enough to run the portal Lambda (#277): fetch the pinned
# OpenContext commit, install exactly the lock (--require-hashes, --no-deps) into a fresh Python 3.11
# virtualenv, then import the Lambda handler and every module under core/, plugins/ and server/
# (except the GCP adapter, which the Lambda never loads). A package the portal needs but the lock
# lacks fails here, in CI, not in production. Linux x86_64 with python3.11 (the lock's platform).
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-python3.11}"
REPO="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).repository)' opencontext.lock.json)"
COMMIT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).commit)' opencontext.lock.json)"
grep -qx "# opencontext-commit: $COMMIT" opencontext.requirements.lock || {
  echo "::error:: opencontext.requirements.lock was compiled for a different commit"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git -C "$WORK" init -q src
git -C "$WORK/src" fetch -q --depth 1 "$REPO" "$COMMIT"
git -C "$WORK/src" checkout -q FETCH_HEAD

"$PY" -m venv "$WORK/venv"
"$WORK/venv/bin/python" -m pip install -q --disable-pip-version-check \
  --require-hashes --no-deps --only-binary :all: -r opencontext.requirements.lock

cd "$WORK/src"
"$WORK/venv/bin/python" - <<'PY'
import importlib, pathlib, sys
sys.path.insert(0, ".")
importlib.import_module("server.adapters.aws_lambda")
failed = []
for root in ("core", "plugins", "server"):
    for path in sorted(pathlib.Path(root).rglob("*.py")):
        parts = path.with_suffix("").parts
        if "tests" in parts or path.name.startswith("test_") or path.name == "gcp_functions.py":
            continue
        name = ".".join(p for p in parts if p != "__init__")
        try:
            importlib.import_module(name)
        except Exception as exc:  # noqa: BLE001 - report every failure, then fail
            failed.append(f"{name}: {type(exc).__name__}: {exc}")
if failed:
    print("\n".join(failed))
    sys.exit(1)
print("OpenContext portal imports cleanly from the lock")
PY
