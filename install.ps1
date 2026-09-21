$ErrorActionPreference = 'Stop'
function Install-GlasHaus {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 LTS first: https://nodejs.org/en/download' }
    & node -e 'const [major,minor]=process.versions.node.split(/\./).map(Number);process.exit(major===24&&minor>=14?0:1)'
    if ($LASTEXITCODE -ne 0) { throw 'GlasHaus v3 requires Node 24.14 or newer within the 24.x line.' }
    $releaseTag = if ($env:GLASHAUS_RELEASE_TAG) { $env:GLASHAUS_RELEASE_TAG } else { 'v3.0.0-alpha.7' }
    if ($releaseTag -and $releaseTag -notmatch '^v3\.[A-Za-z0-9._-]+$') { throw 'GLASHAUS_RELEASE_TAG must be a v3 release tag.' }
    $releaseBase = "https://github.com/bopparino/glashaus/releases/download/$releaseTag"
    $installBase = if ($env:GLASHAUS_INSTALL_ROOT) { [IO.Path]::GetFullPath($env:GLASHAUS_INSTALL_ROOT) } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.local/share/glashaus' }
    $installDir = Join-Path $installBase ('v3-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
    $downloadDir = Join-Path ([IO.Path]::GetTempPath()) ('glashaus-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $installDir, $downloadDir -Force | Out-Null
    $zipPath = Join-Path $downloadDir 'glashaus-v3.zip'
    $checksumPath = Join-Path $downloadDir 'glashaus-v3.zip.sha256'
    Write-Host 'Downloading the published GlasHaus v3 release...'
    try {
        if ($env:GLASHAUS_ARCHIVE) {
            $localArchive = (Resolve-Path -LiteralPath $env:GLASHAUS_ARCHIVE).Path
            Copy-Item -LiteralPath $localArchive -Destination $zipPath
            $checksumText = Get-Content -LiteralPath "$localArchive.sha256" -Raw
        } else {
            Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/glashaus-v3.zip" -OutFile $zipPath
            # GitHub serves this as octet-stream; PowerShell 5 returns byte[] in
            # .Content. Reading the downloaded file avoids byte-to-string coercion.
            Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/glashaus-v3.zip.sha256" -OutFile $checksumPath
            $checksumText = Get-Content -LiteralPath $checksumPath -Raw
        }
        $expectedHash = ($checksumText.Trim() -split '\s+')[0]
        if ($expectedHash -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Release checksum did not match. No downloaded code was run.' }
        Expand-Archive -LiteralPath $zipPath -DestinationPath $installDir
        $entry = Join-Path $installDir 'bin/glashaus-v3.js'
        if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'This release does not contain a v3 app.' }
        Write-Host "Installed in $installDir"
        Write-Host "To start again: node `"$entry`""
        Write-Host 'Your companion data is separate, in ~/.glashaus-v3. Existing v2 data is untouched.'
        if ($env:GLASHAUS_INSTALL_ONLY -ne '1') { & node $entry install; if ($LASTEXITCODE -ne 0) { throw "GlasHaus exited with code $LASTEXITCODE." } }
    } catch { throw "Installation stopped. Check that a v3 release and checksum have been published. $($_.Exception.Message)" }
    finally {
        # Delete only the two exact download files created by this invocation.
        if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath }
        if (Test-Path -LiteralPath $checksumPath) { Remove-Item -LiteralPath $checksumPath }
        if (Test-Path -LiteralPath $downloadDir) { Remove-Item -LiteralPath $downloadDir }
    }
}
Install-GlasHaus
