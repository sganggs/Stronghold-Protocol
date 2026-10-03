# Local one-command build (Windows). CI mirrors these steps, see .github/workflows/apk.yml
param(
    [string]$JavaHome = 'C:\Users\16891\android-build\jdk-extracted\jdk-17.0.20.1+1',
    [string]$GradleBat = 'C:\Users\16891\android-build\dl\gradle-extracted\gradle-8.14.3\bin\gradle.bat'
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

node (Join-Path $repoRoot 'tools\apk\fetch-termux-node.mjs')
node (Join-Path $repoRoot 'tools\apk\build-webroot.mjs')

$env:JAVA_HOME = $JavaHome
& $GradleBat -p (Join-Path $repoRoot 'android') assembleRelease --console=plain
Write-Host ''
Write-Host 'APK: android\app\build\outputs\apk\release\app-release.apk'
