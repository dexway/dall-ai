#!/bin/sh
# Saves your Higgsfield key to .env.local (git-ignored) without showing it on screen or in shell history.
# Run from the project root: sh scripts/higgsfield/set-key.sh
set -e
cd "$(dirname "$0")/../.."
printf 'Paste your Higgsfield key as KEY_ID:KEY_SECRET (nothing will show), then press Enter: '
stty -echo
IFS= read -r HFK
stty echo
printf '\n'
case "$HFK" in
  *:*) ;;
  *) echo "That doesn't look like KEY_ID:KEY_SECRET. Nothing saved."; exit 1 ;;
esac
touch .env.local && chmod 600 .env.local
grep -v '^HF_CREDENTIALS=' .env.local > .env.local.tmp 2>/dev/null || true
printf 'HF_CREDENTIALS=%s\n' "$HFK" >> .env.local.tmp
mv .env.local.tmp .env.local && chmod 600 .env.local
unset HFK
echo "Saved to .env.local. Tell Claude it's done."
