import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const androidDirectory = fileURLToPath(new URL('../', import.meta.url));

test('Compose test dependencies stay in the JVM test scope', () => {
  const buildFile = readFileSync(join(androidDirectory, 'app/build.gradle.kts'), 'utf8');
  const dependencies = buildFile.match(/dependencies\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(dependencies, 'Android app dependencies block exists');
  assert.match(dependencies, /testImplementation\(composeBom\)/);
  assert.match(dependencies, /testImplementation\("androidx\.compose\.ui:ui-test-junit4"\)/);
  assert.doesNotMatch(dependencies, /^\s*implementation\([^\n]*ui-test-junit4/m);
});

const cases = [
  { name: 'release and local builds retain every supported ABI without a compiler launcher', properties: [], abis: ['arm64-v8a', 'armeabi-v7a', 'x86_64'], cmake: [] },
  { name: 'CI builds only the emulator ABI and enables the requested compiler cache', properties: ['-Pbookstr.abis=x86_64', '-Pbookstr.cxxCompilerLauncher=ccache'], abis: ['x86_64'], cmake: ['-DCMAKE_CXX_COMPILER_LAUNCHER=ccache'] },
  { name: 'local ARM emulator builds can select one ABI without installing ccache', properties: ['-Pbookstr.abis=arm64-v8a'], abis: ['arm64-v8a'], cmake: [] },
  { name: 'release version properties override the UTC default without changing versionCode', properties: ['-Pbookstr.versionCode=1000000042', '-Pbookstr.versionName=0.1-20261105-1932'], abis: ['arm64-v8a', 'armeabi-v7a', 'x86_64'], cmake: [], versionCode: 1000000042, versionName: '0.1-20261105-1932' },
];

for (const configuration of cases) {
  test(configuration.name, () => {
    const directory = mkdtempSync(join(tmpdir(), 'bookstr-build-configuration-'));
    try {
      const init = join(directory, 'inspect.gradle');
      writeFileSync(init, `gradle.projectsEvaluated {
  allprojects { project ->
    if (project.plugins.hasPlugin('com.android.application')) {
      def config = project.extensions.getByName('android').defaultConfig
      def coverage = project.tasks.getByName('testDebugUnitTest').extensions.getByType(org.gradle.testing.jacoco.plugins.JacocoTaskExtension)
      println('BOOKSTR_BUILD_CONFIGURATION=' + groovy.json.JsonOutput.toJson([
        compressNativeLibraries: project.android.packaging.jniLibs.useLegacyPackaging,
        abis: config.ndk.abiFilters.sort(),
        cmake: config.externalNativeBuild.cmake.arguments,
        coverage: [includeNoLocationClasses: coverage.includeNoLocationClasses, excludes: coverage.excludes],
        versionCode: config.versionCode,
        versionName: config.versionName
      ]))
    }
  }
}
`);
      const result = spawnSync(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [
        process.env.GITHUB_ACTIONS === 'true' ? '--daemon' : '--no-daemon',
        '--no-configuration-cache', '--max-workers=2',
        '-Dorg.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8',
        '--init-script', init, 'help', ...configuration.properties,
      ], { cwd: androidDirectory, encoding: 'utf8', timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
      const line = result.stdout.split('\n').find(value => value.startsWith('BOOKSTR_BUILD_CONFIGURATION='));
      assert.ok(line, 'Gradle reported the actual Android build configuration');
      const actual = JSON.parse(line.slice('BOOKSTR_BUILD_CONFIGURATION='.length));
      assert.equal(actual.compressNativeLibraries, true);
      assert.deepEqual({ abis: actual.abis, cmake: actual.cmake, coverage: actual.coverage }, {
        abis: configuration.abis, cmake: configuration.cmake,
        coverage: { includeNoLocationClasses: true, excludes: ['jdk.internal.*'] },
      });
      if (configuration.versionCode !== undefined) assert.equal(actual.versionCode, configuration.versionCode);
      else assert.ok(Number.isSafeInteger(actual.versionCode) && actual.versionCode > 0);
      if (configuration.versionName) assert.equal(actual.versionName, configuration.versionName);
      else assert.match(actual.versionName, /^0\.1-\d{8}-\d{4}$/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
