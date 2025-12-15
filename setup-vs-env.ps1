# Setup Visual Studio Environment
# 加载 VS 2022 Build Tools 环境变量

Write-Host "Loading Visual Studio 2022 environment..." -ForegroundColor Cyan

$vsPath = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"

if (Test-Path $vsPath) {
    # 运行 VsDevCmd.bat 并导入环境变量
    cmd /c "`"$vsPath`" && set" | ForEach-Object {
        if ($_ -match "^(.*?)=(.*)$") {
            $key = $matches[1]
            $value = $matches[2]
            [System.Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }
    
    Write-Host "✅ Visual Studio environment loaded successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Verifying link.exe..." -ForegroundColor Yellow
    
    $linkPath = (Get-Command link.exe -ErrorAction SilentlyContinue).Source
    if ($linkPath) {
        Write-Host "✅ link.exe found at: $linkPath" -ForegroundColor Green
    } else {
        Write-Host "❌ link.exe not found in PATH" -ForegroundColor Red
    }
    
    Write-Host ""
    Write-Host "You can now run: pnpm dev" -ForegroundColor Cyan
} else {
    Write-Host "❌ Visual Studio 2022 Build Tools not found at expected location" -ForegroundColor Red
    Write-Host "Please install from: https://aka.ms/vs/17/release/vs_BuildTools.exe" -ForegroundColor Yellow
}

