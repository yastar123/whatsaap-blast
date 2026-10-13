#!/usr/bin/env bash
set -euo pipefail

pnpm run db:backup
pnpm --filter @workspace/db run push
