import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  { name: 'release and local builds retain every supported ABI without a compiler launcher', properties: [], abis: ['arm64-v8a', 'armeabi-v7a', 'x86_64'], cmake: ['-DBOOKSTR_NATIVE_COVERAGE=OFF'] },
  { name: 'CI builds only the emulator ABI and enables the requested compiler cache', properties: ['-Pbookstr.abis=x86_64', '-Pbookstr.cxxCompilerLauncher=ccache'], abis: ['x86_64'], cmake: ['-DCMAKE_CXX_COMPILER_LAUNCHER=ccache', '-DBOOKSTR_NATIVE_COVERAGE=OFF'] },
  { name: 'local ARM emulator builds can select one ABI without installing ccache', properties: ['-Pbookstr.abis=arm64-v8a'], abis: ['arm64-v8a'], cmake: ['-DBOOKSTR_NATIVE_COVERAGE=OFF'] },
  { name: 'debug builds can opt into native source coverage', properties: ['-Pbookstr.nativeCoverage=true'], abis: ['arm64-v8a', 'armeabi-v7a', 'x86_64'], cmake: ['-DBOOKSTR_NATIVE_COVERAGE=ON'] },
  { name: 'explicit false resets cached native coverage to off', properties: ['-Pbookstr.nativeCoverage=false'], abis: ['arm64-v8a', 'armeabi-v7a', 'x86_64'], cmake: ['-DBOOKSTR_NATIVE_COVERAGE=OFF'] },
  { name: 'release version properties override the UTC default without changing versionCode', properties: ['-Pbookstr.versionCode=1000000042', '-Pbookstr.versionName=0.1-20261105-1932'], abis: ['arm64-v8a', 'armeabi-v7a', 'x86_64'], cmake: ['-DBOOKSTR_NATIVE_COVERAGE=OFF'], sourceDateEpoch: 1700000000, versionCode: 1000000042, versionName: '0.1-20261105-1932', buildDate: '2023-11-14 22:13' },
  { name: 'SOURCE_DATE_EPOCH fixes generated BuildConfig and default APK version values', properties: [], abis: ['arm64-v8a', 'armeabi-v7a', 'x86_64'], cmake: ['-DBOOKSTR_NATIVE_COVERAGE=OFF'], sourceDateEpoch: 1700000000, versionCode: 28333333, versionName: '0.1-20231114-2213', buildDate: '2023-11-14 22:13' },
];

for (const configuration of cases) {
  test(configuration.name, () => {
    const directory = mkdtempSync(join(tmpdir(), 'bookstr-build-configuration-'));
    try {
      const init = join(directory, 'inspect.gradle');
      writeFileSync(init, `gradle.projectsEvaluated {
  rootProject.allprojects { project ->
    if (project.plugins.hasPlugin('com.android.application')) {
      def config = project.extensions.getByName('android').defaultConfig
      def coverage = project.tasks.named('testDebugUnitTest').get().extensions.getByType(org.gradle.testing.jacoco.plugins.JacocoTaskExtension)
      println('BOOKSTR_BUILD_CONFIGURATION=' + groovy.json.JsonOutput.toJson([
        includeNoLocationClasses: coverage.includeNoLocationClasses,
        coverageExcludes: coverage.excludes,
        compressNativeLibraries: project.android.packaging.jniLibs.useLegacyPackaging,
        javaCompileDestination: project.tasks.named('compileDebugJavaWithJavac').get().destinationDirectory.get().asFile.absolutePath,
        buildDate: project.android.defaultConfig.buildConfigFields.get('BUILD_DATE').value.replace('"', '').replace('"', ''),
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
      ], {
        cwd: androidDirectory,
        encoding: 'utf8',
        timeout: 300_000,
        maxBuffer: 4 * 1024 * 1024,
        env: environmentForSourceDate(configuration.sourceDateEpoch),
      });
      assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
      const line = result.stdout.split('\n').find(value => value.startsWith('BOOKSTR_BUILD_CONFIGURATION='));
      assert.ok(line, 'Gradle reported the actual Android build configuration');
      const actual = JSON.parse(line.slice('BOOKSTR_BUILD_CONFIGURATION='.length));
      assert.equal(actual.compressNativeLibraries, true);
      assert.deepEqual({ abis: actual.abis, cmake: actual.cmake, coverage: actual.coverage }, {
        abis: configuration.abis, cmake: configuration.cmake,
        coverage: { includeNoLocationClasses: true, excludes: ['jdk.internal.*'] },
      });
      assert.equal(actual.includeNoLocationClasses, true, 'Robolectric sandbox classes contribute coverage');
      assert.deepEqual(actual.coverageExcludes, ['jdk.internal.*'], 'only JDK internals are excluded from instrumentation');
      assert.match(actual.javaCompileDestination, /compileDebugJavaWithJavac[\\/]classes$/, 'coverage staging can use the actual AGP JavaCompile output');
      if (configuration.versionCode !== undefined) assert.equal(actual.versionCode, configuration.versionCode);
      else assert.ok(Number.isSafeInteger(actual.versionCode) && actual.versionCode > 0);
      if (configuration.versionName) assert.equal(actual.versionName, configuration.versionName);
      else assert.match(actual.versionName, /^0\.1-\d{8}-\d{4}$/);
      if (configuration.buildDate) assert.equal(actual.buildDate, configuration.buildDate);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

for (const value of ['invalid', '-1']) {
  test(`SOURCE_DATE_EPOCH rejects ${value}`, () => {
    const result = spawnSync(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [
      process.env.GITHUB_ACTIONS === 'true' ? '--daemon' : '--no-daemon',
      '--no-configuration-cache', '--max-workers=2',
      '-Dorg.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8',
      'help',
    ], {
      cwd: androidDirectory,
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 4 * 1024 * 1024,
      env: environmentForSourceDate(value),
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, output);
    assert.ok(output.includes('SOURCE_DATE_EPOCH must be a non-negative integer when set'), output);
  });
}

function environmentForSourceDate(epoch) {
  const environment = { ...process.env };
  delete environment.SOURCE_DATE_EPOCH;
  if (epoch !== undefined) environment.SOURCE_DATE_EPOCH = String(epoch);
  return environment;
}

test('managed full JaCoCo report validates downloaded inputs without compiling or testing', () => {
  const build = readFileSync(join(androidDirectory, 'app/build.gradle.kts'), 'utf8');
  const report = build.split('tasks.register<JacocoReport>("jacocoManagedFullDebugReport") {')[1]
    ?.split('\ndependencies {')[0];
  assert.ok(report, 'managed full report task is registered');
  assert.match(report, /dependsOn\("verifyManagedDebugCoverageInputs"\)/);
  assert.match(report, /classDirectories\.setFrom\(fileTree\(stagedManagedCoverageClasses\)\)/);
  assert.match(report, /executionData\.setFrom\(managedJvmExecutionData, managedDeviceExecutionData\)/);
  const guard = build.split('tasks.register("verifyManagedDebugCoverageInputs") {')[1]
    ?.split('\ntasks.register<JacocoReport>("jacocoManagedFullDebugReport")')[0];
  assert.ok(guard, 'input checks run in a prerequisite task before JaCoCo can skip the report');
  assert.match(guard, /Missing JVM JaCoCo execution data/);
  assert.match(guard, /Missing emulator JaCoCo execution data/);
  assert.match(guard, /Missing staged Android project class files/);
  assert.doesNotMatch(guard.split('    doLast {')[1], /fileTree\(|managedJvmExecutionData\.get\(|managedDeviceExecutionData\.get\(|stagedManagedCoverageClasses\.get\(/,
    'task action must not call Project APIs or resolve providers while executing');
  const capturedInputs = guard.split('    doLast {')[0];
  assert.match(capturedInputs, /managedJvmExecutionData\.get\(\)\.asFile/);
  assert.match(capturedInputs, /managedDeviceExecutionData\.get\(\)\.asFile/);
  assert.match(capturedInputs, /managedCoverageClassesDir = stagedManagedCoverageClasses\.get\(\)\.asFile/);
  assert.match(capturedInputs, /managedCoverageClassFiles = fileTree\(managedCoverageClassesDir\)\.matching/);
  assert.doesNotMatch(report, /dependsOn\("testDebugUnitTest"|dependsOn\("compileDebug/,
    'the report task consumes downloaded inputs without running tests or compilers');

  const staging = build.split('tasks.register<Sync>("stageDebugManagedCoverageClasses") {')[1]
    ?.split('\n}\n\n// This report')[0];
  assert.ok(staging, 'package job can stage compiled project classes');
  assert.match(staging, /compileDebugKotlin.*compileDebugJavaWithJavac/);
  assert.match(staging, /tasks\.named<JavaCompile>\("compileDebugJavaWithJavac"\)\.map \{ it\.destinationDirectory \}/);
  assert.match(staging, /tasks\.named\("compileDebugKotlin"\)\.map \{ it\.outputs\.files \}/);
});

const coverageGuardCases = [
  { name: 'missing JVM execution data fails the report dependency', missing: 'jvm', message: 'Missing JVM JaCoCo execution data' },
  { name: 'missing emulator execution data fails the report dependency', missing: 'device', message: 'Missing emulator JaCoCo execution data' },
  { name: 'missing compiled classes fails the report dependency', missing: 'classes', message: 'Missing staged Android project class files' },
  { name: 'empty JVM execution data fails the report dependency', missing: 'jvm', empty: true, message: 'Missing JVM JaCoCo execution data' },
  { name: 'empty emulator execution data fails the report dependency', missing: 'device', empty: true, message: 'Missing emulator JaCoCo execution data' },
  { name: 'all placeholder inputs pass validation without running JaCoCo', missing: null },
];

for (const scenario of coverageGuardCases) {
  test(`managed coverage input guard: ${scenario.name}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'bookstr-managed-coverage-guard-'));
    try {
      const buildDirectory = join(directory, 'build');
      const classes = join(buildDirectory, 'coverage/project-classes/example');
      const jvmData = join(buildDirectory, 'outputs/unit_test_code_coverage/debugUnitTest/testDebugUnitTest.exec');
      const deviceData = join(buildDirectory, 'coverage/full.ec');
      mkdirSync(classes, { recursive: true });
      if (scenario.missing !== 'jvm' || scenario.empty) {
        mkdirSync(join(buildDirectory, 'outputs/unit_test_code_coverage/debugUnitTest'), { recursive: true });
        writeFileSync(jvmData, scenario.empty && scenario.missing === 'jvm' ? '' : 'placeholder JVM bytes');
      }
      if (scenario.missing !== 'device' || scenario.empty) {
        mkdirSync(join(buildDirectory, 'coverage'), { recursive: true });
        writeFileSync(deviceData, scenario.empty && scenario.missing === 'device' ? '' : 'placeholder emulator bytes');
      }
      if (scenario.missing !== 'classes') writeFileSync(join(classes, 'Example.class'), 'placeholder class bytes');

      const init = join(directory, 'coverage-guard.gradle');
      writeFileSync(init, `gradle.beforeProject { project ->
  if (project.name == 'app') {
    project.layout.buildDirectory.set(new File(gradle.startParameter.projectProperties['coverageTestBuildDir']))
  }
}
`);
      const task = scenario.missing ? ':app:jacocoManagedFullDebugReport' : ':app:verifyManagedDebugCoverageInputs';
      const result = spawnSync(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [
        process.env.GITHUB_ACTIONS === 'true' ? '--daemon' : '--no-daemon',
        '--no-configuration-cache', '--max-workers=2',
        '-Dorg.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8',
        '--init-script', init,
        `-PcoverageTestBuildDir=${buildDirectory}`,
        task,
      ], { cwd: androidDirectory, encoding: 'utf8', timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
      const output = `${result.stdout}\n${result.stderr}`;
      if (scenario.message) {
        assert.notEqual(result.status, 0, output);
        assert.ok(output.includes(scenario.message), output);
        assert.match(output, /> Task :app:verifyManagedDebugCoverageInputs FAILED/);
      } else {
        assert.equal(result.status, 0, output);
        assert.match(output, /> Task :app:verifyManagedDebugCoverageInputs/);
        assert.doesNotMatch(output, /> Task :app:jacocoManagedFullDebugReport/,
          'dummy bytes prove only input validation and are never presented as a coverage report');
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('managed coverage input guard reuses the configuration cache', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookstr-managed-coverage-cache-'));
  try {
    const buildDirectory = join(directory, 'build');
    mkdirSync(join(buildDirectory, 'coverage/project-classes/example'), { recursive: true });
    mkdirSync(join(buildDirectory, 'outputs/unit_test_code_coverage/debugUnitTest'), { recursive: true });
    writeFileSync(join(buildDirectory, 'outputs/unit_test_code_coverage/debugUnitTest/testDebugUnitTest.exec'), 'placeholder JVM bytes');
    writeFileSync(join(buildDirectory, 'coverage/full.ec'), 'placeholder emulator bytes');
    writeFileSync(join(buildDirectory, 'coverage/project-classes/example/Example.class'), 'placeholder class bytes');

    const init = join(directory, 'coverage-cache.gradle');
    writeFileSync(init, `gradle.beforeProject { project ->
  if (project.name == 'app') {
    project.layout.buildDirectory.set(new File(gradle.startParameter.projectProperties['coverageTestBuildDir']))
  }
}
`);
    const command = [
      process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
      process.env.GITHUB_ACTIONS === 'true' ? '--daemon' : '--no-daemon',
      '--configuration-cache', '--max-workers=2',
      '-Dorg.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8',
      '--init-script', init,
      `-PcoverageTestBuildDir=${buildDirectory}`,
      ':app:verifyManagedDebugCoverageInputs',
    ];
    const runGuard = () => spawnSync(command[0], command.slice(1), {
      cwd: androidDirectory,
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 4 * 1024 * 1024,
    });

    const first = runGuard();
    const firstOutput = `${first.stdout}\n${first.stderr}`;
    assert.equal(first.status, 0, firstOutput);
    assert.match(firstOutput, /> Task :app:verifyManagedDebugCoverageInputs/);
    assert.match(firstOutput, /Configuration cache entry stored/);

    const second = runGuard();
    const secondOutput = `${second.stdout}\n${second.stderr}`;
    assert.equal(second.status, 0, secondOutput);
    assert.match(secondOutput, /> Task :app:verifyManagedDebugCoverageInputs/);
    assert.match(secondOutput, /Configuration cache entry reused/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native coverage Gradle property rejects unrecognized values', () => {
  const result = spawnSync(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [
    process.env.GITHUB_ACTIONS === 'true' ? '--daemon' : '--no-daemon',
    '--no-configuration-cache', '--max-workers=2',
    '-Dorg.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8',
    'help', '-Pbookstr.nativeCoverage=enabled',
  ], { cwd: androidDirectory, encoding: 'utf8', timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /bookstr\.nativeCoverage must be true or false/);
});
