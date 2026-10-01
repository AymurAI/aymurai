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
db-backup-up:
	docker compose up -d db-backup
db-backup-stop:
	docker compose stop db-backup
db-backup-logs:
	docker compose logs -f db-backup
# db-restore replaces the live database file: it stops every API variant
# (CPU and GPU, lite and full) plus the backup sidecar and verifies none are
# still running before touching anything -- docker compose stop on a
# container that isn't running exits 0 silently, so stopping only the
# CPU-default services would let a GPU variant keep writing to the database
# while it's overwritten. It also removes the old -wal/-shm sidecars before
# copying in the restored file, not after: leaving them around even briefly
# next to a new/truncated database.db would make SQLite replay WAL entries
# from the database being discarded onto the new one, corrupting it. The
# pre-restore safety snapshot reuses the db-backup sidecar's one-shot backup
# instead of a plain `cp`, for the same WAL-safety reason backup.py itself
# doesn't use `cp` -- it lands as an ordinary database_<timestamp>.db in the
# normal backup set rather than a distinctly-named pre-restore_ file (or is
# skipped when the latest backup already holds identical bytes). That
# snapshot overrides BACKUP_RETENTION=0 for this one invocation only: at
# steady state the backup set is already at the retention cap, so taking one
# more snapshot without disabling pruning would make the sidecar's own prune
# step delete the oldest file -- which can be the exact backup being restored.
db-restore:
	@if [ -z "$(BACKUP_FILE)" ]; then \
		echo "usage: make db-restore BACKUP_FILE=database_20260921231500.db"; \
		exit 1; \
	fi
	@if [ ! -f resources/backups/$(BACKUP_FILE) ]; then \
		echo "no such backup: resources/backups/$(BACKUP_FILE)"; \
		exit 1; \
	fi
	docker compose stop aymurai-api aymurai-api-gpu aymurai-api-full aymurai-api-full-gpu db-backup || true
	@still="$$(docker compose ps -q aymurai-api aymurai-api-gpu aymurai-api-full aymurai-api-full-gpu db-backup)"; \
	if [ -n "$$still" ]; then \
		echo "refusing to restore: an API container is still running"; exit 1; \
	fi
	@if [ -f resources/cache/sqlite/database.db ]; then \
		docker compose run --rm -e BACKUP_RETENTION=0 db-backup --once; \
	fi
	rm -f resources/cache/sqlite/database.db-wal resources/cache/sqlite/database.db-shm
	cp resources/backups/$(BACKUP_FILE) resources/cache/sqlite/database.db.restoring
	mv resources/cache/sqlite/database.db.restoring resources/cache/sqlite/database.db
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
