# Running Market Jury on the VPS

Market Jury runs on a Hostinger VPS (Ubuntu 24.04) as a systemd service. Visitors reach it
through Cloudflare Tunnel, so the server opens no web port; only SSH (keys only) comes in.
Every merge to `main` deploys itself once deploys are switched on, and the database is copied
to Cloudflare R2 every night.

| On the server | What it is |
| --- | --- |
| `/srv/market-jury/releases/<time>-<commit>/` | one folder per deploy; the newest 5 are kept |
| `/srv/market-jury/current` | link to the live release |
| `/srv/market-jury/data/market-jury.sqlite` | the database: the experiment's record |
| `/etc/market-jury/env` | settings and secrets (API keys, R2), readable only by root and the app |
| `market-jury.service` | the app (Bun, port 3000 on the server only) |
| `market-jury-backup.timer` | nightly backup at 02:00 UTC (04:00 in South Africa) |
| `mj` | runs a Bun command as the app, with its settings, e.g. `mj run trade-master:setup` |

Users: `marketjury` runs the app and owns the database; `deploy` is the login GitHub Actions
uses to ship releases, and may restart the app but do nothing else as root.

## First-time setup

Secrets never go in the repo or in chat: they go in GitHub's secrets settings or in
`/etc/market-jury/env` on the server.

### 1. Reinstall the VPS

In hPanel, add your laptop's SSH public key to the VPS, then reinstall it with plain
Ubuntu 24.04 LTS (no control panel). Check `ssh root@<server IP>` logs in without a password.

### 2. Run the setup script

The repo is private, so copy the script up from your laptop. In GitHub, open
`deploy/provision.sh` and use "Download raw file", then:

```sh
scp ~/Downloads/provision.sh root@<server IP>:
ssh root@<server IP> bash provision.sh
```

It updates Ubuntu, switches on automatic security updates, turns off SSH password logins,
closes every port except SSH, installs Bun and `cloudflared`, creates the users, folders,
settings file and services, and makes a deploy key for GitHub Actions. It finishes by printing
the values for step 4. Running it again is safe.

### 3. Cloudflare Tunnel

In the Cloudflare dashboard, open Zero Trust, then Networks, then Tunnels, and create a
tunnel (type "Cloudflared") named `market-jury`. Choose Debian, 64-bit, and copy the
`sudo cloudflared service install <token>` command it shows. Run it on the server (not
in chat: the token is a secret). Then add a public hostname, for example
`jury.<your domain>`, with service type `HTTP` and URL `localhost:3000`.

### 4. GitHub Actions secrets

In the repo's Settings, under Secrets and variables, then Actions:

- Secrets: `VPS_HOST`, `VPS_KNOWN_HOSTS` and `VPS_SSH_KEY`, with the values the setup script
  printed. For `VPS_SSH_KEY`, run `cat /root/github-actions-deploy-key` on the server and paste
  the whole key, then delete the file with `rm /root/github-actions-deploy-key`.
- Variable: `DEPLOY_ENABLED` = `true` switches deploys on. Leave it unset until the app is
  ready for its first deploy.

### 5. R2 backups

In the Cloudflare dashboard, open R2 and create a bucket named `market-jury-backups`. Under
"Manage API tokens", create a token with "Object Read & Write" for that bucket only. On the
server, `sudo nano /etc/market-jury/env` and fill in:

```
S3_ACCESS_KEY_ID=<the token's access key ID>
S3_SECRET_ACCESS_KEY=<the token's secret access key>
S3_ENDPOINT=https://<your account ID>.r2.cloudflarestorage.com
S3_BUCKET=market-jury-backups
```

### 6. First deploy and login

Run the Deploy workflow from the Actions tab (or merge to `main`). Then, on the server:

```sh
mj run trade-master:setup
```

### 7. Market data

In Alpaca (paper trading account), open "API Keys" and generate a key. On the server,
`sudo nano /etc/market-jury/env` and fill in `ALPACA_KEY_ID` and `ALPACA_SECRET_KEY`, then
`sudo systemctl restart market-jury`. Check it with a real run for the last trading day:

```sh
mj run floor-runner
```

It should end with "Briefing pack for ... is ready". Alpaca is used for market data only; the
app never sends it orders.

### 8. Model API keys

Create an API key with each provider (Anthropic, OpenAI, Google AI Studio, DeepSeek) and set a
monthly spending limit there as a second safety net. On the server, `sudo nano /etc/market-jury/env`
and fill in the lines below (add any that are missing), then `sudo systemctl restart market-jury`:

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
DEEPSEEK_API_KEY=
```

Check every model answers (one tiny request each, a fraction of a cent):

```sh
mj run models:check
```

It should end with "Every model answered". A FAIL line names the key or model version to fix.

## Everyday

| To | Run on the server |
| --- | --- |
| See whether the app is running | `systemctl status market-jury` |
| Read its log | `journalctl -u market-jury -n 100` |
| Change a setting or key | `sudo nano /etc/market-jury/env`, then `sudo systemctl restart market-jury` |
| Go back to the previous release | `sudo -u deploy /srv/market-jury/current/deploy/rollback.sh` |
| Make a backup now | `sudo systemctl start market-jury-backup`, then `journalctl -u market-jury-backup -n 20` |
| See when backups ran | `systemctl list-timers market-jury-backup` |

A deploy that does not answer its health check within 20 seconds is rolled back automatically,
and the workflow run fails.

## Restoring a backup

Download the snapshot from the R2 bucket (`snapshots/<time>.sqlite.gz`) and copy it to the
server, then:

```sh
sudo systemctl stop market-jury
cd /srv/market-jury/data
for f in market-jury.sqlite*; do sudo mv "$f" "before-restore-$f"; done
gunzip -c ~/<time>.sqlite.gz | sudo -u marketjury tee market-jury.sqlite > /dev/null
sudo systemctl start market-jury
```
