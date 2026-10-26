# Roadmap

## Speech model download (Windows): `tar exited with code 1`

**Status:** Open

**Symptom:** Background download of local speech models (`parakeet-tdt-0.6b-v2-int8`, `kokoro-en-v0_19`) fails with `tar exited with code 1` on Windows. Logged in `packages/server/src/server/speech/providers/local/sherpa/model-downloader.ts:88`.

**Root cause (suspected):** `extractTarArchive` spawns the system `tar` binary with `stdio: "inherit"`. On Windows the available `tar` (bsdtar) may not support the archive format/flags, or the inherited stdio / path handling differs, causing extraction to fail.

**Resolution plan:**
- Replace the external `tar` invocation with a cross-platform extraction library (or Node's built-in zlib + a tar parser) so extraction does not depend on a system binary.
- Add a Windows-specific smoke test for `extractTarArchive` against a real model archive.
- Improve error reporting: capture stderr from the extraction process and include the archive path / exit code in the logged error.
- Retry with a clean destination directory on partial extraction failure.

**Owner:** speech / local provider module.