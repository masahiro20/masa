@echo off
chcp 65001 > nul
cd /d %~dp0
title 土地調査アシスタント（常に起動する設定）

where node > nul 2> nul
if errorlevel 1 (
  echo Node.js が見つかりません。https://nodejs.org/ja から LTS 版をインストールしてから、もう一度実行してください。
  pause
  exit /b
)
if not exist node_modules call npm install --omit=dev
if not exist .env (
  copy .env.example .env > nul
  echo .env を作成しました。APIキーを記入して保存し、メモ帳を閉じてください。
  notepad .env
)

rem Windows 起動時に裏で立ち上がるよう、スタートアップにショートカットを作る
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\tochi-chosa.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0scripts\start-hidden.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.Save()"

rem 今すぐ起動
wscript "%~dp0scripts\start-hidden.vbs"
timeout /t 3 > nul
start http://localhost:3000

echo.
echo 設定しました。これからは PC を起動するだけで、裏で土地調査アシスタントが動きます。
echo ブラウザで http://localhost:3000 をブックマークしておいてください。
echo やめたいときは「常時起動をやめる.bat」を実行してください。
pause
