import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFileSync(new URL(path, new URL('../', import.meta.url)), 'utf8');

test('unused iOS icon exports stay outside the app resource manifests', () => {
  const manifests = ['ios/project.yml', 'ios/BookstrIOS.xcodeproj/project.pbxproj'];
  for (const name of ['favicon.svg.png', 'android-icon-match.svg.png']) {
    assert.equal(existsSync(new URL(`../ios/${name}`, import.meta.url)), false);
    for (const manifest of manifests) assert.ok(!read(manifest).includes(name), manifest);
  }
  for (const path of [
    'ios/BookstrIOS/Assets.xcassets/AppIcon.appiconset/AppIcon.png',
    'android/app/src/main/res/drawable-nodpi/ic_launcher_artwork.png',
    'desktop/assets/icon-macos.png',
    'web/public/apple-touch-icon.png',
  ]) {
    const bytes = readFileSync(new URL(`../${path}`, import.meta.url));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', path);
  }
  const icons = JSON.parse(read('ios/BookstrIOS/Assets.xcassets/AppIcon.appiconset/Contents.json'));
  assert.ok(icons.images.some((image: {filename?: string}) => image.filename === 'AppIcon.png'));
  assert.match(read('ios/project.yml'), /ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon/);
  assert.match(read('ios/BookstrIOS.xcodeproj/project.pbxproj'), /ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon/);
});

test('Android screenshots are ignored without hiding their tests or capture script', () => {
  const screenshots = [
    'android/e2e-screenshots/example.png',
    ...Array.from({ length: 4 }, (_, index) => `android/e2e-screenshots/shard-${index}/example.png`),
  ];
  const source = 'android/app/src/androidTest/java/app/bookstr/E2eScreenshotRule.kt';
  const script = 'android/scripts/run-connected-e2e.sh';
  const ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd: root, input: [...screenshots, source, script].join('\n') + '\n', encoding: 'utf8',
  });
  assert.deepEqual(ignored.trim().split('\n'), screenshots);
  assert.match(read(script), /host_screenshot_dir="android\/e2e-screenshots\$shard_suffix"/);
  assert.match(read('.github/workflows/android.yml'), /path: android\/e2e-screenshots\/\*\*\/\*\.png/);
});

test('design asset links work independently of the documentation deployment directory', () => {
  const design = read('docs/DESIGN.md');
  for (const name of ['bookstr-mark.svg', 'bookstr-logo.svg']) {
    assert.ok(design.includes(`](https://github.com/guaka/bookstr/blob/main/brand/${name})`));
    assert.ok(existsSync(new URL(`../brand/${name}`, import.meta.url)));
  }
});

test('shared documentation describes every shared subsystem', () => {
  const documentation = read('shared/README.md');
  const directories = readdirSync(new URL('../shared/', import.meta.url), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name);
  for (const directory of directories) assert.ok(documentation.includes(`\`${directory}/\``), directory);
});

test('Android quickstart restricts connected tests to emulators', () => {
  assert.match(read('README.md'), /connectedDebugAndroidTest[^\n]*requires an emulator; never run on a personal device/);
});
