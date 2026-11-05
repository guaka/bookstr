import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const androidDirectory = fileURLToPath(new URL('../', import.meta.url));
const cases = [
  { name: 'release and local builds retain every supported ABI without a compiler launcher', properties: [], abis: ['arm64-v8a', 'armeabi-v7a', 'x86_64'], cmake: [] },
  { name: 'CI builds only the emulator ABI and enables the requested compiler cache', properties: ['-Pbookstr.abis=x86_64', '-Pbookstr.cxxCompilerLauncher=ccache'], abis: ['x86_64'], cmake: ['-DCMAKE_CXX_COMPILER_LAUNCHER=ccache'] },
  { name: 'local ARM emulator builds can select one ABI without installing ccache', properties: ['-Pbookstr.abis=arm64-v8a'], abis: ['arm64-v8a'], cmake: [] },
];

for (const configuration of cases) {
  test(configuration.name, () => {
    const directory = mkdtempSync(join(tmpdir(), 'bookstr-build-configuration-'));
    try {
      const init = join(directory, 'inspect.gradle');
      writeFileSync(init, `allprojects {
  afterEvaluate { project ->
    if (project.plugins.hasPlugin('com.android.application')) {
      def config = project.extensions.getByName('android').defaultConfig
      println('BOOKSTR_BUILD_CONFIGURATION=' + groovy.json.JsonOutput.toJson([
        abis: config.ndk.abiFilters.sort(),
        cmake: config.externalNativeBuild.cmake.arguments
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
      assert.deepEqual(JSON.parse(line.slice('BOOKSTR_BUILD_CONFIGURATION='.length)), {
        abis: configuration.abis, cmake: configuration.cmake,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
