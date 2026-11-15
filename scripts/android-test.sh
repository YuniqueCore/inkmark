#!/usr/bin/env bash
# The emulator action runs each script line in a separate shell. Keep test status
# and evidence collection in one process, including when instrumentation fails.
set -uo pipefail
inkmark_test_status=0
native/android/gradlew -p native/android connectedDebugAndroidTest || inkmark_test_status=$?
if adb shell test -d /sdcard/Android/data/io.github.yuniquecore.inkmark/files/test-evidence; then
  adb pull /sdcard/Android/data/io.github.yuniquecore.inkmark/files/test-evidence .local-build/android-evidence
fi
exit "$inkmark_test_status"
