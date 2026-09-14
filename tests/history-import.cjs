const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const record = require("../docs/history/orrery3d.json");

const root = path.resolve(__dirname, "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();

try {
  assert.equal(git("rev-parse", "--is-shallow-repository"), "false",
    "History verification needs a full clone; run git fetch --unshallow first.");
  const target = git("rev-parse", "--verify", "--end-of-options", `${process.argv[2] || "HEAD"}^{commit}`);
  const reachable = new Set(git("rev-list", target).split("\n"));
  assert(reachable.has(record.importCommit), "The original subtree import must remain an ancestor; do not squash or rebase H.");
  const original = git("rev-list", record.sourceCommit).split("\n").sort();
  assert.deepEqual(original, [...record.sourceCommits].sort(), "The recorded original commit list must be complete and unique.");
  for (const commit of record.sourceCommits) {
    assert(reachable.has(commit), `Original Orrery3D commit is not reachable: ${commit}`);
    // Git object IDs cover the original tree, parents, author/committer dates,
    // identities and message; recompute them from the unchanged object bytes.
    const object = execFileSync("git", ["cat-file", "commit", commit], { cwd: root });
    const actual = execFileSync("git", ["hash-object", "-t", "commit", "--stdin"], { cwd: root, input: object, encoding: "utf8" }).trim();
    assert.equal(actual, commit, `Original commit object changed: ${commit}`);
  }
  assert.equal(git("rev-parse", `${record.sourceCommit}^{tree}`), record.sourceTree);
  assert.equal(git("rev-parse", `${record.importCommit}:${record.prefix}`), record.sourceTree,
    "The imported snapshot must match every original path, file mode and blob.");
  assert.deepEqual(git("show", "-s", "--format=%P", record.importCommit).split(" "),
    [record.destinationBase, record.sourceCommit], "The import joins the original source as its second parent.");
  assert.equal(git("diff", "--name-only", record.destinationBase, record.importCommit,
    "--", ".", `:(exclude)${record.prefix}/**`), "", "The import must only add its inactive snapshot.");
  console.log(`Verified ${original.length} original Orrery3D commits, exact imported tree and original ancestry from ${target}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
