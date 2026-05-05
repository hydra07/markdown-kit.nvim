#!/usr/bin/env bash
set -euo pipefail

echo "[pre-commit] running mise precommit checks..."
mise run precommit
