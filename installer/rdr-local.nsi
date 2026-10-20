; Instalador do RDR Local Server (NSIS 3, Unicode). Gerado a partir de installer/build.sh
; Uso: makensis -DSTAGE=<pasta> -DVERSION=1.0.0 rdr-local.nsi
Unicode true
!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!ifndef STAGE
  !error "Defina -DSTAGE=<pasta com app\, runtime\ e launcher\>"
!endif

!define APP "RDR Local Server"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\RDRLocal"

Name "${APP}"
OutFile "RDR-Local-Setup-${VERSION}.exe"
InstallDir "$PROGRAMFILES64\RDR Local"
InstallDirRegKey HKLM "Software\RDRLocal" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
BrandingText "RDR Digital"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1046 "ProductName" "${APP}"
VIAddVersionKey /LANG=1046 "CompanyName" "RDR Digital"
VIAddVersionKey /LANG=1046 "FileDescription" "Instalador do ${APP}"
VIAddVersionKey /LANG=1046 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1046 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1046 "LegalCopyright" "RDR Digital"

!define MUI_ICON "rdr-local.ico"
!define MUI_UNICON "rdr-local.ico"
!define MUI_ABORTWARNING
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "header.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "side.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "side.bmp"
!define MUI_WELCOMEPAGE_TEXT "Este assistente instala o ${APP} v${VERSION}: servidor local com HTTPS, PHP, bancos de dados e e-mail de testes.$\r$\n$\r$\nO programa roda em segundo plano, com um ícone perto do relógio. Fechar o navegador não derruba nada.$\r$\n$\r$\nClique em Avançar para continuar."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o RDR Local agora"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "PortugueseBR"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "O RDR Local exige Windows de 64 bits."
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Function LaunchApp
  nsExec::Exec '"$SYSDIR\schtasks.exe" /Run /TN "RDR Local Start"'
FunctionEnd

Section "RDR Local Server (obrigatório)" SecMain
  SectionIn RO
  SetRegView 64
  SetShellVarContext all

  ; Atualização: encerra a versão em execução antes de trocar os arquivos.
  IfFileExists "$INSTDIR\launcher\stop.ps1" 0 +2
    nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\launcher\stop.ps1"'

  RMDir /r "$INSTDIR\app"
  SetOutPath "$INSTDIR\app"
  File /r "${STAGE}\app\*.*"
  SetOutPath "$INSTDIR\runtime"
  File "${STAGE}\runtime\node.exe"
  SetOutPath "$INSTDIR\launcher"
  File "${STAGE}\launcher\*.*"

  ; Pasta de dados fica fora do Program Files (sobrevive a atualizações): bancos, componentes, config, logs.
  CreateDirectory "$APPDATA\RDRLocal"
  nsExec::Exec '"$SYSDIR\icacls.exe" "$APPDATA\RDRLocal" /grant *S-1-5-32-545:(OI)(CI)M /T /C /Q'

  ; Tarefa sob demanda "RDR Local Start": abre elevado sem UAC a cada uso.
  nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\launcher\tasks.ps1" -Mode install'

  ; Menu Iniciar
  CreateDirectory "$SMPROGRAMS\RDR Local"
  CreateShortCut "$SMPROGRAMS\RDR Local\RDR Local Server.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\launcher\open.vbs"' "$INSTDIR\launcher\rdr-local.ico" 0
  CreateShortCut "$SMPROGRAMS\RDR Local\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"

  ; Painel de Controle > Programas
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKLM "Software\RDRLocal" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${UNKEY}" "DisplayName" "${APP}"
  WriteRegStr HKLM "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNKEY}" "Publisher" "RDR Digital"
  WriteRegStr HKLM "${UNKEY}" "DisplayIcon" "$INSTDIR\launcher\rdr-local.ico"
  WriteRegStr HKLM "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNKEY}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegDWORD HKLM "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNKEY}" "NoRepair" 1
  WriteRegDWORD HKLM "${UNKEY}" "EstimatedSize" 140000
SectionEnd

Section "Atalho na área de trabalho" SecDesk
  SetShellVarContext all
  CreateShortCut "$DESKTOP\RDR Local Server.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\launcher\open.vbs"' "$INSTDIR\launcher\rdr-local.ico" 0
SectionEnd

Section "Iniciar com o Windows (recomendado)" SecAuto
  nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\launcher\tasks.ps1" -Mode autostart-on'
SectionEnd

LangString DESC_Main ${LANG_PORTUGUESEBR} "Programa, Node.js embutido, ícone da bandeja e atalhos do Menu Iniciar."
LangString DESC_Desk ${LANG_PORTUGUESEBR} "Cria um atalho do RDR Local na área de trabalho."
LangString DESC_Auto ${LANG_PORTUGUESEBR} "Abre o RDR Local em segundo plano ao entrar no Windows (sem abrir o navegador)."
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} $(DESC_Main)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesk} $(DESC_Desk)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecAuto} $(DESC_Auto)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  SetRegView 64
  SetShellVarContext all
  nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\launcher\stop.ps1"'
  nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\launcher\tasks.ps1" -Mode remove'

  ; Remove o bloco que o RDR Local gravou no arquivo hosts.
  nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\launcher\tasks.ps1" -Mode clean-hosts'

  Delete "$DESKTOP\RDR Local Server.lnk"
  RMDir /r "$SMPROGRAMS\RDR Local"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${UNKEY}"
  DeleteRegKey HKLM "Software\RDRLocal"

  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Remover também os dados do RDR Local (bancos de dados, backups, sites, certificado e componentes baixados)?$\r$\n$\r$\nEscolha Não para manter tudo e reinstalar depois sem perder nada." IDNO keepdata
    RMDir /r "$APPDATA\RDRLocal"
  keepdata:
SectionEnd
