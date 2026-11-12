#!/usr/bin/env bash

set -euo pipefail

MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/migrations" && pwd)"

: "${PGHOST:?PGHOST must be set for database migrations}"
: "${PGDATABASE:?PGDATABASE must be set for database migrations}"
: "${PGUSER:?PGUSER must be set for database migrations}"
: "${PGPASSWORD:?PGPASSWORD must be set for database migrations}"
export PGHOST PGDATABASE PGUSER PGPASSWORD

if ! command -v psql >/dev/null 2>&1; then
    echo "psql is required to run database migrations." >&2
    exit 1
fi

export LC_ALL=C
shopt -s nullglob
migrations=("$MIGRATIONS_DIR"/*.sql)

if ((${#migrations[@]} == 0)); then
    echo "No SQL migrations found in $MIGRATIONS_DIR." >&2
    exit 1
fi

for migration in "${migrations[@]}"; do
    name="${migration##*/}"
    if [[ ! "$name" =~ ^[0-9]{3}_[a-z0-9_]+\.sql$ ]]; then
        echo "Invalid migration filename: $name (expected NNN_description.sql)." >&2
        exit 1
    fi
done

psql --no-psqlrc --no-password --set=ON_ERROR_STOP=1 --dbname="$PGDATABASE" <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    migration_name text PRIMARY KEY,
    checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
    applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for migration in "${migrations[@]}"; do
    name="${migration##*/}"
    checksum="$(sha256sum "$migration" | cut -d ' ' -f 1)"

    (
        cd "$MIGRATIONS_DIR"
        {
            printf "BEGIN;\n"
            printf "SELECT pg_advisory_xact_lock(hashtext('web-site'), hashtext('schema_migrations'));\n"
            printf "SELECT EXISTS (SELECT 1 FROM public.schema_migrations WHERE migration_name = '%s') AS already_applied,\n" "$name"
            printf "       COALESCE((SELECT checksum = '%s' FROM public.schema_migrations WHERE migration_name = '%s'), false) AS checksum_matches\n" "$checksum" "$name"
            printf "\\gset\n"
            printf "\\if :already_applied\n"
            printf "  \\if :checksum_matches\n"
            printf "    \\echo Migration already applied: %s\n" "$name"
            printf "  \\else\n"
            printf "    \\echo ERROR: checksum changed for applied migration %s\n" "$name"
            printf "    \\quit 3\n"
            printf "  \\endif\n"
            printf "\\else\n"
            printf "  \\echo Applying migration: %s\n" "$name"
            printf "  \\i '%s'\n" "$name"
            printf "  INSERT INTO public.schema_migrations (migration_name, checksum) VALUES ('%s', '%s');\n" "$name" "$checksum"
            printf "  \\echo Applied migration: %s\n" "$name"
            printf "\\endif\n"
            printf "COMMIT;\n"
        } | psql --no-psqlrc --no-password --set=ON_ERROR_STOP=1 --dbname="$PGDATABASE"
    )
done

echo "Database migrations are up to date."
