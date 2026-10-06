# Read-only. Does not connect, disconnect, or change either VPN.
$ErrorActionPreference = 'Continue'
$status = $null
$tsPath = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
$warpPath = Join-Path $env:ProgramFiles 'Cloudflare\Cloudflare WARP\warp-cli.exe'

function Invoke-LocalCheck([string] $Path, [string] $Arguments) {
    if (-not (Test-Path -LiteralPath $Path)) { return "Not found: $Path" }
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Path
    $info.Arguments = $Arguments
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        [void] $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(15000)) {
            $process.Kill()
            return 'Check timed out after 15 seconds.'
        }
        $result = $stdout.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { return "Check failed (exit $($process.ExitCode)); output omitted." }
        return $result.Trim()
    } finally { $process.Dispose() }
}

'GlasHaus connection check - no settings changed'
'WARP version: ' + (Invoke-LocalCheck $warpPath '--version')
'WARP status: ' + (Invoke-LocalCheck $warpPath 'status')
'Tailscale version: ' + ((Invoke-LocalCheck $tsPath 'version') -split "`n" | Select-Object -First 1)
try {
    $status = Invoke-LocalCheck $tsPath 'status --json' | ConvertFrom-Json -ErrorAction Stop
    'Tailscale state: ' + $status.BackendState
    'Tailscale online: ' + $status.Self.Online
    'Tailscale health: ' + ($status.Health -join '; ')
    'Using a Tailscale exit node: ' + [bool] $status.ExitNodeStatus
} catch { 'Tailscale status could not be read as JSON.' }
try {
    $prefs = Invoke-LocalCheck $tsPath 'debug prefs' | ConvertFrom-Json -ErrorAction Stop
    'Tailscale manages DNS: ' + $prefs.CorpDNS
    'Tailscale accepts subnet routes: ' + $prefs.RouteAll
} catch { 'Tailscale preferences unavailable; continue with the other results.' }
'WARP excluded ranges:'
Invoke-LocalCheck $warpPath 'tunnel ip list'
try {
    $answer = Resolve-DnsName 'controlplane.tailscale.com' -ErrorAction Stop
    'Public Tailscale DNS lookup: ' + [bool] ($answer | Where-Object IPAddress)
} catch { 'Public Tailscale DNS lookup: failed' }
if ($status.Self.DNSName) {
    $privateName = $status.Self.DNSName.TrimEnd('.')
    try {
        $answer = Resolve-DnsName $privateName -ErrorAction Stop
        'Private host DNS lookup: ' + [bool] ($answer | Where-Object IPAddress)
    } catch { 'Private host DNS lookup: failed' }
}
'End of check. WARP, Tailscale, routes, DNS settings and firewall rules were left unchanged.'
