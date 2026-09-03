# Canteen System — Deployment Guide

> Step-by-step deployment instructions for the Canteen Manager (Docker Compose) and Order Scanner (Ansible/systemd) on an air-gapped site.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Network Topology](#2-network-topology)
3. [Canteen Manager Deployment](#3-canteen-manager-deployment)
   - [Phase 1: Build (Internet Machine)](#phase-1-build-internet-machine)
   - [Phase 2: Bundle & Transfer](#phase-2-bundle--transfer)
   - [Phase 3: Load & Start (Air-Gapped Site)](#phase-3-load--start-air-gapped-site)
4. [Order Scanner Deployment](#4-order-scanner-deployment)
   - [Phase 1: Prepare (Internet Machine)](#phase-1-prepare-internet-machine)
   - [Phase 2: Deploy via Ansible](#phase-2-deploy-via-ansible)
5. [Configuration Reference](#5-configuration-reference)
6. [Post-Deployment Verification](#6-post-deployment-verification)
7. [Demo Environment](#7-demo-environment)
8. [Operations & Maintenance](#8-operations--maintenance)
9. [Troubleshooting](#9-troubleshooting)
10. [Rollback Procedures](#10-rollback-procedures)

---

## 1. Prerequisites

### Canteen Manager (Docker host)

| Requirement | Minimum |
|-------------|---------|
| OS | Linux (amd64) with Docker Engine 24+ |
| Docker Compose | v2.20+ |
| RAM | 4 GB |
| Disk | 20 GB (+ scan storage) |
| Network | LAN access for clients; **no internet required at site** |

### Order Scanner (bare metal)

| Requirement | Minimum |
|-------------|---------|
| OS | Ubuntu 22.04+ or Debian 12+ (x86_64 only) |
| CPU | x86_64 (PaddleOCR requires it) |
| RAM | 4 GB (8 GB recommended for OCR) |
| Disk | 10 GB (+ scan artifacts) |
| Python | 3.11+ (installed by Ansible) |
| Network | LAN access to canteen backend; Samba port 445 for scanner hardware |

### Build Machine (internet access)

| Requirement | Details |
|-------------|---------|
| Docker | For building canteen-manager images |
| Ansible | 2.14+ for scanner deployment |
| Git | Source code access |
| `uv` | Python package manager (for scanner) |
| Internet | Required only during build phase |

---

## 2. Network Topology

```
┌─────────────────────────────────────────────────────────┐
│                    LAN (Air-Gapped)                      │
│                                                          │
│  ┌────────────────┐         ┌────────────────────┐      │
│  │ Canteen Server  │         │  Scanner Server    │      │
│  │                 │◀────────│                    │      │
│  │ :8080 (UI)     │ webhook │ :445 (Samba)       │      │
│  │ :3000 (API)*   │         │                    │      │
│  └───────┬────────┘         └────────┬───────────┘      │
│          │                           │                   │
│          │                    ┌──────┴──────┐            │
│     ┌────┴────┐               │  Scanner    │            │
│     │ Clients │               │  Hardware   │            │
│     │ (Browser│               │  (Samba)    │            │
│     │  :8080) │               └─────────────┘            │
│     └─────────┘                                          │
└─────────────────────────────────────────────────────────┘

* Port 3000 bound to 127.0.0.1 only — LAN clients access via Nginx on :8080
```

**Firewall rules required:**

| From | To | Port | Purpose |
|------|----|------|---------|
| LAN clients | Canteen Server | 8080/tcp | Frontend UI + API proxy |
| Scanner Server | Canteen Server | 8080/tcp | Webhook callbacks via Nginx |
| Scanner Hardware | Scanner Server | 445/tcp | Samba file share |

---

## 3. Canteen Manager Deployment

### Phase 1: Build (Internet Machine)

**Step 1: Clone source and navigate to deploy directory.**

```bash
cd canteen-manager/deploy
```

**Step 2: Build all Docker images.**

```bash
docker compose build
```

This builds four images:
- `canteen-backend:local` — NestJS API (multi-stage: deps → builder → runtime)
- `canteen-frontend:local` — React app served by Nginx
- `canteen-omr-service:local` — Python OMR recognition
- `canteen-scan-agent:local` — File-based scan uploader

Plus pulls:
- `postgres:16-alpine`

**Step 3: Export images to tarballs.**

```bash
mkdir -p bundle/images

docker save canteen-backend:local    -o bundle/images/canteen-backend.tar
docker save canteen-frontend:local   -o bundle/images/canteen-frontend.tar
docker save canteen-omr-service:local -o bundle/images/canteen-omr-service.tar
docker save canteen-scan-agent:local -o bundle/images/canteen-scan-agent.tar
docker save postgres:16-alpine       -o bundle/images/postgres-16-alpine.tar
```

**Step 4: Generate checksums.**

```bash
cd bundle
sha256sum images/*.tar > checksums.sha256
```

**Step 5 (optional): Sign the checksums.**

```bash
gpg --detach-sign --armor checksums.sha256
```

**Step 6: Copy deployment files into the bundle.**

```bash
cp ../docker-compose.yml .
cp ../up.sh .
cp ../verify-and-load.sh .
cp ../.env.example .
chmod +x up.sh verify-and-load.sh
```

**Step 7: Transfer the bundle to the air-gapped site** via USB drive, secure file transfer, or other approved method.

### Phase 2: Bundle & Transfer

The bundle directory should contain:

```
bundle/
├── checksums.sha256
├── checksums.sha256.asc    (optional GPG signature)
├── docker-compose.yml
├── up.sh
├── verify-and-load.sh
├── .env.example
└── images/
    ├── canteen-backend.tar
    ├── canteen-frontend.tar
    ├── canteen-omr-service.tar
    ├── canteen-scan-agent.tar
    └── postgres-16-alpine.tar
```

### Phase 3: Load & Start (Air-Gapped Site)

**Step 1: Copy bundle to the canteen server.**

```bash
# Example: from USB
cp -r /mnt/usb/bundle /opt/canteen/
cd /opt/canteen/bundle
```

**Step 2: Verify integrity and load images.**

```bash
./verify-and-load.sh
```

This script:
1. Verifies GPG signature (if `.asc` present)
2. Checks SHA-256 checksums of all tarballs
3. Loads each image via `docker load`
4. **Fails closed** — rejects the entire bundle if any checksum fails

**Step 3: Configure environment.**

```bash
cp .env.example .env
```

Edit `.env` and set **all required values**:

```bash
# REQUIRED — change these from defaults
POSTGRES_PASSWORD=<strong-random-password>
JWT_SECRET=<min-32-char-random-string>

# REQUIRED for production
AGENT_TOKEN=<min-16-char-random-string>
SCAN_RETENTION_DAYS=30

# Scanner integration (if using scanner_webhook mode)
SCANNER_CALLBACK_TOKEN=<matching-token-on-scanner>
SCANNER_ARTIFACT_TOKEN=<artifact-access-token>
SCANNER_ARTIFACT_ORIGIN=http://scanner-server:port

# Adjust ports if needed
BACKEND_PORT=3000
FRONTEND_PORT=8080
```

**Step 4: Start the stack.**

```bash
./up.sh
```

This runs `docker compose up -d --pull never --no-build`, which:
1. Starts PostgreSQL and waits for health check
2. Runs one-shot migration container (applies schema, then exits)
3. Starts OMR service
4. Starts backend (waits for postgres healthy + migrations complete)
5. Starts frontend Nginx (waits for backend healthy)
6. Starts scan-agent (waits for backend healthy)

**Step 5: Verify deployment.**

```bash
# Check all services are running
docker compose ps

# Check backend health
curl -f http://localhost:3000/health

# Check frontend is accessible
curl -f http://localhost:8080/

# Watch logs
docker compose logs -f
```

---

## 4. Order Scanner Deployment

### Phase 1: Prepare (Internet Machine)

**Step 1: Review and customise Ansible variables.**

Edit `scanner/deploy/ansible/deploy.yml` variables section:

```yaml
vars:
  app_source: /opt/order-scanner
  config_dir: /etc/order-scanner
  data_root: /var/lib/order-scanner
  inbox_root: /srv/samba/order-scanner-inbox
  service_user: order-scanner
  service_group: order-scanner
  samba_user: scanner-share
  samba_allowed_networks: "192.168.1.0/24"   # <-- adjust for your LAN
  recognition_model_name: "PP-OCRv6_medium_rec"
  recognition_model_version: "PP-OCRv6-medium-rec-v1"
```

**Step 2: Update inventory with target host.**

Edit `scanner/deploy/ansible/inventory.ini`:

```ini
[scanner]
scanner-host ansible_host=10.0.0.50 ansible_user=deploy

[all:vars]
ansible_python_interpreter=/usr/bin/python3
```

**Step 3: Set the Samba password.**

```bash
export SAMBA_PASSWORD="<strong-password-for-scanner-share>"
```

### Phase 2: Deploy via Ansible

**Step 1: Run the playbook.**

```bash
cd scanner/deploy/ansible
ansible-playbook -i inventory.ini deploy.yml \
  -e "samba_password=$SAMBA_PASSWORD" \
  --ask-become-pass
```

The playbook performs:
1. Installs host packages (acl, rsync, samba, curl, build-essential, tzdata)
2. Creates `order-scanner` service user and `scanner-share` Samba user
3. Installs `uv` package manager
4. Creates application and data directories with correct ownership
5. Copies application source (src, migrations, pyproject.toml, uv.lock)
6. Installs Python runtime: `uv sync --frozen --no-dev --extra paddleocr`
7. Downloads PaddleOCR PP-OCRv6 model files from HuggingFace (with SHA-256 verification)
8. Generates a random callback token (48 chars)
9. Installs systemd service unit and TOML config
10. Configures Samba share and firewall (port 445/tcp)
11. Enables and starts `order-scanner.service` and `smbd.service`

**Step 2: Note the generated callback token.**

After Ansible completes, retrieve the token:

```bash
ssh deploy@scanner-host "sudo cat /etc/order-scanner/callback-token"
```

**Step 3: Configure the canteen backend to accept this token.**

On the canteen server, update `.env`:

```bash
SCAN_WORKFLOW_MODE=scanner_webhook
SCANNER_CALLBACK_TOKEN=<token-from-step-2>
```

Then restart the backend:

```bash
docker compose restart backend
```

**Step 4: Configure scanner callback URL.**

On the scanner server, verify `/etc/order-scanner/config.toml` points to the canteen backend:

```toml
[callback]
url = "http://canteen-server:8080/api/webhooks/order-scanner"
token_file = "/etc/order-scanner/callback-token"
```

Restart if changed:

```bash
sudo systemctl restart order-scanner
```

---

## 5. Configuration Reference

### Canteen Manager `.env` — Full Variable List

```bash
# ── PostgreSQL ──────────────────────────────────────────
POSTGRES_USER=canteen
POSTGRES_PASSWORD=                    # REQUIRED: strong random password
POSTGRES_DB=canteen
DATABASE_URL=postgresql://canteen:<password>@postgres:5432/canteen

# ── Backend ─────────────────────────────────────────────
BACKEND_PORT=3000
JWT_SECRET=                           # REQUIRED: min 32 chars
APP_TZ=Asia/Saigon                    # IANA timezone

# ── Seed (demo/initial setup) ──────────────────────────
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=admin12345        # Change in production!

# ── Production requirements ─────────────────────────────
AGENT_TOKEN=                          # REQUIRED prod: min 16 chars
SCAN_RETENTION_DAYS=30                # REQUIRED prod: positive integer

# ── Scan workflow ───────────────────────────────────────
SCAN_WORKFLOW_MODE=legacy_omr         # legacy_omr | scanner_shadow | scanner_webhook
SCANNER_CALLBACK_TOKEN=               # Required if scanner_webhook mode
SCANNER_ARTIFACT_TOKEN=               # Required if scanner_shadow/webhook
SCANNER_ARTIFACT_ORIGIN=              # Required if scanner_shadow/webhook
SCANNER_WEBHOOK_MAX_PAYLOAD_BYTES=524288
SCANNER_ARTIFACT_MAX_BYTES=10485760
SCANNER_ARTIFACT_TIMEOUT_MS=15000
SCANNER_ARTIFACT_RETENTION_DAYS=
SCANNER_SERVICE_DATE_MAX_PAST_DAYS=
SCANNER_SERVICE_DATE_MAX_FUTURE_DAYS=

# ── OMR service ─────────────────────────────────────────
OMR_OPERATIONAL_FORM_MODE=issued      # issued | generic
OMR_OPERATIONAL_FORM_GENERATION=issued-v1
OMR_EMPTY_MAX=0.30
OMR_TICKED_MIN=0.70
ICR_CONFIDENCE_THRESHOLD=0.85
DIGIT_BOX_COUNT=6
OMR_DPI=300
ONNX_MODEL_PATH=models/mnist_digits.onnx
HANDWRITING_MODEL_DIR=models/handwriting
HANDWRITING_CONFIDENCE_THRESHOLD=0.25
HANDWRITING_BLANK_INK_RATIO=0.008
HANDWRITING_MAX_TOKENS=32
FONTS_DIR=fonts

# ── Frontend ────────────────────────────────────────────
FRONTEND_PORT=8080

# ── Legacy SQL Server sync (all optional) ───────────────
# LEGACY_SQL_HOST=
# LEGACY_SQL_PORT=1433
# LEGACY_SQL_USER=
# LEGACY_SQL_PASSWORD=
# LEGACY_SQL_DATABASE=
# LEGACY_SQL_ENCRYPT=false
# LEGACY_SQL_TRUST_CERT=false
```

### Scanner `config.toml` — Production Template

```toml
[paths]
database = "/var/lib/order-scanner/state/order-scanner.sqlite3"
spool    = "/var/lib/order-scanner/spool"
artifacts = "/var/lib/order-scanner/artifacts"
inbox    = "/srv/samba/order-scanner-inbox"

[service]
workers           = 1
sqlite_timeout_ms = 5000
lease_duration_s  = 300
recovery_interval_s = 60
poll_interval_s   = 5

[limits]
max_file_bytes    = 52428800    # 50 MB
max_pages         = 100
max_pixel_count   = 50000000
max_quantity      = 999
max_room_code_len = 4
max_payload_bytes = 524288

[scanner]
timezone          = "Asia/Ho_Chi_Minh"
file_extensions   = ["pdf", "png", "jpg", "jpeg", "tiff"]
polling_interval_s = 5
pdf_render_dpi    = 300

[recognition]
enabled           = true
backend           = "paddleocr"
model_name        = "PP-OCRv6_medium_rec"
model_dir         = "/opt/order-scanner/models/PP-OCRv6_medium_rec"
auto_accept       = true
catalogue_path    = "/opt/order-scanner/scanner-catalogue.json"
cpu_threads       = 4

[callback]
url               = "http://canteen-server:8080/api/webhooks/order-scanner"
token_file        = "/etc/order-scanner/callback-token"
timeout_s         = 10
retry_base_s      = 2
retry_max_s       = 300

[api]
enabled           = false

[retention]
artifacts_days    = 30
audit_days        = 365

[versions]
config            = "v1"
callback_schema   = "1.0-draft"
template          = "ticket-skm-v1"
```

---

## 6. Post-Deployment Verification

### Canteen Manager Checklist

```bash
# 1. All containers running
docker compose ps
# Expected: postgres (healthy), backend (healthy), frontend (healthy),
#           omr-service (healthy), scan-agent (running)
#           migrate (exited 0)

# 2. Backend health endpoint
curl -f http://localhost:3000/health
# Expected: {"status":"ok"} or similar

# 3. Frontend accessible
curl -sf http://localhost:8080/ | head -5
# Expected: HTML content

# 4. API proxy works through Nginx
curl -f http://localhost:8080/api/health
# Expected: same as backend health

# 5. Login works
curl -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin12345"}'
# Expected: JWT token in response

# 6. Database has schema
docker compose exec postgres psql -U canteen -c '\dt'
# Expected: list of tables

# 7. Check logs for errors
docker compose logs --tail=50 backend | grep -i error
docker compose logs --tail=50 omr-service | grep -i error
```

### Order Scanner Checklist

```bash
# 1. Service running
sudo systemctl status order-scanner
# Expected: active (running)

# 2. Samba share accessible
smbclient //localhost/order-scanner-inbox -U scanner-share -c 'ls'
# Expected: directory listing

# 3. Database initialised
sudo -u order-scanner /opt/order-scanner/.venv/bin/order-scanner \
  status --config /etc/order-scanner/config.toml
# Expected: JSON with empty job counts

# 4. Callback connectivity (from scanner to canteen)
curl -f http://canteen-server:8080/api/health
# Expected: health response

# 5. Check logs
sudo journalctl -u order-scanner --no-pager -n 50
```

### Integration Verification

```bash
# 1. Place a test file in scanner inbox
# (from a machine with Samba access)
smbclient //scanner-server/order-scanner-inbox -U scanner-share \
  -c 'put test-scan.pdf'

# 2. Watch scanner logs for processing
sudo journalctl -u order-scanner -f

# 3. Check canteen backend logs for webhook receipt
docker compose logs -f backend | grep -i webhook

# 4. Verify order created in system
curl -H "Authorization: Bearer <jwt>" \
  http://localhost:8080/api/orders?date=today
```

---

## 7. Demo Environment

For local development or sales demos (requires internet for image builds):

```bash
cd canteen-manager/deploy
./demo-up.sh
```

This script:
1. Creates `.env` from `.env.example` if missing
2. Builds all images from source
3. Starts the full stack
4. Waits for backend health check
5. Loads the Vietnamese demo dataset (employees, menu, orders, flagged sheets)

**Demo credentials** are printed by the seed script (defaults: `admin` / `admin12345`).

**Demo URLs:**
- Frontend: `http://localhost:8080`
- Backend health: `http://localhost:3000/health`

**Demo management:**

```bash
# Reset demo data (re-runnable)
docker compose run --rm --no-deps backend npm run seed:demo

# Stop (keep data)
docker compose down

# Wipe (delete all data)
docker compose down -v
```

---

## 8. Operations & Maintenance

### Routine Operations

**View logs:**
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f omr-service

# Scanner
sudo journalctl -u order-scanner -f
```

**Restart services:**
```bash
# Single service
docker compose restart backend

# Full stack
docker compose down && ./up.sh

# Scanner
sudo systemctl restart order-scanner
```

**Database backup:**
```bash
# PostgreSQL dump
docker compose exec postgres pg_dump -U canteen canteen > backup-$(date +%F).sql

# Restore
docker compose exec -T postgres psql -U canteen canteen < backup-2026-09-01.sql
```

**Scanner SQLite backup:**
```bash
sudo cp /var/lib/order-scanner/state/order-scanner.sqlite3 \
  /backup/scanner-$(date +%F).sqlite3
```

### Updating the System

**Canteen Manager update (air-gapped):**

1. Build new images on internet machine
2. Export to tarballs, generate checksums
3. Transfer bundle to site
4. On site:
   ```bash
   ./verify-and-load.sh        # Load new images
   docker compose down          # Stop current stack
   ./up.sh                      # Start with new images
   ```
   Migrations run automatically on startup.

**Scanner update:**

1. Update source code on internet machine
2. Re-run Ansible playbook:
   ```bash
   ansible-playbook -i inventory.ini deploy.yml --ask-become-pass
   ```
   The playbook copies new source, reinstalls dependencies, and restarts the service.

### Disk Space Management

**Canteen Manager:**
```bash
# Check scan storage usage
docker compose exec backend du -sh /app/data/scans

# Check database size
docker compose exec postgres psql -U canteen -c \
  "SELECT pg_size_pretty(pg_database_size('canteen'));"

# Prune old Docker resources
docker system prune -f
```

**Scanner:**
```bash
# Check artifact storage
du -sh /var/lib/order-scanner/artifacts

# Check spool
du -sh /var/lib/order-scanner/spool

# Disk pressure pauses intake at 90%, resumes at 80%
df -h /var/lib/order-scanner
```

> **Note:** Scan retention auto-purge is not yet implemented. Manual cleanup may be required. Delete artifacts older than `SCAN_RETENTION_DAYS`:
> ```bash
> find /var/lib/order-scanner/artifacts -type f -mtime +30 -delete
> ```

---

## 9. Troubleshooting

### Common Issues

#### Backend won't start — "missing tables"

**Cause:** Migration container failed or didn't run.

```bash
# Check migration exit code
docker compose ps migrate
# Expected: Exited (0)

# View migration logs
docker compose logs migrate

# Re-run manually
docker compose run --rm migrate
```

#### Backend refuses to start in production — env validation error

**Cause:** Missing required production environment variables.

```bash
# Check which variables are missing
docker compose logs backend | grep -i "validation\|missing\|required"
```

Ensure these are set in `.env`:
- `AGENT_TOKEN` (min 16 chars)
- `SCAN_RETENTION_DAYS` (positive integer)
- `SCANNER_CALLBACK_TOKEN` (if `SCAN_WORKFLOW_MODE=scanner_webhook`)

#### Frontend shows blank page or API errors

**Cause:** Nginx not proxying `/api/` correctly, or backend not healthy.

```bash
# Test API through Nginx
curl -v http://localhost:8080/api/health

# Test backend directly
curl -v http://localhost:3000/health

# Check nginx config is loaded
docker compose exec frontend cat /etc/nginx/conf.d/default.conf
```

#### Scanner webhook not reaching backend

**Cause:** Network, token mismatch, or wrong callback URL.

```bash
# Test connectivity from scanner to canteen
curl -v http://canteen-server:8080/api/health

# Verify tokens match
# On scanner:
sudo cat /etc/order-scanner/callback-token
# On canteen .env:
grep SCANNER_CALLBACK_TOKEN .env

# Check scanner logs for delivery errors
sudo journalctl -u order-scanner | grep -i "callback\|error\|401\|403"
```

#### OMR service unhealthy

**Cause:** Slow model loading (can take 60s+) or OOM.

```bash
# Check health and logs
docker compose logs omr-service

# Verify health endpoint
docker compose exec omr-service python3 -c \
  "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/health').read())"
```

#### Scanner Samba share not accessible

```bash
# Check Samba is running
sudo systemctl status smbd

# Test locally
smbclient //localhost/order-scanner-inbox -U scanner-share -c 'ls'

# Check firewall
sudo ufw status | grep 445

# Check Samba config
testparm /etc/samba/smb.conf
```

#### Scanner "service_date_missing" permanent failures

**Cause:** Jobs created before migration 004 have NULL `service_date`. By design, these fail permanently — the scanner never guesses business dates.

**Fix:** These jobs cannot be recovered. The original files must be re-scanned (place them back in the inbox).

---

## 10. Rollback Procedures

### Canteen Manager Rollback

**Scenario:** New image version has a bug.

```bash
# 1. Stop the stack
docker compose down

# 2. Load previous bundle
cd /opt/canteen/previous-bundle
./verify-and-load.sh

# 3. Start with old images
./up.sh
```

> **Warning:** If a new migration was applied, rolling back the images alone may cause schema mismatches. Restore the database from backup first:
> ```bash
> docker compose up -d postgres
> docker compose exec -T postgres psql -U canteen canteen < backup-before-update.sql
> ./up.sh
> ```

### Scanner Rollback

**Scenario:** New scanner version has a bug.

```bash
# 1. Stop the service
sudo systemctl stop order-scanner

# 2. Restore previous source
sudo cp -r /opt/order-scanner.backup/* /opt/order-scanner/

# 3. Reinstall dependencies
cd /opt/order-scanner
sudo -u order-scanner .venv/bin/uv sync --frozen --no-dev --extra paddleocr

# 4. Restart
sudo systemctl start order-scanner
```

> **Tip:** Before any update, create a backup:
> ```bash
> sudo cp -r /opt/order-scanner /opt/order-scanner.backup
> sudo cp /var/lib/order-scanner/state/order-scanner.sqlite3 \
>   /var/lib/order-scanner/state/order-scanner.sqlite3.backup
> ```

---

## Appendix: Service Ports Summary

| Service | Port | Bind | Protocol | Purpose |
|---------|------|------|----------|---------|
| Frontend (Nginx) | 8080 | 0.0.0.0 | HTTP | UI + API proxy (LAN-facing) |
| Backend (NestJS) | 3000 | 127.0.0.1 | HTTP | API (loopback only) |
| PostgreSQL | 55433 | 0.0.0.0 | TCP | Database (host diagnostics) |
| OMR Service | 8000 | internal | HTTP | Recognition (Docker network only) |
| Samba (Scanner) | 445 | 0.0.0.0 | SMB | Scanner file share |

## Appendix: Docker Compose Service Dependency Graph

```
postgres (healthy)
    └── migrate (completed)
            └── backend (healthy)
                    ├── frontend
                    └── scan-agent
    omr-service (started)
            └── backend
```

## Appendix: Systemd Service (Scanner)

```
order-scanner.service
  Type:          simple
  User:          order-scanner
  Restart:       on-failure (10s delay)
  Security:      NoNewPrivileges, PrivateTmp, ProtectSystem=strict, ProtectHome
  ReadOnly:      /opt/order-scanner, /etc/order-scanner, /srv/samba/order-scanner-inbox
  ReadWrite:     /var/lib/order-scanner
  StopTimeout:   45s
```
