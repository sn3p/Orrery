# Orrery

**Also check out [Orrery3D](https://github.com/sn3p/Orrery3D) ✨**

[Visualization](https://sn3p.github.io/Orrery) showing the orbits of [minor planets](https://en.wikipedia.org/wiki/Minor_planet) and their discovery over time.

Two datasets are used to extract the orbital elements and discovery circumstances of minor planets. The data used is maintained by [The Minor Planet Center (MPC)](https://minorplanetcenter.net/):

- [The MPC Orbit (MPCORB) Database](https://minorplanetcenter.net/iau/MPCORB.html) Database containing orbital elements of minor planets.
- [NumberedMPs.txt](https://minorplanetcenter.net/iau/lists/NumberedMPs.txt) Discovery circumstances of numbered minor planets.

## How to use

Use Node.js 24.15.0 or later in the 24.x release line (recommended),
22.22.3 or later in the 22.x release line, or 26.0.0 or later.

Install dependencies:

```bash
npm install
```

Start server:

```bash
npm run serve
```

Build and bundle:

```bash
npm run build
```

Watch changes and rebuild:

```bash
npm run watch
```

Run the production UI checks with Google Chrome installed:

```bash
npm test
```

These checks cover font loading, desktop/mobile layout and playback controls.
Screenshots and results are saved in `.context/font-qa/`.

The UI uses self-hosted [JetBrains Mono Variable](src/fonts/README.md),
distributed with its SIL Open Font License.

### Conductor

Setup installs the locked dependencies with `npm ci`. When asdf is installed,
it adds the Node.js plugin if needed and installs the version pinned in `.tool-versions`.
Run starts the development server on the workspace's assigned port; use Open
to view the app. Each workspace can run its own server concurrently.

Test the setup script with Python 3.11 or later:

```bash
python3 -m unittest discover -s tests -v
```

## Deployment

[GitHub Pages](https://sn3p.github.io/Orrery/) updates automatically after every
push or merged pull request to `master`. The [GitHub Pages workflow](.github/workflows/pages.yml)
installs locked dependencies with the Node.js version in `.tool-versions`, builds
a clean `dist/` from source, and deploys it. Pull requests targeting `master` check
the production build without deploying. A failed build prevents deployment.

Overlapping runs for the same branch retain up to 100 pending runs, processed in
the order they enter GitHub's concurrency queue. New runs beyond that limit are
canceled by GitHub; see the [queue documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#example-queueing-multiple-pending-runs).

No local build, generated-file commit, or push to `gh-pages` is needed to deploy.
The workflow publishes the checked-in catalogue; it does not download fresh MPC
data.

To deploy `master` again, open **Actions → GitHub Pages → Run workflow**, select
`master`, or use the authenticated [GitHub CLI](https://cli.github.com/):

```bash
npm run deploy
```

This command deploys the remote `master` branch, including when run from a local
feature branch; it does not publish uncommitted local changes. Check progress in
the repository's [Actions tab](https://github.com/sn3p/Orrery/actions/workflows/pages.yml).

Repository setup (once, also required for forks): in **Settings → Pages**, set
**Build and deployment → Source** to **GitHub Actions**. In **Settings → Environments
→ github-pages**, allow deployments from the `master` branch. The workflow must be
merged into `master` before automatic or manual deployment is available. It uses
GitHub's built-in token; no personal access token or deploy key is needed.

## Get updated data

Data files are stored in the `data` directory.
You can either download the data files manually using the links above, or use the download script:

Download the data and parse it to JSON:

```bash
cd data
./download_data.sh && ./data_to_json.py
```

The bundled `data/catalog.json` contains **100,000 objects**. Running the importer without a limit replaces it with all numbered minor planets that have matching discovery dates.

On **12 September 2026**, a full import of fresh MPC data produced **895,910 objects** from **1,563,495 orbital records**. Unnumbered objects lack matching discovery records in `NumberedMPs.txt` and are excluded. These counts change as MPC updates its datasets; see [issue #47](https://github.com/sn3p/Orrery/issues/47) for the verified counts and upstream limitation.

A full export produces a large JSON file and is expensive to render. You can limit the maximum number of results by passing a number as an argument:

```bash
./data_to_json.py 9999
```

The limit selects the first matching objects in MPCORB order, then sorts them by discovery date. It does not sample across the full discovery timeline.

## Screenshot

![Orrery screenshot](screenshot.png)
