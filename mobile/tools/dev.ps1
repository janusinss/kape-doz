param([ValidateSet('test','analyze','apk','preview','doctor')][string]$Task='test')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$workspaceRoot=Split-Path $projectRoot -Parent
$flutterCommand=Get-Command flutter -ErrorAction Stop
$flutterSdk=Split-Path (Split-Path $flutterCommand.Source -Parent) -Parent
$env:FLUTTER_ROOT=$flutterSdk
$env:PUB_CACHE=Join-Path $workspaceRoot 'scratch\pub-cache'
$env:ANDROID_HOME=Join-Path $workspaceRoot 'scratch\android-sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:GRADLE_USER_HOME=Join-Path $workspaceRoot 'scratch\gradle-cache'
$javaCommand=Get-Command java -ErrorAction Stop
$env:JAVA_HOME=Split-Path (Split-Path $javaCommand.Source -Parent) -Parent
# Use the Windows certificate store; TLS validation remains enabled.
$env:JAVA_TOOL_OPTIONS='-Djavax.net.ssl.trustStoreType=Windows-ROOT -Djavax.net.ssl.trustStore=NONE'
$dartTool=Join-Path $flutterSdk 'bin\cache\dart-sdk\bin\dart.exe'
$flutterSnapshot=Join-Path $flutterSdk 'bin\cache\flutter_tools.snapshot'
$packageConfig=Join-Path $flutterSdk 'packages\flutter_tools\.dart_tool\package_config.json'
[string[]]$taskArguments=switch($Task){
 'test' { @('test') }
 'analyze' { @('analyze') }
 'apk' { @('build','apk','--debug','--target-platform','android-arm64') }
 'preview' { @('run','-d','web-server','--web-hostname','127.0.0.1','--web-port','0') }
 'doctor' { @('doctor','-v') }
}
Push-Location $projectRoot
try { & $dartTool "--packages=$packageConfig" $flutterSnapshot @taskArguments; if($LASTEXITCODE -ne 0){throw "Flutter $Task failed with exit code $LASTEXITCODE"} }
finally {Pop-Location}
