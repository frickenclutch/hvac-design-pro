#!/bin/bash
set -e

# Create Demo and Production databases
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE DATABASE hvacpro_demo;
	CREATE DATABASE hvacpro_production;
EOSQL

echo "Running migrations on hvacpro_demo..."
for f in /docker-entrypoint-initdb.d/database/migrations/*.sql; do
    echo "Applying $f..."
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "hvacpro_demo" -f "$f"
done

echo "Running migrations on hvacpro_production..."
for f in /docker-entrypoint-initdb.d/database/migrations/*.sql; do
    echo "Applying $f..."
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "hvacpro_production" -f "$f"
done

echo "Applying seeds ONLY to hvacpro_demo..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "hvacpro_demo" -f "/docker-entrypoint-initdb.d/database/seeds/seed_initial_data.sql"

echo "Database initialization completed successfully!"
