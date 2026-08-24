#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="${ROOT_DIR}/android"
VARIANT="release"
OUTPUT_DIR="${ANDROID_DIR}/releases"
APK_PREFIX="bookstr-"
SKIP_BUILD=0

usage() {
  cat <<'USAGE'
Usage: release-android-apk.sh [options]

Build and package Bookstr Android APKs with Obtanium-friendly naming:
  bookstr-<versionName>.apk

Java selection, in order: BOOKSTR_JAVA_HOME, JAVA_HOME, Android Studio's
bundled Java on macOS.

Options:
  -v, --variant <debug|release>   Gradle variant to build (default: release)
  -o, --out-dir <path>            Output directory (default: bookstr/android/releases)
  --apk-prefix <prefix>            Output filename prefix (default: bookstr-)
  --skip-build                     Skip ./gradlew assemble* step
  -h, --help                      Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -v|--variant)
      VARIANT="$2"
      shift 2
      ;;
    -o|--out-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --apk-prefix)
      APK_PREFIX="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "${VARIANT}" != "debug" && "${VARIANT}" != "release" ]]; then
  echo "Invalid variant: ${VARIANT} (expected debug or release)" >&2
  exit 1
fi

if [[ "${VARIANT}" == "release" ]]; then
  missing_signing_variables=()
  for variable in BOOKSTR_KEYSTORE_FILE BOOKSTR_KEYSTORE_PASSWORD BOOKSTR_KEY_PASSWORD; do
    if [[ -z "${!variable:-}" ]]; then
      missing_signing_variables+=("${variable}")
    fi
  done

  if [[ ${#missing_signing_variables[@]} -gt 0 ]]; then
    echo "Release signing requires: ${missing_signing_variables[*]}" >&2
    exit 1
  fi

  if [[ ! -f "${BOOKSTR_KEYSTORE_FILE}" ]]; then
    echo "Release keystore not found: ${BOOKSTR_KEYSTORE_FILE}" >&2
    exit 1
  fi
fi

if [[ "${VARIANT}" == "release" ]]; then
  TASK="assembleRelease"
else
TASK="assembleDebug"
fi
APK_OUT_DIR="${ANDROID_DIR}/app/build/outputs/apk/${VARIANT}"

GRADLE_JAVA_HOME="${BOOKSTR_JAVA_HOME:-${JAVA_HOME:-}}"
if [[ -z "${GRADLE_JAVA_HOME}" && -x "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java" ]]; then
  GRADLE_JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi

if [[ -z "${GRADLE_JAVA_HOME}" || ! -x "${GRADLE_JAVA_HOME}/bin/java" ]]; then
  echo "No usable JDK found. Set BOOKSTR_JAVA_HOME or JAVA_HOME to a JDK 17-23 installation." >&2
  exit 1
fi

ANDROID_SDK_DIR="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -f "${ANDROID_DIR}/local.properties" ]]; then
  PROJECT_ANDROID_SDK_DIR="$(sed -n 's/^sdk\.dir=//p' "${ANDROID_DIR}/local.properties" | head -n 1)"
  if [[ -n "${PROJECT_ANDROID_SDK_DIR}" ]]; then
    ANDROID_SDK_DIR="${PROJECT_ANDROID_SDK_DIR}"
  fi
fi
if [[ -z "${ANDROID_SDK_DIR}" && -d "${HOME}/Library/Android/sdk" ]]; then
  ANDROID_SDK_DIR="${HOME}/Library/Android/sdk"
fi

AAPT_BIN="$(command -v aapt || true)"
APKSIGNER_BIN="$(command -v apksigner || true)"
if [[ -n "${ANDROID_SDK_DIR}" && -d "${ANDROID_SDK_DIR}/build-tools" ]]; then
  for candidate in "${ANDROID_SDK_DIR}"/build-tools/*; do
    if [[ -x "${candidate}/aapt" ]]; then
      AAPT_BIN="${candidate}/aapt"
    fi
    if [[ -x "${candidate}/apksigner" ]]; then
      APKSIGNER_BIN="${candidate}/apksigner"
    fi
  done
fi

if [[ "${VARIANT}" == "release" ]]; then
  KEYTOOL="${GRADLE_JAVA_HOME}/bin/keytool"
  RELEASE_KEY_ALIASES="$(LC_ALL=C "${KEYTOOL}" -list -v -keystore "${BOOKSTR_KEYSTORE_FILE}" -storepass:env BOOKSTR_KEYSTORE_PASSWORD 2>/dev/null | awk -F ': ' '/^Alias name: / { print $2 }')"
  RELEASE_KEY_ALIAS_COUNT="$(printf '%s\n' "${RELEASE_KEY_ALIASES}" | sed '/^$/d' | wc -l | tr -d ' ')"

  if [[ "${RELEASE_KEY_ALIAS_COUNT}" == "1" ]]; then
    BOOKSTR_KEY_ALIAS="${RELEASE_KEY_ALIASES}"
    export BOOKSTR_KEY_ALIAS
    echo "Using signing key alias: ${BOOKSTR_KEY_ALIAS}"
  elif [[ "${RELEASE_KEY_ALIAS_COUNT}" == "0" ]]; then
    echo "Could not find a signing key in ${BOOKSTR_KEYSTORE_FILE}. Check BOOKSTR_KEYSTORE_PASSWORD." >&2
    exit 1
  elif [[ -z "${BOOKSTR_KEY_ALIAS:-}" ]]; then
    echo "Keystore contains multiple signing keys. Set BOOKSTR_KEY_ALIAS to the key you want to use." >&2
    exit 1
  fi
fi

if [[ ${SKIP_BUILD} -eq 0 ]]; then
  echo "[1/4] Building ${TASK}"
  (cd "${ANDROID_DIR}" && JAVA_HOME="${GRADLE_JAVA_HOME}" PATH="${GRADLE_JAVA_HOME}/bin:${PATH}" ./gradlew "-Dorg.gradle.java.home=${GRADLE_JAVA_HOME}" "${TASK}")
fi

APK_PATH="$(find "${APK_OUT_DIR}" -name '*.apk' -type f | head -n 1 || true)"
if [[ -z "${APK_PATH}" ]]; then
  echo "No APK found in ${APK_OUT_DIR}. Build may have failed or variant output moved." >&2
  exit 1
fi

VERSION_NAME=""
if [[ -n "${AAPT_BIN}" ]]; then
  VERSION_NAME="$("${AAPT_BIN}" dump badging "${APK_PATH}" | awk -F"'" '/versionName=/ {print $2; exit}')"
fi

if [[ -z "${VERSION_NAME}" ]]; then
  MERGED_MANIFEST="$(find "${ANDROID_DIR}/app/build/intermediates/merged_manifests" -path "*${VARIANT}*" -name AndroidManifest.xml -type f | head -n 1 || true)"
  if [[ -n "${MERGED_MANIFEST}" ]]; then
    VERSION_NAME="$(grep -o 'android:versionName="[^"]\+"' "${MERGED_MANIFEST}" | cut -d '"' -f 2 | head -n 1)"
  fi
fi

if [[ -z "${VERSION_NAME}" ]]; then
  echo "Could not resolve versionName from APK/manifests; using fallback timestamp." >&2
  VERSION_NAME="0.0.3-$(date '+%Y%m%d-%H%M')"
fi

mkdir -p "${OUTPUT_DIR}"
VERSION_NAME_SAFE="$(printf '%s' "${VERSION_NAME}" | tr -cd 'A-Za-z0-9._-')"
OUTPUT_NAME="${APK_PREFIX}${VERSION_NAME_SAFE}.apk"
OUTPUT_PATH="${OUTPUT_DIR}/${OUTPUT_NAME}"

cp "${APK_PATH}" "${OUTPUT_PATH}"

echo "[2/4] Produced ${OUTPUT_PATH}"
echo "[3/4] Source APK: ${APK_PATH}"
if [[ "${VARIANT}" == "release" ]]; then
  if [[ -z "${APKSIGNER_BIN}" ]]; then
    echo "Cannot verify release signature: apksigner was not found in PATH or Android SDK Build Tools." >&2
    exit 1
  fi
  echo "[verify] Using ${APKSIGNER_BIN}"
  "${APKSIGNER_BIN}" verify --verbose --print-certs "${OUTPUT_PATH}"
fi

if command -v shasum >/dev/null 2>&1; then
  echo "[4/4] SHA-256: $(shasum -a 256 "${OUTPUT_PATH}" | awk '{print $1}')"
else
  echo "[4/4] SHA-256: unavailable (shasum not installed)"
fi
