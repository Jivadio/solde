# Self-hosting Solde

Thanks for trying Solde! This page walks you through running your own instance with Docker Compose, keeping it safe, and upgrading it.

A word on where things stand: Solde is early. The server, the web app, sign-in, household members, manual accounts and transactions and sharing all work. Bank connections don't exist yet, so there is nothing to sync and no bank credentials to store. Please don't rely on it as your only record of anything just yet.

## Quickstart

You need Docker with the Compose plugin, and a few GB of free disk space if Compose builds the image from source.

```sh
git clone https://github.com/Jivadio/solde.git
cd solde
docker compose up -d                         # PostgreSQL
# or
docker compose -f compose.sqlite.yaml up -d  # SQLite, one container fewer
```

On the first start, Compose looks for the server image `ghcr.io/jivadio/solde`. Each release from 0.1.0 on publishes it there, for linux/amd64 only for now (multi-arch images will come later). Until the first release is out, or when the image cannot be pulled, Compose builds it from source instead, which takes a few minutes. On an ARM machine (a Raspberry Pi, a Mac with Apple silicon...), build it from source with `docker compose up -d --build`. See [Choosing a version](#choosing-a-version) to pin one. Then open <http://localhost:8080>: Solde asks you to name your household and create the first admin account. From there you can invite the other members of your household.

Solde also asks for a **setup code**. Until the first admin exists, the server prints a one-time code in its log, so only someone who can read that log (you) can claim the new instance, even if a stranger reaches it first:

```sh
docker compose logs server | grep "setup code"
# or, with SQLite
docker compose -f compose.sqlite.yaml logs server | grep "setup code"
```

Copy the `XXXX-XXXX-XXXX-XXXX` code into the setup screen. It stops working once setup is done, and each restart before then prints a new one. It is the only secret Solde ever writes to its log, on purpose and only for this reason.

What just happened:

1. `keygen`, a one-shot container, created the **master key** in its own volume (`solde-keys`). It never prints the key, and on later starts it sees the key is there and does nothing.
2. `postgres` (Postgres variant only) started with its data in the `solde-pgdata` volume.
3. `server` loaded the key, applied the database migrations, and started serving the web app and the API.

Check that it's healthy with `docker compose ps` (the server shows as `healthy`) or `curl http://localhost:8080/healthz`, and follow the logs with `docker compose logs -f server`.

### Health check

The image has a Docker `HEALTHCHECK`: every 30 seconds (every 2 seconds while it starts, with Docker Engine 25 or later; older engines probe every 30 seconds from the start), it runs `solde-server healthcheck`, which calls `GET /healthz` on the server's own port (from `SOLDE_LISTEN_ADDR`) and exits 0 when it answers 200, 1 otherwise. The image has no shell or curl, so the server binary does the probe itself. It reads no key and opens no database, so it never touches your secrets. `docker compose ps` and `docker inspect` show the result, and monitoring tools or an orchestrator can rely on it too.

### Settings

Compose reads these from your shell or from a `.env` file next to the compose files:

| Variable | Default | What it does |
|----------|---------|--------------|
| `SOLDE_POSTGRES_PASSWORD` | `change-me` | Password of the database user (Postgres variant). Set it **before the first start**: PostgreSQL stores it when it creates the database. The database is not published outside the Compose network. |
| `SOLDE_PORT` | `8080` | Port on the host. |
| `SOLDE_BIND_ADDRESS` | `127.0.0.1` | Host address the port is published on. The default keeps Solde reachable from this machine only; see [On a home network](#on-a-home-network-without-https) before you change it. |
| `SOLDE_INSECURE_COOKIES` | `0` | See [On a home network](#on-a-home-network-without-https). |
| `SOLDE_TRUSTED_PROXIES` | *(empty)* | See [Behind a reverse proxy](#behind-a-reverse-proxy). |
| `SOLDE_KEYS_SOURCE` | `solde-keys` volume | A directory holding your own `master.key`; see [Bringing your own key](#bringing-your-own-key). |
| `SOLDE_VERSION` | `latest` | Tag of the server image `ghcr.io/jivadio/solde`; see [Choosing a version](#choosing-a-version). |
| `RUST_LOG` | `info` | Log level of the server. |

The full list of server settings is in the [README](../README.md#configuration).

### Choosing a version

The compose files use the image `ghcr.io/jivadio/solde:${SOLDE_VERSION:-latest}`. Once releases are published, pin one: it is the normal way to run Solde, and an upgrade then only happens when you decide. Put this in the `.env` file next to the compose files:

```sh
SOLDE_VERSION=0.1.0
```

Compose uses the image of that version if it is already on your machine and pulls it otherwise. Once the image is published, **Compose pulls it rather than building your checkout**, so local changes to the source are not used. It only builds from your checkout when the image cannot be pulled (before the first release, for example). `docker compose pull server` fetches the image explicitly.

To build from source instead (on an ARM machine, or to run changes of your own):

- once: `docker compose build server`, then `docker compose up -d` (it uses the image you just built);
- every time: add `pull_policy: build` to the server. With the PostgreSQL variant, a `compose.override.yaml` next to `compose.yaml` is picked up automatically:

  ```yaml
  services:
    server:
      pull_policy: build
  ```

  With SQLite, pass it explicitly: `docker compose -f compose.sqlite.yaml -f compose.override.yaml up -d`.

The image you build gets the `SOLDE_VERSION` tag, so check out the matching release tag (`git checkout v0.1.0`) first, or unset `SOLDE_VERSION` to keep `latest`.

### PostgreSQL on another machine

The bundled `compose.yaml` talks to its own PostgreSQL over the internal Compose network, without TLS: that traffic never leaves the machine. If you point Solde at a PostgreSQL server on another machine instead, use TLS and check the server's certificate, with `sslmode=verify-full` in `SOLDE_DATABASE_URL` and, for a certificate signed by your own CA, the path to that CA in `sslrootcert`:

```sh
SOLDE_DATABASE_URL=postgres://solde:password@db.example.test:5432/solde?sslmode=verify-full&sslrootcert=/run/solde-db/ca.pem
```

Mount the CA file read-only into the container (for example at `/run/solde-db/ca.pem`). `verify-full` checks both that the certificate is signed by a CA you trust and that it was issued for the host name in the URL; weaker modes such as `require` encrypt the traffic but let anyone in the middle pretend to be your database.

## Back up the key and the data, separately

Solde keeps two things you should back up, and they belong in **different places**:

- **The master key.** Today Solde does not encrypt anything with it yet. Once bank connections arrive, it will protect your saved bank credentials, and without it they cannot be decrypted: you would have to enter them again. Your financial data itself stays readable without the key.
- **The data**: your household, accounts and transactions.

Keeping them apart means that someone who gets hold of a data backup does not also get the key.

### The key

Print it once and store it somewhere safe and offline, such as a password manager:

```sh
docker compose run --rm server admin export-key
# SQLite variant:
docker compose -f compose.sqlite.yaml run --rm server admin export-key
```

This is the only time Solde ever prints the key. It never appears in the logs.

### The data

Backups hold all your household's data. The commands below write each one to a fresh file that only you can read (`mktemp` creates it with mode `0600`) and give it its dated name only once it is complete, so a failed run never replaces a good backup.

With PostgreSQL:

```sh
tmp=$(mktemp solde-backup.XXXXXX)
docker compose exec -T postgres pg_dump -U solde solde > "$tmp" &&
  mv "$tmp" solde-$(date +%F).sql
```

With SQLite, stop the server for a moment so the database file is consistent, then copy the volume:

```sh
docker compose -f compose.sqlite.yaml stop server
tmp=$(mktemp solde-backup.XXXXXX)
docker run --rm --volumes-from "$(docker compose -f compose.sqlite.yaml ps -aq server)":ro \
  alpine:3.22 tar czf - -C /data . > "$tmp" &&
  mv "$tmp" solde-data-$(date +%F).tgz
docker compose -f compose.sqlite.yaml start server
```

Restore only backups you made yourself: a database file can be crafted to misbehave when it is opened. Before restoring a SQLite backup, stop the server and delete any `solde.db-wal` and `solde.db-shm` files next to `solde.db`, so SQLite does not mix them with the restored file.

## Bringing your own key

To restore a backed-up key on a new machine, or to manage the key yourself:

1. Put it in a directory as `master.key` (the base64 text that `export-key` printed), readable by the server's user (uid 65532) and nobody else on the host:

   ```sh
   sudo mkdir -p /srv/solde-keys
   sudo cp master.key /srv/solde-keys/master.key
   sudo chown 65532:65532 /srv/solde-keys/master.key
   sudo chmod 0755 /srv/solde-keys && sudo chmod 0400 /srv/solde-keys/master.key
   ```

   The directory stays listable so `keygen` can see that a key is there; only the server's user can read the key itself. With rootless Docker or `userns-remap`, container UID 65532 is a different UID on the host (see `/etc/subuid` and `/etc/subgid`): use that host UID and GID instead of `65532:65532`.

2. Start Solde with `SOLDE_KEYS_SOURCE=/srv/solde-keys`. `keygen` sees the key and leaves it untouched.

If the server finds no key at all, it refuses to start and explains how to provide one. That is on purpose: it never runs without its key.

## On a home network without HTTPS

By default Solde is published on `127.0.0.1` only, and the session cookie is marked `Secure`, so browsers send it over HTTPS only. Most browsers make an exception for `http://localhost`, so the quickstart works as is.

To reach Solde from other devices on a trusted home network over plain HTTP, set both:

```sh
SOLDE_BIND_ADDRESS=0.0.0.0
SOLDE_INSECURE_COOKIES=1
```

The server then logs a warning at every start. Anyone on the network who can watch the traffic can read the session cookie, so only do this on a network you trust, and never expose Solde to the internet this way. HTTPS through a reverse proxy is the better option whenever you can set one up.

## Behind a reverse proxy

Put Solde behind a reverse proxy (Caddy, nginx, Traefik...) to get HTTPS. Keep `SOLDE_BIND_ADDRESS=127.0.0.1` when the proxy runs on the same host, so only the proxy can reach Solde.

Solde limits login (and setup and invitation) attempts per client address: 5 a minute per IPv4 address or IPv6 /64, and 60 a minute in total. Behind a proxy every request seems to come from the proxy, so tell Solde which addresses are proxies with `SOLDE_TRUSTED_PROXIES` (comma-separated IPs or CIDR ranges). It then reads the real client address from `X-Forwarded-For`, but only on requests that come from those addresses; from anyone else the header is ignored, so it cannot be forged.

Use the address the server actually sees for your proxy. With Docker's port publishing that is usually the gateway of the Compose network (for example `172.18.0.1`), which you can find with `docker network inspect solde_default`; if the proxy is a container on the same Compose network, it is that container's address. Trust as narrow a range as you can.

Your proxy should also pass the `Host` header through and must not cache `/api` responses (Solde marks them `no-store`).

## Upgrading

1. Back up the data (see above). Your key does not change during an upgrade.
2. Get the new version and restart.

   With the published image, set the new `SOLDE_VERSION` in your `.env` (or keep `latest`), then pull it and restart:

   ```sh
   docker compose pull server
   docker compose up -d
   # or, with SQLite
   docker compose -f compose.sqlite.yaml pull server
   docker compose -f compose.sqlite.yaml up -d
   ```

   Building from source instead:

   ```sh
   git pull
   docker compose up -d --build
   # or, with SQLite
   docker compose -f compose.sqlite.yaml up -d --build
   ```

   Compose never replaces an image that is already on your machine by itself: without `pull` or `--build`, `docker compose up` keeps running the version you have.

The server applies any new database migrations when it starts. There is no downgrade: a server refuses to open a database that a newer Solde has already migrated, so if you need to go back to an older version, restore the backup you made in step 1.

## What the web app sends to your browser

The server serves the web app itself, with headers that keep the browser strict: a Content Security Policy that only allows scripts, styles, fonts and API calls from your own instance (no inline scripts, no third parties), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and no framing by other sites. Hashed files under `/assets/` are cached for a year, while `index.html` is revalidated on every visit, so upgrades show up right away. More in [security-model.md](security-model.md).

## Something's not right?

- **The server exits with "no master key"**: `keygen` did not run or did not finish. Run `docker compose up` again and look at `docker compose logs keygen`.
- **`docker compose ps` shows the server as `unhealthy`**: it is not answering on its port. Look at `docker compose logs server`, and at `docker inspect --format '{{json .State.Health}}' "$(docker compose ps -q server)"` for the last probes.
- **Setup says the code is wrong**: use the code from the latest `docker compose logs server` (a restart prints a new one). After a few wrong tries, wait a minute.
- **The page loads but you can't stay signed in**: you are probably on plain HTTP from another device; see [On a home network](#on-a-home-network-without-https).
- **Anything else**: please open an issue with the server logs (`docker compose logs server`). They never contain your key or your passwords (only the one-time setup code, until setup is done), but do have a quick look before sharing them.
