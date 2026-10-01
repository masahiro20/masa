@echo off
chcp 65001 > nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\tochi-chosa.lnk" 2> nul
rem ポート3000で動いている土地調査アシスタントだけを止める
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /pid %%p /f > nul 2>&1
echo 常時起動をやめました（次回から自動では起動しません）。
pause
