#!/usr/bin/env bash
# Start the manager with demo-only trust for the host order-scanner artifact API.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANAGER_DIR="$(cd "$HERE/.." && pwd)"
SCANNER_DIR="${ORDER_SCANNER_DIR:-$MANAGER_DIR/../canteen/order-scanner}"
ENV_FILE="$HERE/.env"
COMPOSE_FILES=(-f "$HERE/docker-compose.yml" -f "$HERE/docker-compose.scanner-demo.yml")
SCANNER_PYTHON="${ORDER_SCANNER_PYTHON:-$SCANNER_DIR/.venv/bin/python}"
DEMO_ROOT="$SCANNER_DIR/var/demo"
PID_FILE="$DEMO_ROOT/scanner.pid"
RUN_ROOT=""
LOG_FILE=""
AUTH_TOKEN=""
DEMO_READY=0

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 not found"
}

read_env_value() {
  local key="$1"
  local value
  value="$(awk -v key="$key" '
    index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }
  ' "$ENV_FILE")"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

stop_scanner() {
  [[ -f "$PID_FILE" ]] || return 0
  local pid
  pid="$(<"$PID_FILE")"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && \
    ps -p "$pid" -o command= | grep -Fq "order-scanner"; then
    kill "$pid"
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
  fi
  rm -f "$PID_FILE"
}

cleanup_on_exit() {
  if [[ "$DEMO_READY" -ne 1 ]]; then
    stop_scanner
  fi
}

ensure_demo_tls() {
  local tls_dir="$SCANNER_DIR/var/demo/tls"
  local ca_key="$tls_dir/ca-key.pem"
  local ca_cert="$tls_dir/ca.pem"
  local server_key="$tls_dir/server-key.pem"
  local server_cert="$tls_dir/server.pem"

  mkdir -p "$tls_dir"
  chmod 700 "$SCANNER_DIR/var" "$SCANNER_DIR/var/demo" "$tls_dir" 2>/dev/null || true
  local valid=0
  if [[ -f "$ca_key" && -f "$ca_cert" && -f "$server_key" && -f "$server_cert" ]] && \
    openssl verify -CAfile "$ca_cert" -verify_hostname host.docker.internal "$server_cert" >/dev/null 2>&1 && \
    openssl x509 -checkend 86400 -noout -in "$ca_cert" >/dev/null 2>&1 && \
    openssl x509 -checkend 86400 -noout -in "$server_cert" >/dev/null 2>&1; then
    valid=1
  fi
  if [[ "$valid" -ne 1 ]]; then
    local temp_dir
    temp_dir="$(mktemp -d "$tls_dir/.generate.XXXXXX")"
    trap 'rm -rf "$temp_dir"' RETURN
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$temp_dir/ca-key.pem" >/dev/null 2>&1
    openssl req -x509 -new -sha256 -days 30 -key "$temp_dir/ca-key.pem" \
      -subj '/CN=Order Scanner Demo CA' -out "$temp_dir/ca.pem" >/dev/null 2>&1
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$temp_dir/server-key.pem" >/dev/null 2>&1
    openssl req -new -key "$temp_dir/server-key.pem" -subj '/CN=host.docker.internal' \
      -out "$temp_dir/server.csr" >/dev/null 2>&1
    printf '%s\n' \
      'subjectAltName=DNS:host.docker.internal,DNS:localhost,IP:127.0.0.1' \
      'extendedKeyUsage=serverAuth' \
      'keyUsage=digitalSignature,keyEncipherment' > "$temp_dir/server.ext"
    openssl x509 -req -sha256 -days 30 -in "$temp_dir/server.csr" \
      -CA "$temp_dir/ca.pem" -CAkey "$temp_dir/ca-key.pem" -CAcreateserial \
      -extfile "$temp_dir/server.ext" -out "$temp_dir/server.pem" >/dev/null 2>&1
    mv "$temp_dir/ca-key.pem" "$ca_key"
    mv "$temp_dir/ca.pem" "$ca_cert"
    mv "$temp_dir/server-key.pem" "$server_key"
    mv "$temp_dir/server.pem" "$server_cert"
    chmod 600 "$ca_key" "$server_key"
    chmod 644 "$ca_cert" "$server_cert"
    rm -rf "$temp_dir"
    trap - RETURN
  fi

  openssl verify -CAfile "$ca_cert" -verify_hostname host.docker.internal "$server_cert" >/dev/null
  export SCANNER_DEMO_CA_CERT="$ca_cert"
  export SCANNER_DEMO_TLS_CERT="$server_cert"
  export SCANNER_DEMO_TLS_KEY="$server_key"
}

wait_for_backend() {
  local backend_port
  backend_port="$(read_env_value BACKEND_PORT)"
  backend_port="${backend_port:-3000}"
  for attempt in $(seq 1 60); do
    if curl -fsS "http://localhost:${backend_port}/health" >/dev/null 2>&1; then
      return
    fi
    if [[ "$attempt" -eq 60 ]]; then
      docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" ps
      fail "backend did not become healthy"
    fi
    sleep 3
  done
}

seed_demo() {
  echo "==> Resetting manager demo data"
  docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" \
    run --rm --no-deps backend npm run seed:demo >/dev/null
}

login_manager() {
  local backend_port username password payload
  backend_port="$(read_env_value BACKEND_PORT)"
  backend_port="${backend_port:-3000}"
  username="$(read_env_value SEED_ADMIN_USERNAME)"
  password="$(read_env_value SEED_ADMIN_PASSWORD)"
  username="${username:-admin}"
  password="${password:-admin12345}"
  payload="$(jq -cn --arg username "$username" --arg password "$password" \
    '{username: $username, password: $password}')"
  AUTH_TOKEN="$(curl -fsS -H 'Content-Type: application/json' \
    --data "$payload" "http://127.0.0.1:${backend_port}/auth/login" | jq -er '.token')"
}

archive_inbox() {
  local archive="$RUN_ROOT/inbox-archive"
  mkdir -p "$SCANNER_DIR/scanner-inbox" "$archive"
  find "$SCANNER_DIR/scanner-inbox" -mindepth 1 -maxdepth 1 -type f \
    -exec mv {} "$archive"/ \;
  echo "    archived prior inbox files: $archive"
}

prepare_scanner_catalogue() {
  local backend_port raw_catalogue scanner_catalogue generated_input catalogue_item_id
  backend_port="$(read_env_value BACKEND_PORT)"
  backend_port="${backend_port:-3000}"
  raw_catalogue="$RUN_ROOT/manager-catalogue.json"
  scanner_catalogue="$RUN_ROOT/scanner-catalogue.json"
  generated_input="$RUN_ROOT/catalogue-generator"
  curl -fsS -H "Authorization: Bearer $AUTH_TOKEN" \
    "http://127.0.0.1:${backend_port}/menu/scanner-catalogue" > "$raw_catalogue"
  catalogue_item_id="$(jq -er '[.items[] | select(.active == true)][0].catalogueItemId' "$raw_catalogue")" || \
    fail "manager scanner catalogue has no active items"
  "$SCANNER_PYTHON" "$SCANNER_DIR/scripts/generate-demo-inbox.py" \
    --catalogue "$raw_catalogue" \
    --scanner-catalogue "$scanner_catalogue" \
    --item-id "$catalogue_item_id" \
    --output "$generated_input" >/dev/null
}

write_scanner_config() {
  local backend_port catalogue_version
  backend_port="$(read_env_value BACKEND_PORT)"
  backend_port="${backend_port:-3000}"
  catalogue_version="$(jq -er '.version' "$RUN_ROOT/manager-catalogue.json")"
  cat > "$RUN_ROOT/config.toml" <<EOF
[paths]
database = "$RUN_ROOT/state.sqlite3"
spool = "$RUN_ROOT/spool"
artifacts = "$RUN_ROOT/artifacts"
inbox = "$SCANNER_DIR/scanner-inbox"

[service]
workers = 1
callback_poll_interval_seconds = 0.25
recovery_interval_seconds = 2
disk_high_watermark_percent = 99
disk_low_watermark_percent = 98

[scanner]
stable_observations = 1
stable_seconds = 1
minimum_age_seconds = 1
poll_interval_seconds = 1
pdf_dpi = 150

[recognition]
enabled = true
auto_accept_enabled = false
model_name = 'latin_PP-OCRv5_mobile_rec'
cpu_threads = 2
minimum_item_score = 0.65
minimum_item_margin = 0.02
catalogue_path = "$RUN_ROOT/scanner-catalogue.json"

[callback]
url = "http://127.0.0.1:${backend_port}/webhooks/order-scanner"
token_env = 'CALLBACK_TOKEN'
artifact_token_env = 'ARTIFACT_TOKEN'
timeout_seconds = 10
retry_base_seconds = 1
retry_max_seconds = 10

[api]
enabled = true
bind_host = '127.0.0.1'
port = 8443
public_base_url = 'https://host.docker.internal:8443'
tls_cert_file = "$SCANNER_DEMO_TLS_CERT"
tls_key_file = "$SCANNER_DEMO_TLS_KEY"

[versions]
config_schema = '1'
callback_schema = '1.0-draft'
template = 'ticket-v4'
preprocessing = 'ticket-v4-provisional-v1'
model = 'paddleocr-latin-ppocrv5-mobile_rec-baseline'
thresholds = 'review-only-v1'
catalogue = '$catalogue_version'

[retention]
artifact_days = 30
audit_days = 365
EOF
  chmod 600 "$RUN_ROOT/config.toml"
}

start_scanner() {
  local callback_token artifact_token
  callback_token="$(read_env_value SCANNER_CALLBACK_TOKEN)"
  artifact_token="$(read_env_value SCANNER_ARTIFACT_TOKEN)"
  stop_scanner
  echo "==> Starting order-scanner"
  (
    cd "$SCANNER_DIR"
    CALLBACK_TOKEN="$callback_token" ARTIFACT_TOKEN="$artifact_token" \
      uv run order-scanner --verbose serve --config "$RUN_ROOT/config.toml"
  ) >"$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  for attempt in $(seq 1 90); do
    if curl -ksf "https://127.0.0.1:8443/ready" >/dev/null 2>&1; then
      return
    fi
    if ! kill -0 "$(<"$PID_FILE")" 2>/dev/null; then
      tail -80 "$LOG_FILE" >&2
      fail "order-scanner exited during startup"
    fi
    [[ "$attempt" -eq 90 ]] && break
    sleep 1
  done
  tail -80 "$LOG_FILE" >&2
  fail "order-scanner artifact API did not become ready"
}

main() {
  trap cleanup_on_exit EXIT
  require_command awk
  require_command curl
  require_command docker
  require_command openssl
  require_command jq
  require_command uv
  [[ -f "$ENV_FILE" ]] || fail "$ENV_FILE is missing; create the local demo environment first"
  [[ -d "$SCANNER_DIR/src/order_scanner" ]] || fail "order-scanner not found at $SCANNER_DIR"
  [[ -x "$SCANNER_PYTHON" ]] || fail "scanner Python not found at $SCANNER_PYTHON"

  local callback_token artifact_token
  callback_token="$(read_env_value SCANNER_CALLBACK_TOKEN)"
  artifact_token="$(read_env_value SCANNER_ARTIFACT_TOKEN)"
  [[ ${#callback_token} -ge 16 ]] || fail "SCANNER_CALLBACK_TOKEN is missing or too short"
  [[ ${#artifact_token} -ge 16 ]] || fail "SCANNER_ARTIFACT_TOKEN is missing or too short"
  [[ "$callback_token" != "$artifact_token" ]] || fail "scanner callback and artifact tokens must differ"

  mkdir -p "$DEMO_ROOT"
  stop_scanner
  ensure_demo_tls
  RUN_ROOT="$(mktemp -d "$DEMO_ROOT/run-$(date +%Y%m%d%H%M%S).XXXXXX")"
  chmod 700 "$RUN_ROOT"
  LOG_FILE="$RUN_ROOT/scanner.log"
  echo "==> Starting manager with demo-only scanner CA trust"
  docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" \
    up -d --build --force-recreate backend frontend
  wait_for_backend
  seed_demo
  archive_inbox
  login_manager
  prepare_scanner_catalogue
  write_scanner_config
  start_scanner
  echo "==> Generating the first random presentation order"
  ORDER_SCANNER_DIR="$SCANNER_DIR" ORDER_SCANNER_PYTHON="$SCANNER_PYTHON" \
    "$HERE/scanner-demo-order.sh"
  echo "==> Scanner demo flow is ready"
  echo "    artifact origin: https://host.docker.internal:8443"
  echo "    generated state: $RUN_ROOT"
  echo "    manager UI: http://localhost:8080/scan-monitor"
  echo "    verify UI: http://localhost:8080/verify"
  echo "    add another order: $HERE/scanner-demo-order.sh"
  echo "    scanner pid file: $PID_FILE"
  DEMO_READY=1
}

main "$@"
