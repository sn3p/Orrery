# Deployment

[GitHub Pages](https://sn3p.github.io/Orrery/) updates after code changes are pushed
or merged to `master` and the selected checks pass. The
[GitHub Pages workflow](../.github/workflows/pages.yml)
installs locked dependencies with the Node.js version in `.tool-versions`, builds
a clean `dist/` from source, and deploys it. Pull requests targeting `master` check
the production build without deploying. A failed build prevents deployment.

New PR updates cancel obsolete runs for that PR. Production runs retain up to
100 pending runs, processed in the order they enter GitHub's concurrency queue.
New production runs beyond that limit are canceled by GitHub; see the [queue documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#example-queueing-multiple-pending-runs).

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

