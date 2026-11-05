# Maintenance Management System

This is a modular hexagonal monolith with an offline-first sync API. It implements two modules:
**Attendance** (check-in/check-out) and **Execution and Evidence** (activities and photos).

- Step 1: environment and database. Done.
- Step 2: NestJS backend. Done.
- Step 3: React PWA with IndexedDB. Done.

## Stack

| Service    | Image / tech             | Purpose                                                         |
|------------|--------------------------|-----------------------------------------------------------------|
| PostgreSQL | `postgres:16-alpine`     | Source of truth (ACID, UNIQUE `client_uuid`)                    |
| Redis      | `redis:7-alpine`         | Domain-event fan-out to SSE. Not a source of truth              |
| MinIO      | `pgsty/minio`            | Photo storage (S3 API). Only the object key goes in the DB      |
| Backend    | NestJS 11, Prisma 6, TS  | REST API, profile `app`                                         |
| PWA        | React 19, Vite 7, Dexie 4, served by `nginx:1.28-alpine` | Operator app (offline-first) and supervisor monitor, profile `app` |

The official `minio/minio` image is no longer on Docker Hub. `pgsty/minio` is a community build of the same open-source server.

## Run everything in Docker

```bash
cp .env.example .env
docker compose --profile app up -d --build
```

Edit the secrets in `.env` before you run this. The backend applies the migrations when it starts.

Then load the demo data from the host:

```bash
cd backend
cp .env.example .env
npm install
npm run seed
```

The passwords in `backend/.env` must match the ones in `../.env`.

- PWA: http://localhost:8080 (Nginx also proxies `/api` to the backend)
- API: http://localhost:3000/api
- Swagger: http://localhost:3000/api/docs
- MinIO console: http://localhost:9001

## Run the API on the host (development)

```bash
docker compose up -d
cd backend
npm install
npx prisma migrate deploy
npm run seed
npm run start:dev
```

`docker compose up -d` starts only PostgreSQL, Redis and MinIO. The API then runs on your machine with live reload.

Then start the PWA in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The PWA opens at http://localhost:5173 and proxies `/api` to the API on port 3000. The service worker only runs in a production build. To test offline behavior, use `npm run build` followed by `npm run preview`, which serves the build at http://localhost:4173.

## Test accounts (seed)

The test accounts are listed at the top of `backend/prisma/seed.ts`: an admin, a supervisor and two operators, all on `@empresa.test`. All of them share one password. Set it with `SEED_PASSWORD`, or check the seed file for the default. The seed also creates 2 sites and 20 published activities for the current week.

## Tests

```bash
cd backend
npm test
```

There are 32 unit tests. They need no database, no Docker and no network.

- **Domain tests:** the attendance rules, the execution rules, the two-clock policy and the geofence.
- **Sync tests with in-memory adapters:** re-sending a batch never creates duplicates, concurrent retries are handled, and records sent out of order are processed in the right order.

```bash
cd frontend
npm test
```

There are 11 sync-engine tests. They run against an in-memory IndexedDB and a fake server that follows the real API rules. They cover:
- capturing a whole workday offline
- sending in dependency order once the network returns
- no duplicates after a lost response
- backoff on temporary errors
- photos waiting for their activity start
- token refresh after a long offline period

## The PWA (operator app)

The operator opens the app while they still have signal, for example on the company Wi-Fi. The app downloads the week's agenda into IndexedDB. After that it works with no internet:

1. **Check-in at the site.** The device time and a `client_uuid` are saved. GPS is used if it answers within 10 seconds. The app warns locally if the position is outside the site's geofence.
2. **Start an activity.** This needs a check-in at that site first.
3. **Take the three photos** (before, during, after) with the phone camera. Each photo is compressed on the phone to at most 1280 px and about 300 KB, with its SHA-256 hash and a thumbnail.
4. **Finish the activity.** This needs the three photos.
5. **Check-out.**

Everything goes to IndexedDB first. The sync engine (`src/sync/motor.ts`) runs when the app opens, when the network comes back, when the app returns to the foreground, every minute, and when the operator presses **Sincronizar**. It sends records in the order the server needs them: marks, then activity starts, then photos one by one, then activity finishes.

How it handles the server's answers:
- **`REINTENTAR`:** the record waits with exponential backoff (5 s, 10 s, 20 s and so on, up to 5 minutes).
- **`RECHAZADO`:** the reason is shown in Spanish and the record isn't sent again.
- **Expired access token:** after hours offline the token has expired, so the app refreshes it once and continues.

Two more protections:
- **Phone storage:** after a photo is synced, the full image is deleted and only the thumbnail stays on the phone.
- **Shared phones:** if another user's records are still pending on the phone, a different user can't log in. The server takes the operator from the token, so another user's token would assign those records to the wrong person.

Administrators, administrative staff and supervisors see the **real-time monitor** instead of the operator app. It's an SSE feed read with `fetch`, so the token travels in a header and never in the URL. It shows the operator, the site, the device time and the received time. It flags inconsistent times and positions outside the geofence, and has a **Ver foto** button that opens the signed URL.

### HTTPS on phones

Browsers only enable the service worker, `crypto.subtle` (needed for the photo hash) and the camera on a secure origin. `http://localhost` counts as secure, so everything works on the development machine. A phone opening `http://192.168.x.x` does not. For phones, serve the PWA over HTTPS. Two options: add a certificate to the Nginx container (for example one made with `mkcert`), or use a tunnel that gives an HTTPS URL. The architecture document already requires TLS in production.

### Offline demo (desktop browser)

1. Log in as `operario1@empresa.test` while the API is running. The day's agenda appears.
2. Stop the backend with `docker compose stop backend`, or set the browser to offline in DevTools > Network.
3. Register the check-in, start an activity and add a photo. Each item shows **Pendiente de envío**, and the top bar counts the pending items.
4. Reload the page. The app still opens from the service worker cache, and the data is still there.
5. Start the backend again and press **Sincronizar**. Each item changes to **Enviado (recibido HH:MM)**, so the device time and the server time are both visible.
6. Press **Sincronizar** again. Nothing is duplicated, because the server answers `DUPLICADO`.

## Architecture (hexagonal, per module)

```
src/
  shared/
    domain/           ErrorDominio, ResultadoSync, EventoDominio, IntegridadTiempo, Reloj (port)
    infrastructure/   Prisma, Redis, outbox relay, system clock
    auth/             login/refresh (JWT + Argon2id), global JWT guard, RBAC @Roles
  modules/
    asistencia/                       SELECTED MODULE 1
      domain/         MarcaAsistencia (aggregate), Geocerca, Coordenada
      application/    puertos.ts, RegistrarMarcaAsistencia, SincronizarAsistencias
      infrastructure/ PrismaAsistenciaRepositorio, PrismaConjuntoConsulta, PrismaAgendaConsulta
      interfaces/     AsistenciaController, DTOs
    ejecucion/                        SELECTED MODULE 2
      domain/         Ejecucion (aggregate), Evidencia
      application/    IniciarEjecucion, FinalizarEjecucion, SincronizarEjecuciones,
                      RegistrarEvidencia, ObtenerUrlEvidencia
      infrastructure/ PrismaEjecucionRepositorio, MinioAlmacenamiento, PrismaProgramacionConsulta
      interfaces/     EjecucionController, DTOs
    agenda/           read-only: the operator downloads the week before going offline
    monitoreo/        SSE stream for the admin/supervisor panel
```

- The `domain` and `application` layers import nothing from NestJS, Prisma or MinIO. Each `*.module.ts` file wires the ports to the adapters with factories.
- Modules never import each other. Attendance reads sites and schedules only through its own ports (`ConjuntoConsulta`, `AgendaConsulta`).
- Every state change writes its domain events to `outbox_evento` in the same transaction. A relay publishes them to Redis, and from there they reach the SSE stream.

## API

All endpoints are under `/api`. They need `Authorization: Bearer <accessToken>` unless marked public.

| Method | Path                               | Role                           | Purpose                                     |
|--------|------------------------------------|--------------------------------|---------------------------------------------|
| POST   | `/auth/login`                      | public                         | Access token (15 min) + refresh token (7 d) |
| POST   | `/auth/refresh`                    | public                         | New token pair after being offline          |
| GET    | `/health`                          | public                         | DB and Redis status                         |
| GET    | `/agenda?desde=&hasta=`            | OPERARIO                       | Published activities plus site geofence     |
| POST   | `/asistencia/sync`                 | OPERARIO                       | Batch of check-in/check-out marks (max 100) |
| POST   | `/ejecuciones/sync`                | OPERARIO                       | Batch of INICIO/FIN operations (max 100)    |
| POST   | `/ejecuciones/evidencias`          | OPERARIO                       | One photo (multipart, field `foto`, ≤ 2 MB) |
| GET    | `/ejecuciones/evidencias/:id/url`  | all roles (operator: own only) | Signed URL, valid for 10 min                |
| GET    | `/monitoreo/stream`                | ADMIN, ADMINISTRATIVO, SUPERVISOR | SSE feed of domain events                |
| GET    | `/monitoreo/catalogo`              | ADMIN, ADMINISTRATIVO, SUPERVISOR | Operator and site names for the feed     |

The operator's identity always comes from the token. The request body never decides who the operator is.

### Sync contract (for the PWA in Step 3)

Each record gets its own result:

| `estado`     | Meaning                                    | What the PWA does                    |
|--------------|--------------------------------------------|--------------------------------------|
| `ACEPTADO`   | Stored now                                 | Mark it as synced                    |
| `DUPLICADO`  | Already stored by an earlier attempt       | Mark it as synced                    |
| `RECHAZADO`  | Breaks a business rule (`codigo`)          | Stop retrying and show the reason    |
| `REINTENTAR` | Arrived too early, or the server had a temporary failure | Keep it queued and retry with backoff |

Example of an attendance batch:

```json
POST /api/asistencia/sync
{ "marcas": [ {
  "clientUuid": "9b1d...", "conjuntoId": "…", "tipo": "ENTRADA",
  "horaDispositivo": "2026-11-05T07:02:11.000-05:00",
  "latitud": 2.9361, "longitud": -75.2811, "precisionMetros": 12 } ] }
```

The queue order on the phone should be: check-in, then activity start, then the three photos, then activity finish, then check-out. If the order is broken, the server answers `REINTENTAR` for the records that came too early, so nothing is lost.

### Business rules enforced

- **Attendance:**
  - one check-in and one check-out per operator, site and day
  - only one open check-in at a time
  - a check-out needs a check-in, and cannot be earlier than it
  - the operator must be scheduled at that site on that day
  - the GPS position is compared with the site geofence and the result is flagged
- **Execution:**
  - only the assigned operator can start an activity, and only from a published schedule
  - one execution per activity
  - one photo per moment (before, during, after)
  - an activity can't be finished until all three photos are stored
  - the finish time cannot be earlier than the start time
- **Photos:**
  - JPEG or WebP, 2 MB at most
  - the SHA-256 computed on the phone is verified on the server
  - the object key is deterministic, so a retried upload overwrites the same object
- **Two clocks:**
  - the device time and the server time are both stored
  - a record is flagged (not rejected) when the device clock is more than `CLOCK_SKEW_TOLERANCE_SECONDS` ahead of the server, or when it arrives more than `MAX_OFFLINE_HOURS` after capture

### Resilience

If Redis is down, sync keeps working: events wait in the outbox and the SSE feed pauses. If MinIO is down, photo uploads answer `REINTENTAR` and the phone keeps the photo.

## Stop and reset

```bash
docker compose down
docker compose down -v
```

`down` stops the containers and keeps the data. `down -v` also deletes the volumes, so all data is lost.
