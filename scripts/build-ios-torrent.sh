#!/bin/bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
work="$repo/.torrent-build"
source_dir="$work/libtorrent"
cmake_bin=${CMAKE_BIN:-cmake}
boost_root=${BOOST_ROOT:-/opt/homebrew/opt/boost}
revision=9d7443f467147d1784fb7516d2a882db1abb5a8b
mkdir -p "$work"
if [ ! -d "$source_dir/.git" ]; then
  git clone --depth 1 --branch v2.0.11 https://github.com/arvidn/libtorrent.git "$source_dir"
fi
[ "$(git -C "$source_dir" rev-parse HEAD)" = "$revision" ] || { echo 'Unexpected libtorrent revision'; exit 1; }
git -C "$source_dir" submodule update --init --depth 1 deps/try_signal
for sdk in ${TORRENT_SDKS:-iphoneos iphonesimulator}; do
  build="$work/$sdk"
  sysroot=$(xcrun --sdk "$sdk" --show-sdk-path)
  archs=arm64
  [ "$sdk" != iphonesimulator ] || archs='arm64;x86_64' 
  "$cmake_bin" -S "$source_dir" -B "$build" -G Xcode \
    -DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT="$sysroot" -DCMAKE_OSX_ARCHITECTURES="$archs" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=18.0 -DCMAKE_XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED=NO \
    -DCMAKE_POLICY_DEFAULT_CMP0167=OLD -DBOOST_ROOT="$boost_root" -DBoost_INCLUDE_DIR="$boost_root/include" -DBoost_NO_BOOST_CMAKE=ON \
    -DCMAKE_DISABLE_FIND_PACKAGE_OpenSSL=TRUE -DCMAKE_DISABLE_FIND_PACKAGE_GnuTLS=TRUE \
    -DCMAKE_DISABLE_FIND_PACKAGE_LibGcrypt=TRUE -DBUILD_SHARED_LIBS=OFF \
    -Ddeprecated-functions=OFF -Dlogging=OFF -Di2p=OFF -Dmutable-torrents=OFF \
    -DCMAKE_CXX_FLAGS='-DTORRENT_HAVE_MMAP=0' -DCMAKE_CXX_STANDARD=17
  "$cmake_bin" --build "$build" --config Release --parallel 6
  objects=()
  for arch in ${archs//;/ }; do
    target="$arch-apple-ios18.0"
    [ "$sdk" != iphonesimulator ] || target="$target-simulator"
    xcrun --sdk "$sdk" clang++ -target "$target" -isysroot "$sysroot" -std=c++17 -fobjc-arc -O2 \
      -DTORRENT_HAVE_MMAP=0 -DTORRENT_NO_DEPRECATE -DTORRENT_DISABLE_LOGGING -DTORRENT_USE_I2P=0 -DTORRENT_DISABLE_MUTABLE_TORRENTS \
      -I"$source_dir/include" -I"$boost_root/include" -I"$repo/ios/TorrentEngine/include" \
      -c "$repo/ios/TorrentEngine/BTSession.mm" -o "$build/BTSession-$arch.o"
    objects+=("$build/BTSession-$arch.o")
  done
  xcrun lipo -create "${objects[@]}" -output "$build/BTSession.o"
  xcrun libtool -static -o "$build/libTorrentEngine.a" "$build/Release-$sdk/libtorrent-rasterbar.a" "$build/BTSession.o"
  framework="$build/TorrentEngine.framework"
  mkdir -p "$framework/Headers" "$framework/Modules"
  cp "$build/libTorrentEngine.a" "$framework/TorrentEngine"
  cp "$repo/ios/TorrentEngine/include/BTSession.h" "$framework/Headers/"
  sed 's/^module TorrentEngine/framework module TorrentEngine/' "$repo/ios/TorrentEngine/include/module.modulemap" > "$framework/Modules/module.modulemap"
  cat > "$framework/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>app.bookstr.TorrentEngine</string><key>CFBundleName</key><string>TorrentEngine</string><key>CFBundleExecutable</key><string>TorrentEngine</string><key>CFBundlePackageType</key><string>FMWK</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>2.0.11</string><key>MinimumOSVersion</key><string>18.0</string></dict></plist>
PLIST
done
output="$repo/ios/TorrentEngine/TorrentEngine.xcframework"
if [ -d "$output" ]; then mv "$output" "$work/previous-framework-$(date +%s)"; fi
xcodebuild -create-xcframework \
  -framework "$work/iphoneos/TorrentEngine.framework" \
  -framework "$work/iphonesimulator/TorrentEngine.framework" \
  -output "$output"
