#!/bin/bash
# macOS: doppelklicken.  Linux: ./Webserver\ starten.command
cd "$(dirname "$0")" || exit 1

for kandidat in ./node ./node/bin/node node; do
  if command -v "$kandidat" >/dev/null 2>&1; then
    "$kandidat" server.js "$@"
    exit $?
  fi
done

echo
echo "  Node.js wurde nicht gefunden."
echo "  Installieren mit:  brew install node"
echo "  oder herunterladen: https://nodejs.org"
echo
read -r -p "  Mit Enter schliessen..." _
exit 1
