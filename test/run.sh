#!/bin/bash
# Runs the whole check: unit tests, then the stock drift check (has Omarchy
# changed the power panel files Widget.qml and PowerModel.js were copied from?).
# Exits non-zero if anything fails. The drift check is kept out of `node --test`
# so the unit suite stays green on machines without Omarchy.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

status=0
node --test test/ || status=1

drift=$(bash bin/battery-insights stock-check)
case $? in
  0) echo "stock-check: Omarchy's power panel matches the copy" ;;
  4) echo "stock-check skipped: Omarchy not installed" ;;
  3)
    echo
    echo "STOCK DRIFT: $(sed -n 's/^changed=//p' <<<"$drift") -- re-sync Widget.qml/PowerModel.js"
    echo
    status=1
    ;;
  *)
    echo "stock-check failed to run"
    status=1
    ;;
esac

exit "$status"
