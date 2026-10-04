const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '../../..');

function pngHeader(relativePath) {
  const contents = fs.readFileSync(path.join(projectRoot, relativePath));
  assert.equal(contents.toString('ascii', 1, 4), 'PNG');
  return {
    contents,
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
    colorType: contents[25],
  };
}

test('platform icons keep their expected dimensions and desktop artwork stays in sync with Android', () => {
  const desktopIcon = pngHeader('desktop/assets/icon-macos.png');
  const webIcon = pngHeader('web/public/apple-touch-icon.png');
  const iosIcon = pngHeader('ios/BookstrIOS/Assets.xcassets/AppIcon.appiconset/AppIcon.png');
  const androidIcon = pngHeader('android/app/src/main/res/drawable-nodpi/ic_launcher_artwork.png');
  assert.deepEqual(
    { width: desktopIcon.width, height: desktopIcon.height, colorType: desktopIcon.colorType },
    { width: 1024, height: 1024, colorType: 6 },
  );
  assert.deepEqual(
    { width: webIcon.width, height: webIcon.height, colorType: webIcon.colorType },
    { width: 1024, height: 1024, colorType: 2 },
  );
  assert.deepEqual(
    { width: iosIcon.width, height: iosIcon.height, colorType: iosIcon.colorType },
    { width: 1024, height: 1024, colorType: 2 },
  );
  assert.deepEqual(androidIcon.contents, desktopIcon.contents);
});
