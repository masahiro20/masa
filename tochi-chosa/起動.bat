@echo off
chcp 65001 > nul
cd /d %~dp0
title 土地調査アシスタント

where node > nul 2> nul
if errorlevel 1 (
  echo Node.js が見つかりません。https://nodejs.org/ja から LTS 版をインストールしてから、もう一度ダブルクリックしてください。
  pause
  exit /b
)

if not exist node_modules (
  echo 初回セットアップ中です（1分ほどかかります）...
  call npm install --omit=dev
)

if not exist .env (
  copy .env.example .env > nul
  echo .env を作成しました。メモ帳で APIキーを記入して保存し、閉じてください。
  notepad .env
)

if not exist "templates\法令制限確認書.xlsx" (
  echo ※ templates フォルダに「法令制限確認書.xlsx」がありません。Excel 出力を使う場合は置いてください。
)

echo.
echo 土地調査アシスタントを起動します。ブラウザが開かない場合は http://localhost:3000 を開いてください。
echo 終了するときはこの画面を閉じてください。
start "" cmd /c "timeout /t 2 > nul & start http://localhost:3000"
node --env-file=.env server.js
pause
