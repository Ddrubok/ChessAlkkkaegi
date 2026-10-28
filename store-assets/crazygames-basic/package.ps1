$ErrorActionPreference = 'Stop'
$packageRoot = $PSScriptRoot
$repoRoot = [IO.Path]::GetFullPath((Join-Path $packageRoot '../..'))
$distRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'web/dist-crazygames'))
$zipPath = Join-Path $packageRoot 'ChessAlkkagi-CrazyGames-Basic.zip'
if (-not (Test-Path -LiteralPath (Join-Path $distRoot 'index.html'))) { throw 'Run npm run build:crazygames in web first.' }
Push-Location (Join-Path $repoRoot 'web')
try { node src/tools/crazygames-build-check.mjs; if ($LASTEXITCODE -ne 0) { throw 'Artifact check failed.' } }
finally { Pop-Location }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
# Windows PowerShell Compress-Archive emits backslash paths; web hosts need POSIX entry names.
$zipStream = [IO.File]::Create($zipPath)
$writer = [IO.Compression.ZipArchive]::new($zipStream, [IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $distRoot -File -Recurse | ForEach-Object {
    $entryName = $_.FullName.Substring($distRoot.Length + 1).Replace('\', '/')
    $entry = $writer.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
    $inputStream = [IO.File]::OpenRead($_.FullName)
    $outputStream = $entry.Open()
    try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
  }
} finally { $writer.Dispose(); $zipStream.Dispose() }
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $files = @($archive.Entries | Where-Object { $_.Name })
  if ($files | Where-Object { $_.FullName.Contains('\') -or $_.FullName.StartsWith('/') -or $_.FullName.Contains('../') }) { throw 'Nonportable ZIP entry path.' }
  if (-not ($files | Where-Object { $_.FullName -eq 'index.html' })) { throw 'index.html is not at archive root.' }
  $unpackedBytes = ($files | Measure-Object Length -Sum).Sum
  $manifest = [ordered]@{
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    file = [IO.Path]::GetFileName($zipPath)
    sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLower()
    compressedBytes = (Get-Item -LiteralPath $zipPath).Length
    unpackedBytes = $unpackedBytes
    fileCount = $files.Count
    buildInfo = Get-Content -LiteralPath (Join-Path $distRoot 'build-info.json') -Raw | ConvertFrom-Json
    releaseStatus = 'READY FOR PORTAL REVIEW: Poly Haven CC0 model; account and submission not completed'
    modelSource = 'https://polyhaven.com/a/chess_set'
    modelLicense = 'CC0-1.0'
    modelSha256 = (Get-FileHash -LiteralPath (Join-Path $distRoot 'assets/chess-pieces.glb') -Algorithm SHA256).Hash.ToLower()
  }
  $json = $manifest | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText((Join-Path $packageRoot 'PACKAGE.json'), $json, [Text.UTF8Encoding]::new($false))
  $json
} finally { $archive.Dispose() }
