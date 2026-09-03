---
name: project-api-prefix-contract
description: Frontend uses /api base but backend serves at root — proxy must strip /api; prod nginx currently does not
metadata:
  type: project
---

Frontend `src/lib/api-client.ts` calls `/api/*`. Backend (`backend/src/main.ts`) has **no** `setGlobalPrefix` — it serves routes at root (`/sessions`, `/auth/login`, etc.).

The `/api` prefix exists only so the SPA can be reverse-proxied behind one path. The proxy MUST rewrite `^/api` → ``.

- Vite dev proxy (`frontend/vite.config.ts`) does this correctly (`rewrite: p => p.replace(/^\/api/, '')`, target `localhost:3000`).
- Production `frontend/nginx.conf` does NOT — it has only a SPA fallback and no `location /api` proxy block to `backend:3000`. `deploy/docker-compose.yml` puts frontend (nginx :80) and backend (:3000) on separate origins with no gateway. So production API calls return index.html / fail.

**Why:** air-gapped kiosk deploy; browser can only reach the frontend container's origin.
**How to apply:** when reviewing deploy/nginx/proxy changes, verify the `/api`-strip rule survives. When backend route base changes, check both vite proxy and nginx.
