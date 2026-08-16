$ErrorActionPreference = "Stop"

if (-not $env:ANDROID_HOME) {
    $candidate = Join-Path $env:LOCALAPPDATA "Android\Sdk"
    if (Test-Path -LiteralPath $candidate) {
        $env:ANDROID_HOME = $candidate
    }
}

if (-not $env:ANDROID_HOME) {
    throw "Set ANDROID_HOME to an SDK containing platforms;android-36 and build-tools;36.0.0."
}

& "$PSScriptRoot\gradlew.bat" --no-daemon --stacktrace `
    :app:testDebugUnitTest `
    :app:lintRelease `
    :app:assembleDebug `
    :app:bundleRelease

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
