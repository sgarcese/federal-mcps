#!/usr/bin/env bash
# Build the OpenContext Lambda deployment zip for the portal modules (ADR-016 §4).
#
# The source is never vendored: opencontext.lock.json names the repository and the exact
# commit, this script fetches that commit into the gitignored build/ directory, copies the
# runtime packages (core/ plugins/ server/ custom_plugins/), installs requirements.txt for
# the Lambda platform (x86_64-manylinux2014, Python 3.11 — must match the module's runtime
# and architecture), and zips the result to build/opencontext-lambda.zip.
#
#   scripts/bundle-opencontext.sh            # from the repo root; run by scripts/deploy.sh
#
# Runs at deploy time only, never in CI (CI validates the module against a committed
# placeholder zip). Needs git and uv (or pip3).
set -euo pipefail
cd "$(dirname "$0")/.."

LOCK="opencontext.lock.json"
[ -f "$LOCK" ] || { echo "::error:: $LOCK not found"; exit 1; }
REPO="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).repository)' "$LOCK")"
COMMIT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).commit)' "$LOCK")"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "::error:: $LOCK commit must be a full 40-hex SHA, got '$COMMIT'"; exit 1; }

BUILD="build/opencontext"
SRC="$BUILD/src"
PKG="$BUILD/package"
ZIP="build/opencontext-lambda.zip"
PYTHON_VERSION="3.11"
PLATFORM="x86_64-manylinux2014"

echo "== fetch OpenContext $COMMIT from $REPO"
rm -rf "$SRC" "$PKG"
mkdir -p "$SRC"
git -C "$SRC" init -q
git -C "$SRC" fetch -q --depth 1 "$REPO" "$COMMIT"
git -C "$SRC" checkout -q FETCH_HEAD
[ "$(git -C "$SRC" rev-parse HEAD)" = "$COMMIT" ] || { echo "::error:: fetched commit does not match the lock"; exit 1; }

echo "== stage runtime packages"
mkdir -p "$PKG"
for d in core plugins server; do
  [ -d "$SRC/$d" ] || { echo "::error:: OpenContext source has no $d/ directory"; exit 1; }
  cp -R "$SRC/$d" "$PKG/"
done
if [ -d "$SRC/custom_plugins" ]; then cp -R "$SRC/custom_plugins" "$PKG/"; else mkdir -p "$PKG/custom_plugins"; fi

echo "== install dependencies for $PLATFORM / py$PYTHON_VERSION"
if command -v uv >/dev/null 2>&1; then
  uv pip install -q -r "$SRC/requirements.txt" --target "$PKG" \
    --python-platform "$PLATFORM" --python-version "$PYTHON_VERSION" --no-compile
elif command -v pip3 >/dev/null 2>&1; then
  pip3 install -q -r "$SRC/requirements.txt" --target "$PKG" \
    --platform manylinux2014_x86_64 --python-version "$PYTHON_VERSION" --only-binary :all: --no-compile
else
  echo "::error:: neither uv nor pip3 is available"; exit 1
fi
find "$PKG" -type d -name "__pycache__" -prune -exec rm -rf {} + 2>/dev/null || true
find "$PKG" -type d -name "tests" -path "*/plugins/*" -prune -exec rm -rf {} + 2>/dev/null || true

echo "== zip"
rm -f "$ZIP"
(cd "$PKG" && zip -q -r -X "../../../$ZIP" .)
echo "bundled OpenContext $COMMIT -> $ZIP ($(du -h "$ZIP" | cut -f1))"
