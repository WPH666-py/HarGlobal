; Installer hooks for the HarGlobal Tauri shell.
;
; The payload directory is removed before this release lands. The bundled seed names every file it
; ships after the release that produced it (`…-0.2.1-rc.4.tgz`), and the first launch refuses a seed
; that holds a file its own inventory does not list. Installing over an older version without
; clearing the old seed therefore left both sets on disk, and the upgrade would fail at
; `desktop seed: integrity verification failed` with a perfectly good download. The check is right
; to be strict — a seed that is not exactly what was published is not something to assemble a
; runtime from — so the installer is what has to leave it exactly as published.

!macro NSIS_HOOK_PREINSTALL
  ; Everything this release owns and replaces wholesale: the runtime, the seed, the shell pages,
  ; and the sidecar. User data lives under the product's own home and is never touched here.
  RMDir /r "$INSTDIR\resources"
!macroend

; Building the runtime during setup was removed. It ran the sidecar with `--prebuild`, which on a
; machine without network fetched the seed before setup could finish: the step was bounded only by
; a twenty-minute timeout, so an installer that looked hung was one waiting on a download nobody
; asked for. Setup now lays files down and returns; the first launch performs the same transaction
; in front of the progress window that exists to show it, and the fetch happens once behind that
; window instead of inside the installer's own silence.
!macro NSIS_HOOK_POSTINSTALL
!macroend
