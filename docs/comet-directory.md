# Searchable comet directory integration

This integrates OrreryData [PR19](https://github.com/sn3p/orrery-data/pull/19),
revision `53a6ce491c5b5a119236fc629e54449bf15920a5`, on Orrery's merged PR121 chooser.
The authoritative wire contract and producer handoff are
[upstream](https://github.com/sn3p/orrery-data/blob/53a6ce491c5b5a119236fc629e54449bf15920a5/docs/comet-directory.md).

The production endpoint remains unchanged. Its reader now accepts schema 4 in
addition to 2/3. The exact expanded candidate has 4,089 searchable entries and
fourteen trajectories. The producer contract retains `1P, 2P, 55P, 9P, 10P, 67P` as legacy default metadata.
The app seeds new selections with `1P, 2P, 55P, 67P, c1000079` (29P), independently
of that metadata; saved selections, including empty ones, take precedence.
The PR121 selection journal, empty selection, missing IDs, Clear/Undo and
cross-tab reconciliation remain authoritative. Stable opaque IDs and Unicode
aliases are searchable. Assessment labels differ from coverage gaps; ordinary
covered rows stay blank. Unpublished trajectories cannot be selected for display.

Schema-4 acquisition requests a bounded period-based window (ten years where no
presentation period is known), with a 64-day margin and date buckets to avoid
per-frame fetch churn. New segmented trajectories draw and Fit the explicit requested window, so sampling steps and resident support blocks cannot shift or truncate it. Legacy trajectories retain the established full-data, grid-rounded presentation. Acquisition retains the last verified window while a replacement loads, finishes in-flight work before following the latest playback window, and releases it on successful replacement or deliberate deselection. Hiding comets suspends requests while preserving selected models. Failed replacements remain explicitly retryable.
Only published trajectories allocate renderer objects. Reader caches retain the
producer's separate 16 MiB serialized-byte budgets; these are not heap limits.
Discovery events and citations come unchanged from the authenticated legacy index.

Exact acceptance can run without starting a server or creating images:

```sh
# Checkout sn3p/orrery-data at 53a6ce491c5b5a119236fc629e54449bf15920a5 in .context/producer
python3 .context/producer/scripts/comet_directory_candidate.py
node tests/run-comet-directory.cjs .context/producer chromium
node tests/run-comet-directory.cjs .context/producer webkit
```

Each lane routes the assembled bytes into an isolated browser and exercises both
Pixi and Three, five app defaults (four in the older catalogue), all published trajectories, Fit with paths hidden,
corruption/retry and bundled rollback. Expanded checks cover 4,089 entries,
fourteen renderer objects, assessment labels, paging, narrow/wide layout,
paused seeks, discovery metadata, persistence of missing IDs and empty selection.
The existing history/browser suite covers historical starts, seam ownership,
support-only overlap, end boundaries, Timeline and renderer switching.

| Lane | Exact index pin |
| --- | --- |
| Existing production | `a9de1f2f711dd65e880102de7c1f0c14bf20598a20d9cc4e001081406e40c2e2` |
| Expanded candidate | `907f8cb552c65db81eb3ec3167b0d422e764ab5fef1fcbbb948e63cae21f1070` |

Deploy and verify the accepting application before any separately authorized
producer activation. This PR neither activates hosted data nor establishes
deployed-reader acceptance. The stable five-comet starter set is app-owned; date-dependent active selection remains deferred.
