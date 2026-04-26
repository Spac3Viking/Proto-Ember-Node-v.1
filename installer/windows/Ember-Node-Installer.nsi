Unicode true
RequestExecutionLevel admin

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!define APP_NAME "Ember Node"
!define APP_VERSION "1.0.0"
!define COMPANY_NAME "Ember Node"
!define REG_PATH "Software\${APP_NAME}"

Name "${APP_NAME}"
OutFile "Ember-Node-Setup.exe"
BrandingText "ᚠ Ember Node Installer"

InstallDir "$PROGRAMFILES\${APP_NAME}"
InstallDirRegKey HKLM "${REG_PATH}" "InstallDir"

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
    ${If} ${RunningX64}
        StrCpy $INSTDIR "$PROGRAMFILES64\${APP_NAME}"
    ${Else}
        StrCpy $INSTDIR "$PROGRAMFILES\${APP_NAME}"
    ${EndIf}
FunctionEnd

Section "Install Ember Node" SEC_MAIN
    SetShellVarContext all
    SetOutPath "$INSTDIR"

    ; Core runtime files
    File /r "..\..\app"
    File /r "..\..\public"
    File /r "..\..\cartridges"
    File /r "..\..\data"
    File "..\..\package.json"
    File "..\..\package-lock.json"
    File "..\..\README.md"
    File "..\..\LICENSE"
    File /oname=Awaken-Ember-Node.bat "Awaken-Ember-Node-Installed.bat"

    ; Keep tests and git metadata out of install footprint
    Delete "$INSTDIR\data\**\.gitkeep"

    ; Desktop + Start Menu launcher
    CreateDirectory "$SMPROGRAMS\${APP_NAME}"
    CreateShortCut "$DESKTOP\Awaken Ember Node.lnk" "$INSTDIR\Awaken-Ember-Node.bat" "" "$INSTDIR\Awaken-Ember-Node.bat" 0 SW_SHOWNORMAL "" "ᚠ Awaken Ember Node"
    CreateShortCut "$SMPROGRAMS\${APP_NAME}\Awaken Ember Node.lnk" "$INSTDIR\Awaken-Ember-Node.bat" "" "$INSTDIR\Awaken-Ember-Node.bat" 0 SW_SHOWNORMAL "" "ᚠ Awaken Ember Node"

    ; Uninstaller and registry metadata
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    WriteRegStr HKLM "${REG_PATH}" "InstallDir" "$INSTDIR"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayName" "${APP_NAME}"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayVersion" "${APP_VERSION}"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "Publisher" "${COMPANY_NAME}"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "NoModify" 1
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "NoRepair" 1
SectionEnd

Section "Uninstall"
    SetShellVarContext all

    ; Remove launchers
    Delete "$DESKTOP\Awaken Ember Node.lnk"
    Delete "$SMPROGRAMS\${APP_NAME}\Awaken Ember Node.lnk"
    RMDir "$SMPROGRAMS\${APP_NAME}"

    ; Remove app files only. User data root is external and intentionally preserved.
    RMDir /r "$INSTDIR"

    DeleteRegKey HKLM "${REG_PATH}"
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
SectionEnd

