' RDR Local - inicia o icone da bandeja (e o painel) sem abrir janela.
' Uso: launcher.vbs [silent]   (silent = nao abre o navegador; usado no inicio com o Windows)
Dim sh, fso, dir, extra
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
extra = ""
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "silent" Then extra = " -NoOpen"
End If
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\tray.ps1""" & extra, 0, False
