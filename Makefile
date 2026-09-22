include .env
export $(shell sed 's/=.*//' .env)
include .env.common
export $(shell sed 's/=.*//' .env.common)

# Select which API service to control (override with API_SERVICE=aymurai-api-gpu)
API_SERVICE ?= aymurai-api
# Select which full API service to control (override with API_FULL_SERVICE=aymurai-api-full-gpu)
API_FULL_SERVICE ?= aymurai-api-full

# Select which coro (ASR) service to control (override with CORO_SERVICE=coro-gpu)
CORO_SERVICE ?= coro


api-build:
	docker compose build $(API_SERVICE)
api-run:
	docker compose run --service-ports $(API_SERVICE)
api-up:
	docker compose up -d $(API_SERVICE)
api-stop:
	docker compose stop $(API_SERVICE)
api-logs:
	docker compose logs -f $(API_SERVICE)
api-pull:
	docker compose pull $(API_SERVICE)

api-full-build:
	docker compose build $(API_FULL_SERVICE)
api-full-run:
	docker compose run --service-ports $(API_FULL_SERVICE)
api-full-up:
	docker compose up -d $(API_FULL_SERVICE)
api-full-stop:
	docker compose stop $(API_FULL_SERVICE)
api-full-logs:
	docker compose logs -f $(API_FULL_SERVICE)
api-full-pull:
	docker compose pull $(API_FULL_SERVICE)

coro-build:
	docker compose build $(CORO_SERVICE)
coro-run:
	docker compose --profile asr run --service-ports $(CORO_SERVICE)
coro-up:
	docker compose --profile asr up -d $(CORO_SERVICE)
coro-stop:
	docker compose stop $(CORO_SERVICE)
coro-logs:
	docker compose logs -f $(CORO_SERVICE)
coro-pull:
	docker compose pull $(CORO_SERVICE)

db-backup:
	docker compose run --rm db-backup --once
# db-restore replaces the live database file: it also removes the old
# -wal/-shm sidecars, since leaving them next to the restored .db would make
# SQLite replay WAL entries from the old database onto the new one,
# corrupting it.
db-restore:
	@if [ -z "$(BACKUP_FILE)" ]; then \
		echo "usage: make db-restore BACKUP_FILE=database_20260921231500.db"; \
		exit 1; \
	fi
	docker compose stop $(API_SERVICE) $(API_FULL_SERVICE) || true
	cp resources/backups/$(BACKUP_FILE) resources/cache/sqlite/database.db
	rm -f resources/cache/sqlite/database.db-wal resources/cache/sqlite/database.db-shm
	@echo "Restored $(BACKUP_FILE). Start the API again with 'make api-up' or 'make api-full-up'."

stress-test:
	uv run --group loadtest locust -f locustfile.py --host http://localhost:8899

alembic-regenerate:
	rm -rvf resources/cache/sqlite/* && \
	rm -rvf aymurai/database/versions/* && \
	cd aymurai && \
	uv run alembic revision --autogenerate -m "Create database" && \
	uv run alembic upgrade head

# --- Frontend build ---
FRONTEND_DIR=frontend
FRONTEND_DIST_DIR=frontend-dist

frontend-install:
	cd $(FRONTEND_DIR) && pnpm install

frontend-build: frontend-install
	cd $(FRONTEND_DIR) && pnpm run build:web
	# Copy build output to frontend-dist
	rm -rf $(FRONTEND_DIST_DIR)
	cp -r $(FRONTEND_DIR)/out/renderer $(FRONTEND_DIST_DIR)

frontend-clean:
	rm -rf $(FRONTEND_DIST_DIR)
