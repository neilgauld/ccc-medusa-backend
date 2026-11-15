#!/bin/sh
# Start command for the Crowd Control Company demo on Coolify.
# Runs database migrations, the idempotent UK setup and product import,
# makes sure the admin user exists, then starts Medusa.
cd .medusa/server || exit 1
npx medusa db:migrate || exit 1
npx medusa exec ./src/scripts/setup-ccc.js || echo "[ccc] setup script failed, starting anyway"
npx medusa user -e "$MEDUSA_ADMIN_EMAIL" -p "$MEDUSA_ADMIN_PASSWORD" >/dev/null 2>&1 && echo "[ccc] admin user created" || echo "[ccc] admin user already exists"
exec npm run start
