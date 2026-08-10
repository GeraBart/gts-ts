CI := 1

.PHONY: help build dev-fmt all check fmt lint typecheck test security update-spec e2e-deps e2e coverage

# Virtualenv used by the gts-spec conformance suite
VENV := .venv
PYTHON := $(VENV)/bin/python

# Default target - show help
.DEFAULT_GOAL := help

# Show this help message
help:
	@awk '/^# / { desc=substr($$0, 3) } /^[a-zA-Z0-9_-]+:/ && desc { target=$$1; sub(/:$$/, "", target); printf "%-20s - %s\n", target, desc; desc="" }' Makefile | sort

# Build the project
build:
	npm run build

# Fix formatting issues
dev-fmt:
	npm run format

# Run all checks and build
all: check build

# Check code formatting
fmt:
	npx prettier --check "src/**/*.ts" "tests/**/*.ts"

# Run linter (eslint)
lint:
	npm run lint

# Run type checker
typecheck:
	npm run typecheck

# Run all tests
test:
	npm run test

# Check dependencies for security vulnerabilities
security:
	npm audit

# Measure code coverage
coverage:
	npx jest --coverage

# Update gts-spec submodule to latest
update-spec:
	git submodule update --init --remote .gts-spec

# Install the Python dependencies for the gts-spec conformance suite
# httprunner pins pydantic <1.9, which does not build on modern Python, so it is
# installed with --no-deps and its transitive deps come from requirements.txt
# (same procedure as .gts-spec/tests/Dockerfile).
e2e-deps: $(VENV)/.stamp
$(VENV)/.stamp: .gts-spec/tests/requirements.txt
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install --quiet --upgrade pip
	$(VENV)/bin/pip install --quiet -r .gts-spec/tests/requirements.txt
	$(VENV)/bin/pip install --quiet --no-deps 'httprunner>=4,<5'
	@touch $@

# Run end-to-end tests against gts-spec
e2e: build e2e-deps
	@echo "Starting server in background..."
	@node dist/server/index.js --port 8000 & echo $$! > .server.pid
	@sleep 2
	@echo "Running e2e tests..."
	@PYTHONDONTWRITEBYTECODE=1 $(VENV)/bin/pytest -p no:cacheprovider --log-file=e2e.log ./.gts-spec/tests || (kill `cat .server.pid` 2>/dev/null; rm -f .server.pid; exit 1)
	@echo "Stopping server..."
	@kill `cat .server.pid` 2>/dev/null || true
	@rm -f .server.pid
	@echo "E2E tests completed successfully"

# Run all quality checks
check: fmt lint typecheck test e2e
