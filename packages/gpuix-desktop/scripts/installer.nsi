; Per-user installer for the experimental GPUIX shell.
;
; Installs into %LOCALAPPDATA%\Programs\9Router-GPUIX, a directory that the
; shipping Electron app never uses, so both can be installed side by side.
; Data stays in %APPDATA%\9router-gpuix and the port stays 20129; uninstalling
; removes program files only.
Unicode true
!include "MUI2.nsh"

!define APPNAME "9Router (Experimental)"
!define SHORTNAME "9Router-GPUIX"
!ifndef VERSION
  !define VERSION "0.1.0"
!endif
!ifndef SRCDIR
  !error "SRCDIR must be defined (packed folder)"
!endif
!ifndef OUTFILE
  !define OUTFILE "${SHORTNAME}-${VERSION}-win-x64-setup.exe"
!endif

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${SHORTNAME}"
InstallDirRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SHORTNAME}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${SRCDIR}\*.*"
  WriteUninstaller "$INSTDIR\uninstall.exe"

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\run-gpuix.cmd" "" "$INSTDIR\run-gpuix.cmd" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Uninstall.lnk" "$INSTDIR\uninstall.exe"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SHORTNAME}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SHORTNAME}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SHORTNAME}" "DisplayIcon" "$INSTDIR\run-gpuix.cmd"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SHORTNAME}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SHORTNAME}" "Publisher" "9Router"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SHORTNAME}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SHORTNAME}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SHORTNAME}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Uninstall.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SHORTNAME}"
SectionEnd
