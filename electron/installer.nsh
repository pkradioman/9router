; Installer overrides for the desktop build.
;
; Two problems this solves:
;
; 1. `9Router.exe` is a tray app: with the window hidden there is no top-level
;    window for the stock CHECK_APP_RUNNING probe to find, so the app can still
;    be running while the installer replaces files.
;
; 2. Every fork build reports the same version (0.5.119), so installs are
;    same-version re-installs. electron-builder runs the *old* uninstaller and
;    aborts the install when it returns non-zero - which it does here, because
;    the running gateway writes Next's route cache into its own install dir
;    (resources\app\runtime\desktop-dist\server\route-cache) and leaves files
;    the in-place uninstaller cannot remove. Result: exit code 2, nothing
;    installed.
;
; So: kill the app by image name up front, and ignore the old uninstaller's
; exit code. The new tree overwrites the old one; leftovers are limited to
; files that no longer ship.

!macro preInit
  ; /T kills the Electron child processes (renderer, GPU, utility) too.
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM 9Router.exe'
  Sleep 700
  ; Next's prerendered route cache lives in the install dir and survives an
  ; in-place upgrade. Stale entries reference the previous build's chunks, so
  ; the dashboard would keep running the old UI. The app also clears this when
  ; BUILD_ID changes, but do it here so an install always starts clean.
  RMDir /r "$INSTDIR\resources\app\runtime\desktop-dist\server\route-cache"
!macroend

!macro customUnInstallCheck
  ; Deliberately empty: see the note above. handleUninstallResult() returns
  ; early when this macro exists, so a non-zero old-uninstaller exit no longer
  ; aborts the install.
!macroend
