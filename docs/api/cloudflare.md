# API: Cloudflare

All Cloudflare routes require the `x-api-key` header if `ADMIN_API_KEY` is set.

```
Header: x-api-key: <cloudflare-api-key>
```

---

## Vector Indexes

### List Vector Indexes

```
GET /cloudflare/indexes
```

Returns all Vectorize indexes in the account.

**Example:**
```bash
curl http://localhost:3000/cloudflare/indexes

# With API key
curl -H "x-api-key: CLOUDFLARE_API_KEY" http://localhost:3000/cloudflare/indexes
```

**Response (200):**
```json
{
  "success": true,
  "indexes": [
    {
      "name": "popularcert-vectors",
      "config": { "dimensions": 768, "metric": "cosine" },
      "createdOn": "2024-01-01T00:00:00Z",
      "modifiedOn": "2024-06-08T00:00:00Z"
    }
  ]
}
```

### Create Vector Index

```
POST /cloudflare/indexes
```

Creates a new Vectorize index.

**Example:**
```bash
curl -X POST http://localhost:3000/cloudflare/indexes \
  -H "Content-Type: application/json" \
  -d '{"name": "my-new-index", "dimensions": 768}'

# With API key
curl -X POST http://localhost:3000/cloudflare/indexes \
  -H "Content-Type: application/json" \
  -H "x-api-key: CLOUDFLARE_API_KEY" \
  -d '{"name": "my-new-index"}'
```

**Request Body:**
```json
{
  "name": "my-new-index",
  "dimensions": 768
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | Yes | — | Index name |
| `dimensions` | number | No | `768` | Vector dimensions |

**Response (201 — created):**
```json
{
  "success": true,
  "index": { "name": "my-new-index", "config": { "dimensions": 768, "metric": "cosine" } }
}
```

**Response (200 — already exists):**
```json
{
  "success": true,
  "index": { "name": "my-new-index", "..." : "..." },
  "message": "Index already exists."
}
```

### Delete Vector Index

```
DELETE /cloudflare/indexes/:name
```

Deletes a Vectorize index by name.

**Example:**
```bash
curl -X DELETE http://localhost:3000/cloudflare/indexes/my-new-index

# With API key
curl -X DELETE -H "x-api-key: CLOUDFLARE_API_KEY" http://localhost:3000/cloudflare/indexes/my-new-index
```

**Response (200):**
```json
{
  "success": true,
  "message": "my-new-index deleted"
}
```

**Response (404):**
```json
{
  "success": false,
  "error": "Index 'my-new-index' not found."
}
```

---

## R2 Buckets

### List R2 Buckets

```
GET /cloudflare/buckets
```

Returns all R2 buckets in the account.

**Example:**
```bash
curl http://localhost:3000/cloudflare/buckets

# With API key
curl -H "x-api-key: CLOUDFLARE_API_KEY" http://localhost:3000/cloudflare/buckets
```

**Response (200):**
```json
{
  "success": true,
  "buckets": [
    { "name": "popularcert-rag", "created": "2024-01-01T00:00:00Z" }
  ]
}
```

### Create R2 Bucket

```
POST /cloudflare/buckets
```

Creates a new R2 bucket.

**Example:**
```bash
curl -X POST http://localhost:3000/cloudflare/buckets \
  -H "Content-Type: application/json" \
  -d '{"name": "my-new-bucket"}'

# With API key
curl -X POST http://localhost:3000/cloudflare/buckets \
  -H "Content-Type: application/json" \
  -H "x-api-key: CLOUDFLARE_API_KEY" \
  -d '{"name": "my-new-bucket"}'
```

**Request Body:**
```json
{
  "name": "my-new-bucket"
}
```

**Response (201):**
```json
{
  "success": true,
  "bucket": { "name": "my-new-bucket" }
}
```

### Delete R2 Bucket

```
DELETE /cloudflare/buckets/:name
```

Clears all objects and deletes an R2 bucket.

**Example:**
```bash
curl -X DELETE http://localhost:3000/cloudflare/buckets/my-new-bucket

# With API key
curl -X DELETE -H "x-api-key: CLOUDFLARE_API_KEY" http://localhost:3000/cloudflare/buckets/my-new-bucket
```

**Response (200):**
```json
{
  "success": true,
  "message": "Bucket 'my-new-bucket' deleted."
}
```

**Response (404):**
```json
{
  "success": false,
  "error": "Bucket 'my-new-bucket' not found or could not be deleted."
}
```

### Clear R2 Bucket

```
POST /cloudflare/buckets/:name/clear
```

Clears all objects from an R2 bucket without deleting it.

**Example:**
```bash
curl -X POST http://localhost:3000/cloudflare/buckets/my-new-bucket/clear

# With API key
curl -X POST -H "x-api-key: CLOUDFLARE_API_KEY" http://localhost:3000/cloudflare/buckets/my-new-bucket/clear
```

**Response (200):**
```json
{
  "success": true,
  "message": "Bucket 'my-new-bucket' cleared."
}
```
