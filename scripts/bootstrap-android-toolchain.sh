#!/usr/bin/env bash
# Guest-local Android/web toolchain bootstrap for bookstr / ebook-dev.
# Idempotent. Does not touch Incus host objects. Run as root or with sudo.
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
CMDLINE_VERSION="${CMDLINE_VERSION:-11076708}"
JDK_PACKAGE="${JDK_PACKAGE:-openjdk-17-jdk-headless}"
MARKER=/var/lib/bookstr-android-toolchain-complete

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y --no-install-recommends \
  "${JDK_PACKAGE}" unzip wget curl ca-certificates \
  libstdc++6 zlib1g

install -d -m 0755 "${ANDROID_HOME}/cmdline-tools"
if [[ ! -x "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" ]]; then
  tmp=$(mktemp -d)
  wget -q -O "${tmp}/cmdtools.zip" \
    "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_VERSION}_latest.zip"
  unzip -q "${tmp}/cmdtools.zip" -d "${tmp}"
  rm -rf "${ANDROID_HOME}/cmdline-tools/latest"
  mkdir -p "${ANDROID_HOME}/cmdline-tools/latest"
  # Zip contains a top-level cmdline-tools/ directory
  mv "${tmp}/cmdline-tools/"* "${ANDROID_HOME}/cmdline-tools/latest/"
  rm -rf "${tmp}"
fi

export ANDROID_HOME
export ANDROID_SDK_ROOT="${ANDROID_HOME}"
export PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"

yes | sdkmanager --licenses >/tmp/android-licenses.log || true
sdkmanager --install \
  "platform-tools" \
  "platforms;android-35" \
  "build-tools;35.0.0"

# Env for login shells of user 'dev'
cat >/etc/profile.d/bookstr-android.sh <<EOF
export ANDROID_HOME=${ANDROID_HOME}
export ANDROID_SDK_ROOT=${ANDROID_HOME}
export JAVA_HOME=\$(dirname \$(dirname \$(readlink -f \$(which javac))))
export PATH="\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$PATH"
EOF
chmod 644 /etc/profile.d/bookstr-android.sh

# Per-user local.properties helper for the app checkout
if id dev >/dev/null 2>&1; then
  install -d -o dev -g dev /home/dev/src
  if [[ -d /home/dev/src/readstr/android ]]; then
    printf 'sdk.dir=%s\n' "${ANDROID_HOME}" >/home/dev/src/readstr/android/local.properties
    chown dev:dev /home/dev/src/readstr/android/local.properties
  fi
fi

{
  echo "bookstr-android-toolchain"
  echo "date=$(date -Is)"
  java -version 2>&1 | head -1
  echo "ANDROID_HOME=${ANDROID_HOME}"
  sdkmanager --list_installed 2>/dev/null | sed -n '1,40p' || true
} >"${MARKER}"
chmod 644 "${MARKER}"
echo "Wrote ${MARKER}"
