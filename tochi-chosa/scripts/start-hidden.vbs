' Starts the land survey tool in the background (no window). Used by the Windows startup shortcut.
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = appDir
sh.Run "cmd /c node --env-file=.env server.js > server.log 2>&1", 0, False
