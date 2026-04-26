# Self-hosted Arweave Gateway (ar.io)

Our own root access to Arweave. No reliance on `arweave.net` or any other
third party. Serves HTTP data, GraphQL, and ArNS for the entire network —
uncensored, because **we** control the blocklist (and it's empty).

This is a Docker Compose deployment of the
[ar.io reference gateway node](https://github.com/ar-io/ar-io-node), fronted by
Caddy for automatic TLS, wired into the `cloonan-group` Next.js app as the
primary source for all Arweave reads.

---

## Architecture

```
     ┌───────────────── cloonangroup.com (Next.js) ─────────────────┐
     │                                                              │
     │  lib/gateway-pool.ts  ── primary ──▶  gateway.cloonangroup.com
     │                        │                                     │
     │                        └─ fallback ──▶ arweave.net, ar-io.net│
     └──────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                 ┌─────────────── your VPS ───────────────┐
                 │  Caddy  (auto-HTTPS, wildcard, CORS)   │
                 │     │                                  │
                 │     ▼                                  │
                 │  Envoy  (sandbox subdomains, routing)  │
                 │     │                                  │
                 │     ▼                                  │
                 │  ar-io-core  ◀──▶  Redis (hot cache)   │
                 │     │                                  │
                 │     ▼                                  │
                 │  /data  (SQLite index + chunks cache)  │
                 └──────────────── Arweave P2P ──────────┘
```

---

## Hardware

Minimum (cache-only, lightweight indexing from recent height):

| Resource | Recommended         |
| -------- | ------------------- |
| vCPU     | 4                   |
| RAM      | 16 GB               |
| Disk     | 500 GB NVMe         |
| Bandwidth| 10 TB/mo unmetered  |

Good providers: Hetzner CCX23, OVH, DigitalOcean Premium CPU, any dedicated box.

If you want to serve the **entire** weave history (tens of TB), provision
accordingly and set `START_HEIGHT=0` in `.env`.

---

## 1. DNS

Add two records pointing at the server's public IP:

```
gateway.cloonangroup.com        A   <server-ip>
*.gateway.cloonangroup.com      A   <server-ip>
```

The wildcard is required so that `<arns-name>.gateway.cloonangroup.com`
sandbox URLs work. If you're using Cloudflare, grey-cloud (DNS only) both
records so Caddy can terminate TLS.

---

## 2. Server prerequisites

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin jq curl

# Allow HTTP(S)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

Create a deploy user (optional but recommended):

```bash
sudo adduser --disabled-password deploy
sudo usermod -aG docker deploy
```

---

## 3. Get the code on the server

```bash
sudo mkdir -p /opt && cd /opt
sudo git clone https://github.com/shanecloonan/cloonan-group.git
sudo chown -R deploy:deploy cloonan-group
sudo -u deploy -i
cd /opt/cloonan-group/infra/arweave-gateway
```

---

## 4. Configure

```bash
cp .env.example .env
# Fill in ARNS_ROOT_HOST, ACME_EMAIL, ADMIN_API_KEY at minimum.
# Generate the admin key:
openssl rand -hex 32
vim .env
```

The critical knobs:

- `ARNS_ROOT_HOST` — your wildcard domain (e.g. `gateway.cloonangroup.com`)
- `ACME_EMAIL` — Let's Encrypt registration email
- `ADMIN_API_KEY` — long random hex string; required to call `/ar-io/admin/*`
- `START_HEIGHT` — how far back to index (`1407552` ≈ early 2024)
- `ARNS_NAMES_BLACKLIST_URL` — **leave empty** for zero-censorship

---

## 5. Launch

```bash
chmod +x scripts/*.sh
./scripts/deploy.sh
```

Docker will pull ~5 images (~2 GB) and start the stack. Caddy will request
Let's Encrypt certs automatically on first HTTPS hit.

---

## 6. Verify

```bash
./scripts/healthcheck.sh
curl -s https://gateway.cloonangroup.com/ar-io/info | jq
curl -s https://gateway.cloonangroup.com/info      | jq '.height'
```

Expected once synced:

```json
{
  "wallet": "",
  "processId": "agYcCFJtrMG6cqMuZfskIkFTGvUPddICmtQSBIoPdiA",
  "ans104UnbundleFilter": { "never": true },
  "release": 40,
  "blockHeight": 1543210,
  "supportedManifestVersions": ["0.1.0", "0.2.0"]
}
```

The first `blockHeight` may lag behind the network for hours while the index
catches up. Data requests (`/{txId}`) start working almost immediately because
they are proxied + cached from `TRUSTED_GATEWAY_URL` until the local index
has them.

---

## 7. Auto-start on boot

```bash
sudo cp systemd/arweave-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now arweave-gateway
```

---

## 8. Wire into the Next.js app

In Vercel (and local `.env.local`) set:

```
NEXT_PUBLIC_ARWEAVE_PRIMARY_GATEWAY=https://gateway.cloonangroup.com
```

The app's `lib/gateway-pool.ts` will immediately start serving reads from your
node, falling back to the pool only if yours errors. The `/gateway` Network
tab shows live status.

---

## Censorship policy

This is **your** gateway. The default config:

- Does **not** honor any external blocklist
- Does **not** apply content moderation
- Sets `CONTENT_MODERATION_MODE=allow-all`

To verify nothing is being filtered:

```bash
curl -s -H "Authorization: Bearer $ADMIN_API_KEY" \
  https://gateway.cloonangroup.com/ar-io/admin/block-list
# expected: {"ids": [], "names": [], "sources": []}
```

If you ever want to add a local blocklist (e.g. known-malicious txids), POST
to `/ar-io/admin/block-data` with the admin key.

---

## Operations

### Logs
```bash
docker compose logs -f core
docker compose logs -f envoy caddy
```

### Updating
```bash
cd /opt/cloonan-group
git pull
cd infra/arweave-gateway
./scripts/deploy.sh   # pulls new images + restarts
```

### Backups
Only two things are stateful:
- `ar-io-data` volume — SQLite indexes + chunk cache. Rebuilt on resync if lost.
- `caddy-data` — Let's Encrypt keys. Lose this and Caddy just re-issues.

Neither is irreplaceable, but snapshotting `ar-io-data` weekly is good hygiene.

### Join the AR.IO network (optional, for rewards)
1. Fund `AR_IO_WALLET` with ARIO tokens
2. Stake via the ar.io network process (see ar.io docs)
3. Enable the `observer` profile: `docker compose --profile observer up -d`

You don't need any of this to just run a gateway for yourself.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Caddy fails TLS handshake | Confirm DNS is propagated + port 80/443 open |
| `502 Bad Gateway` from Caddy | `docker compose logs core` — node still booting |
| Node stuck at low height | Check peers: `curl -s .../peers` — if empty, verify egress |
| High disk usage | Lower `START_HEIGHT` or set `ANS104_INDEX_FILTER` tighter |
| Wildcard cert fails | Use DNS-01 (uncomment Caddyfile line + add provider token) |
| Admin API rejects | Confirm `Authorization: Bearer $ADMIN_API_KEY` header |

---

## Why self-host?

- **No censorship** — arweave.net maintains a public blocklist. Your gateway doesn't.
- **Sovereignty** — if every public gateway disappeared tomorrow, yours still works.
- **Performance** — warm cache of *your* content (PermaWrite repos, brand assets) is instant.
- **Privacy** — your users' reads are not logged by a third party.
- **Censorship-resistance credibly demonstrated** — the `/gateway` dashboard publicly shows the empty blocklist.
