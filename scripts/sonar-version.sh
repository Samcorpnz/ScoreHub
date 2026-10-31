#!/usr/bin/env bash
# Prints the sonar.projectVersion for this checkout: the short SHA of the last
# main commit it's based on (main itself, on main). The project's new-code
# period is "previous version", so new code is everything not yet on main —
# and the baseline moves forward every time main does, instead of sticking at
# the first analysis forever (which a never-bumped version would do).
# Used by scripts/sonar-scan.sh and .github/workflows/sonar.yml.
set -euo pipefail

cd "$(dirname "$0")/.."
base=$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD)
git rev-parse --short=12 "$base"
