#!/usr/bin/env bash
# Run inside Xvfb + dbus-run-session, with a real window manager and XTest keyboard events.
set -euo pipefail

openbox --sm-disable > .local-build/openbox.log 2>&1 &
inkmark_wm_pid=$!
trap 'kill "$inkmark_wm_pid" 2>/dev/null || true' EXIT
for inkmark_attempt in {1..50}; do
  if wmctrl -m > /dev/null 2>&1; then break; fi
  sleep .1
done
wmctrl -m
python3 -c 'import ctypes; ctypes.CDLL("libXtst.so.6"); print("XTest library available")'
xdpyinfo -queryExtensions | grep -F XTEST
bun run nsh test native/tests --target linux --verbose --trace --junit .local-build/native-test.xml
