#!/bin/zsh
# 웹판(golf-lounge)의 화면 코드 변경을 휴대폰판에 옮긴다.
# 마지막으로 옮긴 웹판 커밋(tools/web-synced.txt) 이후의 js·css 변경을 3-way로 적용한다.
# github.js(웹판 저장 방식)는 휴대폰판에 없으므로 빼고, 충돌이 나면 휴대폰판 문구(「저장」·백업 안내)를 살려 손으로 정리한다.
# 정리 후: js/version.js의 APP_BUILD를 "hp-날짜-n"으로 올리고, tools/web-synced.txt를 갱신해 커밋·push.
set -e
cd "${0:A:h}/.."
WEB=../golf-lounge
git remote get-url web >/dev/null 2>&1 || git remote add web "$WEB"
git fetch -q web
FROM=$(cat tools/web-synced.txt)
TO=$(git -C "$WEB" rev-parse --short HEAD)
if [[ -z $(git -C "$WEB" diff "$FROM" "$TO" -- js css index.html sw.js ':!js/github.js') ]]; then echo "옮길 변경 없음 ($FROM)"; exit 0; fi
git -C "$WEB" log --oneline "$FROM..$TO" -- js css index.html sw.js
git -C "$WEB" diff "$FROM" "$TO" -- js css index.html sw.js ':!js/github.js' | git apply -3 || true
echo "$TO" > tools/web-synced.txt
echo "적용 완료 — 충돌 파일: $(git diff --name-only --diff-filter=U | tr '\n' ' ')"
