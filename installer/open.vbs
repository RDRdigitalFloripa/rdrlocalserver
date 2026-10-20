' Atalho do RDR Local: pede ao Agendador de Tarefas para abrir o RDR Local com privilegios de administrador (sem janela de UAC).
CreateObject("WScript.Shell").Run "schtasks.exe /Run /TN ""RDR Local Start""", 0, False
