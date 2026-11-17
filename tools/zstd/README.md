# Vendored zstd

`zstd.exe` is the standalone Zstandard CLI, version 1.5.7, win64 build.

- Source: https://github.com/facebook/zstd/releases/download/v1.5.7/zstd-v1.5.7-win64.zip
- License: BSD-3-Clause OR GPL-2.0 (the upstream release carries both)

`apps/desktop-shell/scripts/prepare-shell.mjs` uses it for the offline package because the CLI
threads the pass across every core (`-T0`) while Node's zlib binding does not. The seed is large
enough that the difference decides whether a build takes minutes or half an hour. A machine with
`zstd` on `PATH` or `HARGLOBAL_ZSTD_BIN` set uses that instead; without either, the build falls back
to the Node binding at the same compression level.
