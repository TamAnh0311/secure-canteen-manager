#!/usr/bin/env bash
# Generate one or more random demo orders and wait for their real scanner results.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANAGER_DIR="$(cd "$HERE/.." && pwd)"
SCANNER_DIR="${ORDER_SCANNER_DIR:-$MANAGER_DIR/../canteen/order-scanner}"
ENV_FILE="$HERE/.env"
SCANNER_PYTHON="${ORDER_SCANNER_PYTHON:-$SCANNER_DIR/.venv/bin/python}"
MAGICK_BIN="${MAGICK_BIN:-magick}"
PID_FILE="$SCANNER_DIR/var/demo/scanner.pid"
WAIT_ATTEMPTS="${SCANNER_DEMO_WAIT_ATTEMPTS:-180}"
WAIT_INTERVAL="${SCANNER_DEMO_WAIT_INTERVAL_SECONDS:-1}"
MAX_ORDER_COUNT="${SCANNER_DEMO_MAX_ORDER_COUNT:-20}"
AUTH_TOKEN=""
WORK_DIR=""
STAGED_FILE=""
LOCK_DIR=""
LOCK_ACQUIRED=0

usage() {
  cat <<'EOF'
Usage: deploy/scanner-demo-order.sh [--count N]

Create one or more random scanner-ready orders for the running local scanner
demo, wait for each real recognition/webhook/artifact result, and print selected
versus recognized values. Start the stack first with deploy/scanner-demo-up.sh.

Options:
  -n, --count N                       Orders to generate sequentially (default: 1)

Environment:
  ORDER_SCANNER_DIR                    Sibling order-scanner repository
  ORDER_SCANNER_PYTHON                 Scanner Python executable
  MAGICK_BIN                           ImageMagick executable
  SCANNER_DEMO_ORDER_COUNT             Default order count when no option is given
  SCANNER_DEMO_MAX_ORDER_COUNT         Maximum batch size (default: 20)
  SCANNER_DEMO_WAIT_ATTEMPTS           Poll attempts (default: 180)
  SCANNER_DEMO_WAIT_INTERVAL_SECONDS   Seconds between polls (default: 1)
EOF
}

parse_order_count() {
  local count="${SCANNER_DEMO_ORDER_COUNT:-1}"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -n|--count)
        [[ $# -ge 2 ]] || fail "$1 requires a positive integer"
        count="$2"
        shift 2
        ;;
      --count=*)
        count="${1#*=}"
        shift
        ;;
      *)
        fail "unknown option: $1"
        ;;
    esac
  done
  [[ "$count" =~ ^[1-9][0-9]*$ ]] || fail "order count must be a positive integer"
  [[ "$MAX_ORDER_COUNT" =~ ^[1-9][0-9]*$ ]] || fail "SCANNER_DEMO_MAX_ORDER_COUNT must be a positive integer"
  (( count <= MAX_ORDER_COUNT )) || fail "order count cannot exceed $MAX_ORDER_COUNT"
  printf '%s\n' "$count"
}

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

cleanup() {
  if [[ -n "$STAGED_FILE" && -e "$STAGED_FILE" ]]; then
    rm -f "$STAGED_FILE"
  fi
  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR"
  fi
  if [[ "$LOCK_ACQUIRED" -eq 1 && -n "$LOCK_DIR" && -d "$LOCK_DIR" ]]; then
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

acquire_order_lock() {
  local requested_lock="$1"
  local owner_pid=""
  LOCK_DIR="$requested_lock"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    if [[ -f "$LOCK_DIR/pid" ]]; then
      owner_pid="$(<"$LOCK_DIR/pid")"
    fi
    if [[ "$owner_pid" =~ ^[0-9]+$ ]] && kill -0 "$owner_pid" 2>/dev/null && \
      ps -p "$owner_pid" -o command= | grep -Fq "scanner-demo-order.sh"; then
      fail "another scanner demo order is already being generated; wait for it to finish"
    fi
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" 2>/dev/null || fail "stale scanner demo order lock could not be cleared: $LOCK_DIR"
    mkdir "$LOCK_DIR" || fail "scanner demo order lock could not be acquired: $LOCK_DIR"
  fi
  printf '%s\n' "$$" > "$LOCK_DIR/pid"
  LOCK_ACQUIRED=1
}

scanner_process_alive() {
  local pid
  [[ -f "$PID_FILE" ]] || return 0
  pid="$(<"$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  ps -p "$pid" -o command= | grep -Fq "order-scanner"
}

report_scanner_failure() {
  local latest_log
  latest_log="$(find "$SCANNER_DIR/var/demo" -maxdepth 2 -type f -name scanner.log -print 2>/dev/null | sort | tail -1)"
  if [[ -n "$latest_log" ]]; then
    echo "Scanner log tail:" >&2
    tail -80 "$latest_log" >&2
  fi
  fail "order-scanner stopped before delivering the random order"
}

select_random_order() {
  local users_json="$1"
  local catalogue_json="$2"
  local users items user_count item_count user_index item_index quantity user item

  users="$(jq -c '[.[] | select(
    .isActive == true and
    (.legacyId | type == "string") and
    (.legacyId | test("^[0-9]{6}$")) and
    (.cell | type == "string") and
    (.cell | test("^[A-Za-z0-9]{1,4}$"))
  )]' <<<"$users_json")"
  items="$(jq -c '[.items[]? | select(
    .active == true and
    (.catalogueItemId | type == "string") and
    (.name | type == "string")
  )]' <<<"$catalogue_json")"
  user_count="$(jq -r 'length' <<<"$users")"
  item_count="$(jq -r 'length' <<<"$items")"
  [[ "$user_count" -gt 0 ]] || fail "no active six-digit demo users with scanner-safe cells were found"
  [[ "$item_count" -gt 0 ]] || fail "no active scanner catalogue items were found"

  user_index=$((RANDOM % user_count))
  item_index=$((RANDOM % item_count))
  quantity=$((1 + RANDOM % 3))
  user="$(jq -c --argjson index "$user_index" '.[$index]' <<<"$users")"
  item="$(jq -c --argjson index "$item_index" '.[$index]' <<<"$items")"

  jq -cn \
    --argjson user "$user" \
    --argjson item "$item" \
    --argjson quantity "$quantity" \
    '{
      documentCode: $user.legacyId,
      userName: $user.name,
      room: $user.cell,
      itemId: $item.catalogueItemId,
      itemName: $item.name,
      quantity: $quantity
    }'
}

build_final_name() {
  local document_code="$1"
  printf 'demo-%s-%s-%05d-ticket-v4.pdf' \
    "$document_code" "$(date +%Y%m%d%H%M%S)" "$((RANDOM % 100000))"
}

login_manager() {
  local backend_port="$1"
  local username password payload
  username="$(read_env_value SEED_ADMIN_USERNAME)"
  password="$(read_env_value SEED_ADMIN_PASSWORD)"
  username="${username:-admin}"
  password="${password:-admin12345}"
  payload="$(jq -cn --arg username "$username" --arg password "$password" \
    '{username: $username, password: $password}')"
  AUTH_TOKEN="$(curl -fsS -H 'Content-Type: application/json' \
    --data "$payload" "http://127.0.0.1:${backend_port}/auth/login" | jq -er '.token')"
}

capture_baseline_scanner_ids() {
  local backend_port="$1"
  curl -fsS -H "Authorization: Bearer $AUTH_TOKEN" \
    "http://127.0.0.1:${backend_port}/scans?limit=100" | \
    jq -c '[.[] | select(.source == "scanner") | .id]'
}

wait_for_result() {
  local backend_port="$1"
  local baseline_ids_json="$2"
  local selection_json="$3"
  local order_label="${4:-}"
  local sheets candidates candidate_count candidate service_date result_id queue matched ready summary
  local expected_code expected_quantity
  expected_code="$(jq -er '.documentCode' <<<"$selection_json")"
  expected_quantity="$(jq -er '.quantity' <<<"$selection_json")"

  for _ in $(seq 1 "$WAIT_ATTEMPTS"); do
    scanner_process_alive || report_scanner_failure
    sheets="$(curl -fsS -H "Authorization: Bearer $AUTH_TOKEN" \
      "http://127.0.0.1:${backend_port}/scans?limit=100")"
    candidates="$(jq -c --argjson baseline "$baseline_ids_json" '
      [.[] | select(
        .source == "scanner" and
        (.id as $id | $baseline | index($id) | not)
      )] | sort_by(.createdAt)
    ' <<<"$sheets")"
    candidate_count="$(jq -r 'length' <<<"$candidates")"
    if [[ "$candidate_count" -gt 1 ]]; then
      fail "multiple unseen scanner results arrived after this order was staged; inspect the Verify queue and retry"
    fi
    candidate="$(jq -c '.[0] // empty' <<<"$candidates")"
    if [[ -n "$candidate" ]]; then
      service_date="$(jq -er '.serviceDate' <<<"$candidate")"
      result_id="$(jq -er '.sheetId' <<<"$candidate")"
      queue="$(curl -fsS -H "Authorization: Bearer $AUTH_TOKEN" \
        "http://127.0.0.1:${backend_port}/scans/verify/queue?dateFrom=${service_date}&dateTo=${service_date}")"
      matched="$(jq -c --arg result_id "$result_id" \
        '[.sheets[] | select(.source == "scanner" and .sheetId == $result_id)] | last // empty' \
        <<<"$queue")"
      if [[ -n "$matched" ]]; then
        ready="$(jq -r '
          (.scannerEvidence != null) and
          ((.scannerEvidence.artifacts | length) > 0) and
          ([.scannerEvidence.artifacts[].state] | all(. == "available")) and
          (.scannerEvidence.reviewState == "ready" or .scannerEvidence.reviewState == "needs_review") and
          (([.identityEvidence[] | select(.field == "prisoner_id")][0].rawText // "") == $expected_code) and
          ((.orderLines[0].qty // -1) == $expected_quantity)
        ' --arg expected_code "$expected_code" --argjson expected_quantity "$expected_quantity" <<<"$matched")"
        if [[ "$ready" == "true" ]]; then
          summary="$(jq -cn \
            --argjson selected "$selection_json" \
            --argjson scan "$candidate" \
            --argjson sheet "$matched" \
            '{
              selected: $selected,
              scan: {
                scanId: $scan.id,
                sheetId: $scan.sheetId,
                serviceDate: $scan.serviceDate,
                status: $scan.status,
                blockers: $scan.scannerReviewBlockers
              },
              recognized: {
                documentCode: ([$sheet.identityEvidence[] | select(.field == "prisoner_id")][0].rawText // null),
                room: ([$sheet.identityEvidence[] | select(.field == "cell")][0].rawText // null),
                matchedLegacyId: ($sheet.rankedCandidates[0].legacyId // $sheet.identity.legacyId // null),
                itemId: ($sheet.orderLines[0].code // $sheet.scannerEvidence.items[0].catalogueItemId // null),
                itemRawText: ($sheet.scannerEvidence.items[0].itemRawText // null),
                quantity: ($sheet.orderLines[0].qty // null),
                quantityRawText: ($sheet.scannerEvidence.items[0].quantityRawText // null)
              },
              result: {
                outcome: $sheet.scannerEvidence.outcome,
                reviewState: $sheet.scannerEvidence.reviewState,
                resultId: $sheet.scannerEvidence.resultId,
                documentId: $sheet.scannerEvidence.documentId,
                artifactsAvailable: ($sheet.scannerEvidence.artifacts | length)
              }
            }')"
          echo "==> Real scanner result received${order_label:+ ($order_label)}"
          jq -r '
            "    selected: \(.selected.documentCode) \(.selected.userName) | cell \(.selected.room) | \(.selected.itemId) \(.selected.itemName) x\(.selected.quantity)",
            "    recognized: id \(.recognized.documentCode // "unresolved") | cell \(.recognized.room // "unresolved") | item \(.recognized.itemId // "unresolved") | qty \(.recognized.quantity // "unresolved")",
            "    result: \(.result.outcome)/\(.result.reviewState) | scan \(.scan.scanId) | sheet \(.scan.sheetId) | artifacts \(.result.artifactsAvailable)"
          ' <<<"$summary"
          echo "    scan monitor: http://localhost:8080/scan-monitor"
          echo "    verify: http://localhost:8080/verify"
          printf '%s\n' "$summary"
          return
        fi
      fi
    fi
    scanner_process_alive || report_scanner_failure
    sleep "$WAIT_INTERVAL"
  done

  if [[ -n "${candidate:-}" ]]; then
    echo "Last new scanner sheet:" >&2
    jq . <<<"$candidate" >&2
  fi
  fail "timed out waiting for a real scanner result with available artifacts"
}

generate_one_order() {
  local backend_port="$1"
  local order_label="$2"
  local users_json="$3"
  local catalogue_json="$4"
  local selection_json baseline_ids_json
  local document_code room item_id quantity generation_dir generated_pdf final_name final_path

  selection_json="$(select_random_order "$users_json" "$catalogue_json")"
  generation_dir="$WORK_DIR/generated-${order_label//\//-}"
  document_code="$(jq -er '.documentCode' <<<"$selection_json")"
  room="$(jq -er '.room' <<<"$selection_json")"
  item_id="$(jq -er '.itemId' <<<"$selection_json")"
  quantity="$(jq -er '.quantity' <<<"$selection_json")"

  ORDER_SCANNER_PYTHON="$SCANNER_PYTHON" MAGICK_BIN="$MAGICK_BIN" \
    "$SCANNER_DIR/scripts/generate-demo-pdf.sh" \
      --catalogue "$WORK_DIR/manager-catalogue.json" \
      --output "$generation_dir" \
      --document-code "$document_code" \
      --room "$room" \
      --item-id "$item_id" \
      --quantity "$quantity" >/dev/null
  generated_pdf="$generation_dir/demo-${document_code}-ticket-v4.pdf"
  [[ -f "$generated_pdf" ]] || fail "scanner PDF generator did not create the expected file"

  # Capture the baseline immediately before publication so this order's result
  # can be correlated independently from earlier orders in the same batch.
  baseline_ids_json="$(capture_baseline_scanner_ids "$backend_port")"
  for _ in $(seq 1 10); do
    final_name="$(build_final_name "$document_code")"
    final_path="$SCANNER_DIR/scanner-inbox/$final_name"
    [[ ! -e "$final_path" ]] && break
  done
  [[ ! -e "$final_path" ]] || fail "could not allocate a unique scanner inbox filename"
  STAGED_FILE="$(mktemp "$SCANNER_DIR/scanner-inbox/.${final_name}.staging.XXXXXX")"
  cp "$generated_pdf" "$STAGED_FILE"
  mv "$STAGED_FILE" "$final_path"
  STAGED_FILE=""
  echo "==> [$order_label] Published random scanner order: $final_path"

  wait_for_result "$backend_port" "$baseline_ids_json" "$selection_json" "$order_label"
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi
  local order_count
  order_count="$(parse_order_count "$@")"

  trap cleanup EXIT
  require_command awk
  require_command curl
  require_command jq
  require_command ps
  require_command seq
  [[ -f "$ENV_FILE" ]] || fail "$ENV_FILE is missing; configure the local demo environment first"
  [[ -d "$SCANNER_DIR/src/order_scanner" ]] || fail "order-scanner not found at $SCANNER_DIR"
  [[ -x "$SCANNER_PYTHON" ]] || fail "scanner Python not found at $SCANNER_PYTHON"
  [[ -x "$SCANNER_DIR/scripts/generate-demo-pdf.sh" ]] || fail "scanner PDF generator is missing or not executable"
  [[ "$WAIT_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || fail "SCANNER_DEMO_WAIT_ATTEMPTS must be a positive integer"
  [[ "$WAIT_INTERVAL" =~ ^[0-9]+([.][0-9]+)?$ ]] || fail "SCANNER_DEMO_WAIT_INTERVAL_SECONDS must be a non-negative number"

  local backend_port users_json catalogue_json
  backend_port="$(read_env_value BACKEND_PORT)"
  backend_port="${backend_port:-3000}"
  curl -fsS "http://127.0.0.1:${backend_port}/health" >/dev/null || \
    fail "manager backend is not ready on port $backend_port"
  curl -ksf "https://127.0.0.1:8443/ready" >/dev/null || \
    fail "order-scanner is not ready; run deploy/scanner-demo-up.sh first"

  mkdir -p "$SCANNER_DIR/var/demo" "$SCANNER_DIR/scanner-inbox"
  acquire_order_lock "$SCANNER_DIR/var/demo/order-generation.lock"

  login_manager "$backend_port"
  users_json="$(curl -fsS -H "Authorization: Bearer $AUTH_TOKEN" \
    "http://127.0.0.1:${backend_port}/users?limit=200")"
  catalogue_json="$(curl -fsS -H "Authorization: Bearer $AUTH_TOKEN" \
    "http://127.0.0.1:${backend_port}/menu/scanner-catalogue")"
  WORK_DIR="$(mktemp -d "$SCANNER_DIR/var/demo/order-generation.XXXXXX")"
  chmod 700 "$WORK_DIR"
  printf '%s\n' "$catalogue_json" > "$WORK_DIR/manager-catalogue.json"
  for order_index in $(seq 1 "$order_count"); do
    generate_one_order "$backend_port" "$order_index/$order_count" "$users_json" "$catalogue_json"
  done
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
