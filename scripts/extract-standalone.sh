#!/usr/bin/env bash
# Extracts apps/atc into a standalone repository directory, ready to publish.
#
#   ./scripts/extract-standalone.sh /path/to/atc-decision-support
#
# What it does, and why each step exists:
#   - rsyncs the app, excluding generated and sampling artifacts
#   - renames the package to atc-decision-support, marks it public,
#     sets license, and pins tsx (the analysis scripts need it; inside the
#     monorepo it arrives by hoisting, standalone it must be declared)
#   - writes pnpm-workspace.yaml with allowBuilds for esbuild (pnpm >= 11
#     refuses to run dependency build scripts without explicit approval,
#     and vite's esbuild needs its postinstall)
#   - writes a .gitignore
#   - verifies the result: install, tests, typecheck, build
#
# It does NOT create a git repository, a GitHub project, or a Zenodo deposit.
# Publishing is a separate, deliberate act:
#   cd <dest> && git init && git add -A && git commit -m "initial import"
#   gh repo create fbritoferreira/atc-decision-support --public --source=. --push
# Then wire the Zenodo GitHub integration and cut a release for the DOI, and
# fill the two TODO fields in CITATION.cff (ORCiD, DOI).

set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:?usage: extract-standalone.sh <destination-dir>}"

if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then
  echo "refusing to overwrite non-empty destination: $DEST" >&2
  exit 1
fi
mkdir -p "$DEST"

rsync -a \
  --exclude node_modules \
  --exclude dist \
  --exclude data \
  --exclude .tanstack \
  --exclude .nitro \
  --exclude '*.log' \
  --exclude .DS_Store \
  "$SRC/" "$DEST/"

TSX_VERSION="$("$SRC/node_modules/.bin/tsx" --version 2>/dev/null | grep -o 'tsx v[0-9.]*' | cut -dv -f2 || echo 4.22.4)"

python3 - "$DEST" "$TSX_VERSION" <<'PY'
import json, sys
dest, tsx = sys.argv[1], sys.argv[2]
p = f"{dest}/package.json"
d = json.load(open(p))
d["name"] = "atc-decision-support"
d["private"] = False
d["license"] = "Apache-2.0"
d["devDependencies"]["tsx"] = f"^{tsx}"
json.dump(d, open(p, "w"), indent=2)
print(f"package.json: renamed, public, Apache-2.0, tsx ^{tsx}")
PY

printf 'allowBuilds:\n  esbuild: true\n' > "$DEST/pnpm-workspace.yaml"

cat > "$DEST/.gitignore" <<'EOF'
node_modules/
dist/
data/
.tanstack/
.nitro/
*.log
.DS_Store
EOF

echo "== verifying standalone =="
cd "$DEST"
pnpm install --silent
pnpm test
pnpm typecheck
pnpm build
echo "== standalone verified at $DEST =="
