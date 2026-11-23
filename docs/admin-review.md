# Administrator review

Open the dedicated admin Pages project at `https://aetheris-admin.pages.dev/` or its configured hostname. Enter the admin password and choose **Sign in**. The Worker verifies the password and creates a host-only reviewer session that expires eight hours after sign-in. It checks that session on every protected request. **Sign out** ends the current session.

The administrator chooses the password directly in the Cloudflare Dashboard as the `aetheris-lab-api` Worker's `ADMIN_PASSWORD` Secret. Editing that secret and deploying it for all traffic invalidates existing sessions; reviewers must sign in with the new password. No hashes, password generator, code changes, or migrations are needed. Use a new password each time; do not restore a previous secret or Worker version containing it. See [Cloudflare configuration](cloudflare.md#2-set-the-admin-password-in-the-cloudflare-dashboard) for the initial switch and rotation steps.

1. Select a status filter and open a request. The detail page shows the original submission, private photos, current agent run, timestamped source evidence, and the audit history.
2. Verify the references and resolve uncertainties before deciding. Catalog matches identify reference records. The physical samples and their formulations still require verification. AI entries are source flags for expert review.
3. Choose **Approve & publish**, **Reject**, or **Request more information**. Enter private notes for the audit. For approval, write the public assessment, select retrieved citations or add verified references, and attest that the evidence supports the assessment. A compatible classification requires a reviewer-supplied reference for the exact formulation and conditions.
4. If an agent run failed, select **Retry analysis** to requeue it. An unconfigured run can be retried once a provider is configured. The previous run, its evidence, and status history remain recorded.

Approval publishes the reviewer-authored assessment and its selected references to the corresponding token holder. Rejection and requests for more information publish only status. Private notes, staff identities, submitted photos, evidence excerpts, and draft findings remain in the review area.

## Managing records

Use **Manage records** in the queue to select up to 30 requests for one action. To manage just one request, open its details and use the actions there.

- **Archive** moves a request to **Archived requests** without changing its tracking receipt. Archived requests are skipped by the scheduled queue. A run that already started can finish. Restore the request before reviewing it or retrying its analysis.
- **Restore** moves a request back to the active queue at its current workflow status.
- **Delete permanently** asks for confirmation, then removes the selected requests, their analyses, reviews and photos, and revokes their tracking links. Photo access ends immediately and the Worker retries background R2 removal on its regular schedule. A minimal administrative log retains the request ID, action, actor and timestamp.

## Worker API

| Method and path | Behavior |
| --- | --- |
| `POST /api/admin/auth/login` | Verifies the JSON `password` field, sets the session cookie, and returns the session's CSRF token. |
| `GET /api/admin/session` | Validates the active reviewer session and returns its CSRF token. |
| `POST /api/admin/auth/logout` | Revokes the active session and clears its cookie. |
| `GET /api/admin/requests` | Lists active requests with optional `status` and `after` filters. Use `archived=true` for the archive. |
| `POST /api/admin/requests/manage` | Applies `archive`, `restore`, or `delete` to the explicit array of request IDs. |
| `GET /api/admin/requests/:id` | Reads submitted data, current draft, evidence, review, and audit. |
| `GET /api/admin/requests/:id/images/:imageId` | Streams one authorized photo from private R2. |
| `POST /api/admin/requests/:id/retry` | Requeues the specified eligible agent run. |
| `POST /api/admin/requests/:id/decision` | Records the decision for the current run and updates status atomically. |

Sign-in requires the configured admin origin. Sign-out, retry, decision, and management requests also require the session's `X-CSRF-Token` header. The decision endpoint accepts an explicit current run ID. Concurrent or repeated decisions and actions on superseded runs are rejected. The review and status history are append-only while the request exists. Permanent deletion purges its contents and leaves the management entry. New reviewer events use the shared `password:admin` identity. Existing audit entries keep their original identifiers. See [Cloudflare configuration](cloudflare.md) for setup and security limits.
