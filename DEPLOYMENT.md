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
