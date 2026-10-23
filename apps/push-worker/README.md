# Background web notification service

This Cloudflare Worker is deployed separately from the GitHub Pages web app.
Publishing Pages alone does not update server-side retention or deletion.

Live inspection on 21 October 2026: the existing Worker version `927d8dff`
contains Cloudflare's default Hello World handler, has no runtime variables or
cron triggers, and its bound D1 database reports zero tables. The notification
service and the local retention changes have not been deployed there. Turning
this placeholder into an operational Push service requires initial schema,
VAPID credentials, an access code, allowed origins and a cron trigger, rather
than just updating an already-running notification service.

## Retention and deletion

- The existing 15-minute cron deletes `sent` and `cancelled` jobs whose `updated_at` is at least seven days old. Pending and in-flight jobs are not included in this retention rule.
- Authenticated `DELETE /v1/subscriptions` removes all job states for that device and its entire device/subscription record in one D1 transaction. Other devices are untouched. Deletion can be retried after a lost successful response.
- Cron also removes legacy disabled-device records and their jobs. A provider response of 404/410 removes the expired device and its jobs immediately.
- D1 foreign keys prevent an already-authenticated stale jobs request from recreating rows after the device is deleted. A message already accepted by the external Push provider may still be delivered.
- The client requires successful server deletion before clearing its credentials. Failed requests preserve settings for retry and show an error.

## Deployment order

Use the Cloudflare account that owns the existing Worker and D1 database; do not create a replacement database or replace VAPID keys/secrets.

1. From this directory, apply the additive retention index with the official Wrangler CLI:
   `wrangler d1 migrations apply universal-task-manager-push --remote`
2. Deploy the Worker: `wrangler deploy`.
3. Verify one synthetic device's deletion and the next scheduled cleanup using disposable test data. Do not send test reminders to real users or delete their records as a test.
4. Publish the updated web client and privacy policy after the Worker deployment is confirmed. The policy's seven-day retention statement must not be published before the backend implements it.

Local regression checks (in-memory SQLite, no Cloudflare calls):
`pnpm exec vitest run apps/push-worker/src/index.test.ts apps/web/src/push.test.ts`
