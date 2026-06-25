# Configuration Guide

## API Keys & Credentials

The application requires Supabase credentials to function. Follow these steps
to configure them securely.

### Development Setup

1. **Create a `.env` file** in the project root by copying the template:
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env`** and fill in your Supabase project URL and anon key:
   ```
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_ANON_KEY=your-supabase-anon-key
   ```

3. **Generate `js/config.js`** by running the build script:
   ```bash
   node build.js
   ```

   This will sync your `.env` values to `js/config.js`. The generated file
   is gitignored and should never be committed.

### Production Deployment

For static hosting (Netlify, Vercel, GitHub Pages, etc.), use the build script
to inject credentials at deploy time:

#### Recommended: Build Script Workflow

1. **Configure your `.env`** with production credentials
2. **Run the build script:**
   ```bash
   node build.js
   ```
3. **Deploy the generated files:**
   - Upload all project files including the generated `js/config.js`
   - The `.env` file stays local and is never uploaded

#### Alternative: CI/CD Pipeline

If using automated deployment, add a build step:

```yaml
# Example for GitHub Actions
- name: Build
  run: node build.js
- name: Deploy
  run: deploy-command
```

#### Alternative: Environment Variable Injection (Netlify/Vercel)

Some platforms support direct environment variable injection. In that case:

1. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in your platform's environment settings
2. Use a build plugin or custom script to inject them into `js/config.js`
3. Or use the build script as part of your build command

## Security Notes

- The Supabase anon key is designed to be public (it's safe for client-side use
  with Row Level Security enabled).
- The actual security comes from Supabase RLS policies and user authentication,
  not from keeping the anon key secret.
- **Never commit `.env` or `js/config.js` to version control** - both are gitignored.
- The `.env` file stays on your local machine only.
- The generated `js/config.js` is deployed with your site but is gitignored.
- For backend operations (cleanup cron), use the `service_role` key which is
  only loaded server-side and never exposed to clients.

## Scheduled Cleanup (Cron Job)

To automatically delete expired noise event recordings based on the configured
retention period, set up a scheduled job that calls the Supabase RPC function.

### Using Supabase Cron (pg_cron — requires Supabase add-on)

Run the following SQL in your Supabase SQL editor to schedule daily cleanup:

```sql
-- Schedule cleanup to run daily at 3:00 AM
SELECT cron.schedule(
  'cleanup-expired-events',         -- job name
  '0 3 * * *',                      -- cron expression (3 AM daily)
  $$SELECT public.delete_expired_noise_events()$$
);
```

To view scheduled jobs:
```sql
SELECT * FROM cron.job;
```

To remove the job:
```sql
SELECT cron.unschedule('cleanup-expired-events');
```

### Using External Cron Service

If pg_cron is not available, use any external cron service (e.g., GitHub Actions,
cron-job.org, cron-job.org) to call the Supabase REST API:

```
POST https://{project-ref}.supabase.co/rest/v1/rpc/delete_expired_noise_events
Content-Type: application/json
apikey: {your-anon-key}
Authorization: Bearer {your-service-role-key}
```

The function:
- Deletes `noise_events` rows older than the configured retention period
- Uses the `retention_days` value from `system_settings` (defaults to 14 days)
- Logs the cleanup action to the `audit_logs` table
- Returns the number of deleted rows

### Using the In-App Cleanup Button

An admin can also trigger cleanup manually from the Settings page by calling:
```javascript
await cleanupExpiredNoiseEvents();
```

## Quick Reference

### File Responsibilities

| File | Purpose | Committed? |
|------|---------|------------|
| `.env` | Local credentials (never share) | No (gitignored) |
| `js/config.js` | Generated config for deployment | No (gitignored) |
| `js/config.dist.js` | Template with placeholder values | Yes |
| `.env.example` | Template for team members | Yes |

### Common Commands

```bash
# Initial setup
cp .env.example .env
# Edit .env with your credentials

# Generate config for development/deployment
node build.js

# The generated js/config.js is ready to use
# Open index.html in browser or deploy to static host
```

### Troubleshooting

**"js/config.js still contains placeholder values"**
- Ensure `.env` has real credentials, not the example values
- Run `node build.js` again

**"SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env"**
- Check that `.env` exists in the project root
- Verify the variable names match exactly (case-sensitive)

**Changes to .env not reflected in app**
- Re-run `node build.js` to regenerate `js/config.js`
- Hard refresh your browser (Ctrl+Shift+R)
