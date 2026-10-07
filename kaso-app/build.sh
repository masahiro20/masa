#!/bin/sh
# src/app.html（本体）を、そのまま公開できる index.html に包む
cd "$(dirname "$0")"
{
  printf '<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="description" content="間取り図に家相盤を重ねて、鬼門・張り欠け・火と水回りの位置を判定するツール。図面はブラウザの中だけで処理されます。">\n</head>\n<body>\n'
  cat src/app.html
  printf '\n</body>\n</html>\n'
} > index.html
