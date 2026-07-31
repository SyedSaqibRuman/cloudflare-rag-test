# API: Scheduler

The scheduler API is mounted at `/cloudflare` and manages background jobs. Jobs can be scoped to a specific company via the optional `companyName` parameter. Multiple concurrent jobs and cron schedules are supported (up to 5).

## Start Standalone Job

```
POST /cloudflare/job/start
```

Starts a job immediately. Multiple concurrent jobs allowed.

**Example:**
```bash
curl -X POST http://localhost:3000/cloudflare/job/start \
  -H "Content-Type: application/json" \
  -d '{"jobId": "ingest"}'

# Scoped to a specific company
curl -X POST http://localhost:3000/cloudflare/job/start \
  -H "Content-Type: application/json" \
  -d '{"jobId": "ingest", "companyName": "popularcert"}'
```

**Request Body:**
```json
{
  "jobId": "ingest",
  "companyName": "popularcert"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jobId` | string | Yes | Job to run (`ingest` or `testing`) |
| `companyName` | string | No | Company to run the job for (isolates resources) |

| Job ID | Description |
|--------|-------------|
| `ingest` | Runs the full WordPress content ingestion pipeline |
| `testing` | Runs the test workflow |

**Response (200):**
```json
{
  "success": true,
  "message": "Job 'Ingest Job [company: popularcert]' started.",
  "jobId": "ingest",
  "startedAt": "2024-06-08T12:00:00.000Z",
  "companyName": "popularcert"
}
```

---

## Stop Standalone Job

```
POST /cloudflare/job/stop
```

Stops a specific running job, or the first running job if no params given.

**Example:**
```bash
# Stop a specific job
curl -X POST http://localhost:3000/cloudflare/job/stop \
  -H "Content-Type: application/json" \
  -d '{"jobId": "ingest", "companyName": "popularcert"}'

# Stop any running job
curl -X POST http://localhost:3000/cloudflare/job/stop \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Request Body:**
```json
{
  "jobId": "ingest",
  "companyName": "popularcert"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Job 'Ingest Job [company: popularcert]' stopped.",
  "jobId": "ingest",
  "companyName": "popularcert"
}
```

---

## List Running Jobs

```
GET /cloudflare/jobs/running
```

Returns all currently running standalone jobs.

**Example:**
```bash
curl http://localhost:3000/cloudflare/jobs/running
```

**Response (200):**
```json
{
  "success": true,
  "jobs": [
    {
      "jobId": "ingest",
      "companyName": "popularcert",
      "status": "running",
      "startedAt": "2024-06-08T12:00:00.000Z"
    }
  ]
}
```

---

## Start Cron Scheduler

```
POST /cloudflare/cron/start
```

Schedules a job with a cron expression. Multiple concurrent cron schedules allowed.

**Example:**
```bash
# Schedule ingest job to run daily at 2 AM
curl -X POST http://localhost:3000/cloudflare/cron/start \
  -H "Content-Type: application/json" \
  -d '{"jobId": "ingest", "schedule": "0 2 * * *"}'

# Scoped to a specific company
curl -X POST http://localhost:3000/cloudflare/cron/start \
  -H "Content-Type: application/json" \
  -d '{"jobId": "ingest", "schedule": "0 2 * * *", "companyName": "popularcert"}'
```

**Request Body:**
```json
{
  "jobId": "ingest",
  "schedule": "0 2 * * *",
  "companyName": "popularcert"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jobId` | string | Yes | Job to schedule (`ingest` or `testing`) |
| `schedule` | string | Yes | Cron expression (e.g., `0 2 * * *` for daily at 2 AM) |
| `companyName` | string | No | Company to run the job for |

**Response (200):**
```json
{
  "success": true,
  "message": "Cron scheduled for 'Ingest Job [company: popularcert]'.",
  "jobId": "ingest",
  "schedule": "0 2 * * *",
  "companyName": "popularcert"
}
```

---

## Stop Cron Scheduler

```
POST /cloudflare/cron/stop
```

Stops a specific scheduled cron, or the first scheduled one if no params given.

**Example:**
```bash
curl -X POST http://localhost:3000/cloudflare/cron/stop \
  -H "Content-Type: application/json" \
  -d '{"jobId": "ingest", "companyName": "popularcert"}'
```

**Request Body:**
```json
{
  "jobId": "ingest",
  "companyName": "popularcert"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Cron stopped for 'Ingest Job [company: popularcert]'.",
  "jobId": "ingest",
  "companyName": "popularcert"
}
```

---

## List All Jobs

```
GET /cloudflare/jobs
```

Returns all registered job types.

**Example:**
```bash
curl http://localhost:3000/cloudflare/jobs
```

**Response (200):**
```json
{
  "success": true,
  "jobs": [
    { "id": "testing", "name": "Testing Job", "description": "Runs test workflow" },
    { "id": "ingest", "name": "Ingest Job", "description": "Runs ingest workflow" }
  ]
}
```

---

## Get Status

```
GET /cloudflare/status
```

Returns all active jobs (standalone + cron). If nothing is active, returns a summary of recent jobs.

**Example:**
```bash
curl http://localhost:3000/cloudflare/status
```

**Response (active):**
```json
{
  "success": true,
  "mode": "active",
  "standalone": [
    {
      "key": "ingest:popularcert",
      "jobId": "ingest",
      "companyName": "popularcert",
      "status": "running",
      "startedAt": "2024-06-08T12:00:00.000Z",
      "completedAt": null,
      "duration": null,
      "error": null
    }
  ],
  "cron": [
    {
      "key": "ingest:maxicert",
      "jobId": "ingest",
      "companyName": "maxicert",
      "status": "scheduled",
      "schedule": "0 2 * * *",
      "startedAt": "2024-06-01T00:00:00.000Z",
      "lastRun": "2024-06-08T02:00:00.000Z",
      "lastError": null,
      "runCount": 7,
      "lastDuration": "320000ms",
      "avgDuration": "325000ms"
    }
  ]
}
```

**Response (idle):**
```json
{
  "success": true,
  "mode": "idle",
  "standalone": [],
  "cron": [],
  "jobs": [
    { "id": "testing", "name": "Testing Job", "description": "Runs test workflow" },
    { "id": "ingest", "name": "Ingest Job", "description": "Runs ingest workflow" }
  ]
}
```
