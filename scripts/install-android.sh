#!/usr/bin/env bash
# Build Bookstr Android (Debug) and install+launch on a connected device.
#
# Usage:
#   scripts/install-android.sh                 # sole connected device
#   scripts/install-android.sh <serial>        # specific adb serial
#   ANDROID_SERIAL=... scripts/install-android.sh
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
android="$repo/android"
package=${PACKAGE_ID:-app.bookstr}
activity=${LAUNCH_ACTIVITY:-app.bookstr.MainActivity}
serial=${1:-${ANDROID_SERIAL:-${DEVICE_SERIAL:-}}}

GRADLE_JAVA_HOME="${BOOKSTR_JAVA_HOME:-${JAVA_HOME:-}}"
if [[ -z "${GRADLE_JAVA_HOME}" && -x "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java" ]]; then
  GRADLE_JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi
if [[ -z "${GRADLE_JAVA_HOME}" || ! -x "${GRADLE_JAVA_HOME}/bin/java" ]]; then
  echo "No usable JDK found. Set BOOKSTR_JAVA_HOME or JAVA_HOME (JDK 17–23)." >&2
  exit 1
fi

ADB_BIN="$(command -v adb || true)"
ANDROID_SDK_DIR="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -f "$android/local.properties" ]]; then
  PROJECT_SDK="$(sed -n 's/^sdk\.dir=//p' "$android/local.properties" | head -n 1)"
  [[ -n "${PROJECT_SDK}" ]] && ANDROID_SDK_DIR="${PROJECT_SDK}"
fi
if [[ -z "${ANDROID_SDK_DIR}" && -d "${HOME}/Library/Android/sdk" ]]; then
  ANDROID_SDK_DIR="${HOME}/Library/Android/sdk"
fi
if [[ -z "${ADB_BIN}" && -n "${ANDROID_SDK_DIR}" && -x "${ANDROID_SDK_DIR}/platform-tools/adb" ]]; then
  ADB_BIN="${ANDROID_SDK_DIR}/platform-tools/adb"
fi
if [[ -z "${ADB_BIN}" ]]; then
  echo "adb not found. Install Android platform-tools or set ANDROID_HOME." >&2
  exit 1
fi

devices="$("${ADB_BIN}" devices | awk 'NR>1 && $2=="device" { print $1 }')"
if [[ -z "${devices}" ]]; then
  echo "No Android devices connected (adb devices)." >&2
  exit 1
fi
device_count="$(printf '%s\n' "${devices}" | sed '/^$/d' | wc -l | tr -d ' ')"

if [[ -z "${serial}" ]]; then
  if [[ "${device_count}" != "1" ]]; then
    echo "Multiple devices connected; pass a serial:" >&2
    "${ADB_BIN}" devices -l >&2
    exit 1
  fi
  serial="$(printf '%s\n' "${devices}" | head -n 1)"
elif ! printf '%s\n' "${devices}" | grep -qx "${serial}"; then
  echo "Device '${serial}' not connected." >&2
  "${ADB_BIN}" devices -l >&2
  exit 1
fi

if [[ -z "${BOOST_ROOT:-}" ]]; then
  if [[ -d /opt/homebrew/opt/boost/include ]]; then
    BOOST_ROOT=/opt/homebrew/opt/boost
  elif [[ -d /usr/local/opt/boost/include ]]; then
    BOOST_ROOT=/usr/local/opt/boost
  fi
fi
if [[ -n "${BOOST_ROOT:-}" ]]; then
  export BOOST_ROOT
  echo "==> Using BOOST_ROOT=${BOOST_ROOT}"
fi

# Prefer the real SDK path when ANDROID_HOME points at ~/Library/Android.
if [[ -d "${HOME}/Library/Android/sdk" ]]; then
  case "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" in
    */Library/Android|*/Library/Android/)
      export ANDROID_HOME="${HOME}/Library/Android/sdk"
      export ANDROID_SDK_ROOT="${HOME}/Library/Android/sdk"
      ;;
  esac
fi
if [[ -n "${ANDROID_SDK_DIR}" && -d "${ANDROID_SDK_DIR}/ndk" ]]; then
  export ANDROID_HOME="${ANDROID_SDK_DIR}"
  export ANDROID_SDK_ROOT="${ANDROID_SDK_DIR}"
fi

# Physical phones are arm64; override with BOOKSTR_ANDROID_ABIS for emulators.
export BOOKSTR_ANDROID_ABIS="${BOOKSTR_ANDROID_ABIS:-arm64-v8a}"

echo "==> Building assembleDebug (abis=${BOOKSTR_ANDROID_ABIS})"
(
  cd "$android"
  JAVA_HOME="${GRADLE_JAVA_HOME}" PATH="${GRADLE_JAVA_HOME}/bin:${PATH}" \
    ./gradlew "-Dorg.gradle.java.home=${GRADLE_JAVA_HOME}" assembleDebug
)

apk="$(find "$android/app/build/outputs/apk/debug" -name '*.apk' -type f | head -n 1 || true)"
if [[ -z "${apk}" ]]; then
  echo "No debug APK found under app/build/outputs/apk/debug" >&2
  exit 1
fi

echo "==> Installing on ${serial}"
"${ADB_BIN}" -s "${serial}" install -r "${apk}"

echo "==> Launching ${package}/${activity}"
"${ADB_BIN}" -s "${serial}" shell am start -n "${package}/${activity}"

echo "Done."
