#!/usr/bin/env bash
set -euo pipefail

function diagnostics() {
  echo "===== Diagnostics ====="
  echo "\n--- PostgreSQL databases ---"
  psql -c '\l' || true
  echo "\n--- .env.test ---"
  if [ -f .env.test ]; then
    sed -E 's/(postgresql:\/\/[^:]+:)[^@]+/\1***@/' .env.test
  fi
  echo "\n--- Jest logs (last 30 lines) ---"
  if [ -f jest.log ]; then
    tail -n 30 jest.log
  fi
}

trap 'status=$?; diagnostics; exit $status' ERR

# 1. Verify PostgreSQL
if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Please install PostgreSQL." >&2
  exit 1
fi

if ! pg_isready >/dev/null 2>&1; then
  echo "Attempting to start PostgreSQL..."
  (service postgresql start || sudo service postgresql start || pg_ctl -D "$PGDATA" start || true) >/dev/null 2>&1 || true
fi

# 2. Ensure ADMIN_DATABASE_URL
export ADMIN_DATABASE_URL="${ADMIN_DATABASE_URL:-postgresql://postgres:admin@localhost:5432/postgres}"

# 3. Install deps
npm ci

# 4. Pretest
npm run pretest

# 5. Tests
npm test -- --runInBand --detectOpenHandles 2>&1 | tee jest.log

