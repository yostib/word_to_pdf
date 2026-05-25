# Word to PDF Converter

This project provides a simple web service to convert Word documents (.docx, .doc) to PDF using LibreOffice.

## Admin

The admin dashboard is protected by a session-based admin cookie. Configure credentials with environment variables (recommended):

- `ADMIN_USER` — admin username
- `ADMIN_PASS` — admin password
- `ADMIN_SESSION_TTL_MS` — admin session TTL in milliseconds (default 3600000 = 1 hour)
- `NODE_ENV` — set to `production` when deploying to enable secure cookies

Copy `.env.example` to `.env` and update credentials before starting in production.

## Running locally

Install dependencies (if needed):

```bash
npm install
```

Start the server (example with env vars set inline):

```bash
ADMIN_USER=admin ADMIN_PASS=yourpass NODE_ENV=production node server.js
```

Or using a `.env` loader in your env of choice.

## Endpoints

- `/` — main upload page
- `/convert` — POST endpoint for file upload
- `/admin` — admin login page
- `/admin/login` — POST login (JSON)
- `/admin/dashboard` — protected admin dashboard
- `/admin/stats` — protected JSON stats
- `/privacy` — privacy policy
- `/terms` — terms and conditions

## Security notes

- Do not commit real credentials. Use environment variables in production.
- Run behind a reverse proxy (e.g., nginx) in production and enable HTTPS.

