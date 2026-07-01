.PHONY: help dev up down indexer api explorer install check test clippy typecheck fmt

help: ## show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n",$$1,$$2}'

dev: up install ## run indexer + api + explorer together (Ctrl-C stops all)
	@trap 'kill 0' INT TERM; \
	( set -a; [ -f .env ] && . ./.env; set +a; cargo run -p cross-scout-indexer-core --bin cross-scout-indexer ) & \
	( set -a; [ -f .env ] && . ./.env; set +a; bun run --cwd apps/api dev ) & \
	( bun run --cwd apps/crossscout dev ) & \
	wait

up: ## start postgres + redis + clickhouse
	docker compose up -d

down: ## stop datastores
	docker compose down

install: ## install bun workspace deps
	bun install

indexer: ## run the indexer (reads .env; USE_MOCK_SOURCES=true by default)
	set -a && [ -f .env ] && . ./.env; set +a; \
	cargo run -p cross-scout-indexer-core --bin cross-scout-indexer

api: ## run the Bun api
	set -a && [ -f .env ] && . ./.env; set +a; \
	bun run --cwd apps/api dev

explorer: ## run the React explorer
	bun run --cwd apps/crossscout dev

check: ## cargo check the whole workspace
	cargo check --workspace --all-targets

test: ## run rust tests
	cargo test --workspace

clippy: ## lint rust
	cargo clippy --workspace --all-targets

typecheck: ## typecheck all TS packages
	bun run typecheck

fmt: ## format rust
	cargo fmt --all
