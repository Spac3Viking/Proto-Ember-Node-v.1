Unicode true
RequestExecutionLevel user

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!define APP_NAME "Ember Node"
!ifndef APP_VERSION
  !define APP_VERSION "0.0.0"
!endif
!define COMPANY_NAME "Ember Node"
!define REG_PATH "Software\${APP_NAME}"
!define APP_ICON_PNG "..\assets\ember-node-icon.png"
!define APP_ICON_ICO "..\assets\ember-node-icon.ico"

Name "${APP_NAME}"
OutFile "Ember-Node-Setup.exe"
BrandingText "ᚠ Ember Node Installer"
Icon "${APP_ICON_ICO}"
UninstallIcon "${APP_ICON_ICO}"

InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "${REG_PATH}" "InstallDir"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Awaken-Ember-Node.bat"
!define MUI_FINISHPAGE_RUN_TEXT "Awaken Ember Node"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function .onInit
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${APP_NAME}"
FunctionEnd

Section "Install Ember Node" SEC_MAIN
    SetShellVarContext current
    SetOutPath "$INSTDIR"

    StrCpy $0 "$DOCUMENTS\Ember-Node-Data"
    IfFileExists "$0\*" 0 +2
        DetailPrint "Existing Ember Node data detected. It will be preserved."

    ; Replace app files only. External Ember-Node-Data remains untouched.
    RMDir /r "$INSTDIR\app"
    RMDir /r "$INSTDIR\public"
    RMDir /r "$INSTDIR\caches"
    RMDir /r "$INSTDIR\data"
    RMDir /r "$INSTDIR\runtime"
    RMDir /r "$INSTDIR\node_modules"

    CreateDirectory "$INSTDIR\installer\assets"
    File /oname=$INSTDIR\installer\assets\ember-node-icon.png "${APP_ICON_PNG}"
    File /oname=$INSTDIR\installer\assets\ember-node-icon.ico "${APP_ICON_ICO}"

    ; Core runtime files
    File /r "..\..\app"
    File /r "..\..\public"
    File /r "..\..\caches"
    File /r "..\..\runtime"
    ; Bundled seed scaffold + canonical archive baseline for first-run initialization.
    File /r "..\..\data"
    File "..\..\package.json"
    File "..\..\package-lock.json"
    File "..\..\README.md"
    File "..\..\LICENSE"
    File "..\..\green-fire-core-cache.zip"
    File "..\..\green-fire-library.zip"
    File /oname=Awaken-Ember-Node.bat "Awaken-Ember-Node-Installed.bat"

    ; Desktop + Start Menu launcher
    CreateDirectory "$SMPROGRAMS\${APP_NAME}"
    CreateShortCut "$DESKTOP\Awaken Ember Node.lnk" "$INSTDIR\Awaken-Ember-Node.bat" "" "$INSTDIR\installer\assets\ember-node-icon.ico" 0 SW_SHOWNORMAL "" "ᚠ Awaken Ember Node"
    CreateShortCut "$SMPROGRAMS\${APP_NAME}\Awaken Ember Node.lnk" "$INSTDIR\Awaken-Ember-Node.bat" "" "$INSTDIR\installer\assets\ember-node-icon.ico" 0 SW_SHOWNORMAL "" "ᚠ Awaken Ember Node"

    ; Uninstaller and registry metadata
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    WriteRegStr HKCU "${REG_PATH}" "InstallDir" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayName" "${APP_NAME}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayVersion" "${APP_VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "Publisher" "${COMPANY_NAME}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "NoModify" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "NoRepair" 1
SectionEnd

Section "Uninstall"
    SetShellVarContext current

    ; Remove launchers
    Delete "$DESKTOP\Awaken Ember Node.lnk"
    Delete "$SMPROGRAMS\${APP_NAME}\Awaken Ember Node.lnk"
    RMDir "$SMPROGRAMS\${APP_NAME}"

    ; Remove app files only. User data root is external and intentionally preserved.
    RMDir /r "$INSTDIR"

    DeleteRegKey HKCU "${REG_PATH}"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
SectionEnd
