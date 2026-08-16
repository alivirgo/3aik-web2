#!/usr/bin/env sh
set -eu

if [ -z "${ANDROID_HOME:-}" ]; then
  echo "ANDROID_HOME must point to an SDK containing platforms;android-36 and build-tools;36.0.0." >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$SCRIPT_DIR/gradlew" --no-daemon --stacktrace \
  :app:testDebugUnitTest \
  :app:lintRelease \
  :app:assembleDebug \
  :app:bundleRelease
