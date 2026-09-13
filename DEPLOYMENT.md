# Deploying Specref

Specref is made of two independently deployed parts, both served under the
`specref.org` domain:

| Hostname                                   | What it serves                              | Hosted on                                       |
| ------------------------------------------ | ------------------------------------------- | ----------------------------------------------- |
| `https://www.specref.org` (+ `specref.org`) | The static website (search UI) in [`docs/`](./docs/) | [GitHub Pages](https://pages.github.com/)     |
| `https://api.specref.org`                  | The JSON API ([`index.js`](./index.js))     | [Clever Cloud](https://www.clever-cloud.com/)   |

Both deploy automatically from the `main` branch of
[specinfra/specref](https://github.com/specinfra/specref), which is also what
the [hourly auto-update](./CONTRIBUTING.md#hourly-auto-updating) pushes to.
There is no manual deployment step.

## Table of Contents

* [API (Clever Cloud)](#api-clever-cloud)
  * [Health check](#health-check)
  * [Blocking IP addresses](#blocking-ip-addresses)
  * [Logging](#logging)
* [Website (GitHub Pages)](#website-github-pages)
* [DNS for specref.org](#dns-for-specreforg)

## API (Clever Cloud)

The API is a Node.js application (see the `engines` field in
[`package.json`](./package.json) for the required versions) hosted on
[Clever Cloud](https://www.clever-cloud.com/). It is started with `npm start`
(i.e. `node index.js`) and listens on the port given by the `PORT`
environment variable, which Clever Cloud sets automatically.

The application is linked to the GitHub repository, so every push to `main`
triggers a new build and deployment. Once the new instance answers the
[health check](#health-check), traffic is switched over to it.

[CORS is enabled for all origins](./README.md#cors) so that anyone can use
the API directly as JSON from a browser, whatever the origin of their page.
The API is not restricted to the Specref website in any way.

### Health check

The server exposes a lightweight health check endpoint at `/health` which
always responds with `200 OK` and `{ "status": "ok" }`, without touching the
reference database.

Clever Cloud must be configured to poll this endpoint (rather than `/`, which
returns a 404) so that it can tell whether the instance is up during
deployment and while it is running, and only restarts it when it actually
stops responding. Set the following environment variable on the Clever Cloud
application:

    CC_HEALTH_CHECK_PATH=/health

### Blocking IP addresses

Abusive clients can be blocked by IP address. The server rejects requests
from a list of IP addresses and CIDR ranges with a `403 Forbidden` (see
[`lib/ip-filter.js`](./lib/ip-filter.js)). The `/health` endpoint is never
blocked.

The list is read from the `BANNED_IPS` environment variable, as a
comma-separated list of IPv4/IPv6 addresses and/or CIDR ranges, for example:

    BANNED_IPS=34.96.130.0/24,34.77.162.0/24,203.0.113.7

Set it on the Clever Cloud application and restart it; there is no need to
change the code or redeploy. Setting the variable **replaces** the default
list hard-coded in [`index.js`](./index.js), which only applies when the
variable is unset. Setting it to an empty string blocks nothing.

Requests reach the application through Clever Cloud's load balancers, which
put the client's address in the `X-Forwarded-For` header. The application
therefore trusts that header (Express's `trust proxy` setting and
`express-ipfilter`'s `trustProxy` option) to find the address to check;
without this, it would only ever see the load balancer's own address and
the list would never match anything.

### Logging

The server logs to standard output, one JSON object per line, using
[pino](https://getpino.io/). Clever Cloud collects these and shows them in
the application's _Logs_ tab (and through `clever logs`).

The verbosity is set with the `LOG_LEVEL` environment variable, which takes
one of `fatal`, `error`, `warn`, `info` (the default), `debug`, `trace` or
`silent`:

    LOG_LEVEL=info

What gets logged:

* at startup, how many references were loaded, how long it took and the
  process' memory usage (`memory`, in MB: `rss`, `heapUsed`, `heapTotal`,
  `external`, `arrayBuffers`), then the same memory snapshot once a minute;
* one line per completed request (`request completed`), at `info` for
  successes, `warn` for 4xx and `error` for 5xx, with the method, URL,
  status, duration and response size. Requests to `/health` are not logged;
* at `debug`, an extra line when each request comes in (`request received`)
  with the memory usage at that point. If the process dies while handling a
  request, that line is the last thing in the logs and says which request
  it was;
* any error raised while handling a request, with its full stack trace
  under `err`. Clients get a JSON `{ "message": ... }` instead (the stack is
  only included in the response when `NODE_ENV` is `development`);
* whatever takes the process down: uncaught exceptions and unhandled
  promise rejections are logged at `fatal` with their stack before the
  process exits, shutdown signals (`SIGTERM`, `SIGINT`, `SIGHUP`) at `info`,
  and the exit code on exit. A restart with none of these in the logs
  therefore means the process was killed from outside, most likely by the
  kernel for exceeding the instance's memory; the periodic memory lines
  leading up to it tell how close it was.

To read the logs comfortably during local development, pipe them through
[pino-pretty](https://github.com/pinojs/pino-pretty):

    LOG_LEVEL=debug node index.js | npx pino-pretty

## Website (GitHub Pages)

The website at [www.specref.org](https://www.specref.org/) is a static site
whose source lives in the [`docs/`](./docs/) directory. It is published by
[GitHub Pages](https://docs.github.com/en/pages) from the `main` branch.

Repository settings (_Settings → Pages_):

* **Source:** _Deploy from a branch_
* **Branch:** `main`, folder `/docs`
* **Custom domain:** `www.specref.org` (this must match the content of
  [`docs/CNAME`](./docs/CNAME), which GitHub Pages reads at build time; do not
  delete or edit that file unless you are changing the domain)
* **Enforce HTTPS:** enabled

The site is rendered by Jekyll. [`docs/_config.yml`](./docs/_config.yml) only
exists to make Jekyll include the `.well-known/` directory, which it would
otherwise skip because of the leading dot.

The website is a plain client of the API: it fetches JSON from
`https://api.specref.org` from the browser like any other consumer would.

## DNS for specref.org

The `specref.org` domain is registered and its DNS zone hosted at
[Namecheap](https://www.namecheap.com/), on an account owned by Tobie Langel.

The zone points at both hosting providers:

* the apex `specref.org` and `www.specref.org` point at **GitHub Pages**.
  `www.specref.org` is the canonical hostname (it is the custom domain
  configured in the repository settings and in `docs/CNAME`); because the
  apex also resolves to GitHub Pages, GitHub automatically redirects
  `https://specref.org/…` to `https://www.specref.org/…`.
* `api.specref.org` points at **Clever Cloud**. The hostname must also be
  added to the application's _Domain names_ in the Clever Cloud console,
  otherwise Clever Cloud's load balancers will not route requests for it to
  the application. Clever Cloud provisions and renews the TLS certificate
  automatically once the record resolves.

Each provider only ever sees the hostname it is responsible for, so moving
one part (e.g. the API to a different host) only requires changing that
hostname's record at Namecheap.
