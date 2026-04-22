# DataNaviGatr2 API Starter

## What is included
- Flask API server
- PostgreSQL-backed user/app data models
- Secure password hashing with Argon2
- Access-token auth for React (`Bearer <token>`)
- Refresh token stored in an HttpOnly cookie
- Docker Compose for API + PostgreSQL

## Initial data model
- `users`
- `refresh_tokens`
- `projects`
- `folders`
- `saved_queries`

## Run it
```bash
cd /mnt/data
docker compose up --build
```

API health check:
```bash
curl http://localhost:5000/api/health
```

Register:
```bash
curl -X POST http://localhost:5001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"esmyth","email":"esmyth@example.local","password":"ChangeThisPassword123!"}'
```

Login:
```bash
curl -i -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"esmyth","password":"ChangeThisPassword123!"}'
```

The login response returns:
- `access_token` in JSON for your React app to hold in memory
- `refresh_token` in an HttpOnly cookie for silent token refresh

Protected route:
```bash
curl http://localhost:5001/api/auth/me \
  -H "Authorization: Bearer <access_token>"
```

Refresh access token:
```bash
curl -i -X POST http://localhost:5001/api/auth/refresh \
  --cookie "refresh_token=<refresh_token_cookie_value>"
```

Logout:
```bash
curl -i -X POST http://localhost:5001/api/auth/logout \
  --cookie "refresh_token=<refresh_token_cookie_value>"
```

## Notes
- For local-only HTTP, `COOKIE_SECURE=false` is okay.
- When you later move behind HTTPS, set `COOKIE_SECURE=true`.
- Right now `db.create_all()` is used for fast startup. Once you start iterating, switch fully to Flask-Migrate migrations.
