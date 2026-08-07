$ErrorActionPreference = "Stop"

$repoRoot = "C:\Users\ajusu\Desktop\Echoza"
Set-Location $repoRoot

$currentVersion = [regex]::Match((Get-Content "$repoRoot\client\src\main.tsx" -Raw), "const STORAGE_VERSION = '(\d+)'").Groups[1].Value
$newVersion = [int]$currentVersion + 1
sed -i "s/const STORAGE_VERSION = '[0-9]*/const STORAGE_VERSION = '${newVersion}'/" "$repoRoot\client\src\main.tsx"

Write-Host "Storage version updated from $currentVersion to $newVersion"

Set-Location "$repoRoot\client"
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue node_modules\.cache
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue dist

Write-Host "Vite build cache cleared"

if (Get-Command gcloud -ErrorAction SilentlyContinue) {
    Write-Host "Google Cloud CLI found - attempting to clear App Engine cache"
}

Write-Host "Cache clear complete for deployment"
