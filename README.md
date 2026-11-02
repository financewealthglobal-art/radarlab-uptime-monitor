# Radarlab external readiness monitor

Independent public-endpoint monitoring for Radarlab. It keeps working if Railway's app and worker are both down. The private Radarlab application source is not included here.

Runs on a standard GitHub-hosted Linux runner at minutes 7, 22, 37 and 52 of every hour. GitHub scheduled workflows are best-effort and can be delayed; this is not a fifteen-minute SLA. Standard hosted-runner use in public repositories is free: https://docs.github.com/en/actions/concepts/billing-and-usage.

Only checks the public `/api/ready` URL. It never signs into Radarlab, reads credentials or calls a paid provider. It posts outage/recovery transitions through a dedicated Discord webhook restricted to `automation-alerts`. No initial healthy notice and no unchanged-state spam.

Required encrypted Actions secret: `DISCORD_WEBHOOK_URL`. Never put its value in a file or commit. The webhook can post only to its configured Discord channel; it cannot read HQ messages or manage roles/members.

Each transition's intent is committed before Discord is contacted. Confirmed delivery records a hash of the returned message ID. An uncertain send or interrupted runner is never automatically repeated. If state persistence fails before sending, nothing is posted. Review an `intent` or `unknown` receipt before any manual retry. Do not delete `state.json` to force a retry.

The workflow needs write access only to this dedicated repository so it can keep the public health state and delivery receipts in `state.json`. There is no pull-request trigger. Dependencies are pinned by commit; the script uses Node built-ins only. No media, customer data, inventory, accounts, provider keys or Discord message content is stored in this repository.

Local free tests: `node --test monitor.test.mjs`. The owner approved this public monitor and the dedicated channel-only webhook on 2 November 2026. The webhook URL is stored only in the encrypted repository Actions secret, never in this source.
