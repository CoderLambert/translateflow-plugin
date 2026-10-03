# Build and test output path safety

Directory replacement is a source-preservation boundary. All build output and
production test-copy comparisons use `scripts/path-boundaries.mjs`.

`pathRelation(parent, candidate, pathApi)` resolves both inputs and returns
`same`, `descendant`, `ancestor`, or `disjoint`. Equality is explicit, including
trailing separators, `.`/`..`, Windows case/separator aliases and UNC roots.
Never replace it with raw string equality or a hard-coded `../` prefix.
The injected path API permits cross-platform pure tests on the current host;
it does not constitute a Windows filesystem or browser test.

`assertBuildOutputLocation` rejects the source root, its ancestors, filesystem
roots, and source children outside a package directory below `dist/` or the
exact `.output/chrome-mv3` package only with an explicit `allowWxtOutput` option
reserved for a WXT writer. The legacy builder never enables that option, so it
cannot overwrite a WXT package with raw output. The whole `dist/` directory is
not an output.
An external test opt-in does not bypass source protection.

`assertBuildOutputPaths` additionally checks existing path components without
mutation, rejects symlinks and non-directory components, and compares canonical
paths, including outputs whose parents do not yet exist. External test outputs
must be descendants of the OS temporary directory and must not be in another
Git workspace below that temporary root. Internal outputs also reject a nested
Git workspace below the owning source root. The temporary root itself cannot be
replaced. Existing test/certification callers use their own `mkdtemp` directory.
These callers remain responsible for owning the disposable destination.
Existing output trees are recursively checked for nested `.git` markers and
symlinks before replacement or test-copy mutation; checking only ancestors is
insufficient. Source and OS temporary roots are trusted canonical boundaries,
so system aliases above them (such as macOS `/var`) do not reject valid output.
The temporary root's OS spelling and canonical spelling both permit descendant
outputs; the root itself remains protected in either spelling. Links below the
owning boundary remain forbidden.

The legacy builder validates before setup and again immediately before deleting
its output. The WXT raw resource bridge uses the same relation for confinement.
The production artifact adapter rejects both lexical and canonical overlap,
destination symlinks, and foreign Git workspaces before copying; its disposable
destination must also be below the OS temporary directory. These checks do not
grant permission to remove arbitrary data.
They do not provide an atomic guarantee against another process changing the
filesystem concurrently; builders must run in an isolated, owned workspace.

Tests that reject source/worktree roots call the **pure predicate only**.
Filesystem and actual build tests create disposable directories with `mkdtemp`,
use synthetic Git markers/sentinels, and assert that rejected links leave those
sentinels intact. A destructive call against a real source root is forbidden,
even if the test expects that call to throw.

Any later WXT default-build adapter must use this contract before publishing or
replacing output. Stage and rollback directories must be owned and distinct
from source/output; audit and path validation must succeed before publication.
Failure cleanup must not delete the sole source or rollback copy. Such a later
adapter requires its own implementation review and disposable-directory tests.
This fix does not switch the default build or complete that migration.
