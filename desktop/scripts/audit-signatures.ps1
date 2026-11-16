# Read-only Authenticode audit. No installer is executed and no trust store or policy is changed.
[CmdletBinding()]
param(
    [string]$ReleaseDir = (Join-Path $PSScriptRoot '..\release'),
    [switch]$RequireValid,
    [string]$ExpectedPublisher,
    [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
$releaseRoot = (Resolve-Path -LiteralPath $ReleaseDir).Path.TrimEnd('\', '/')
$issues = New-Object 'System.Collections.Generic.List[string]'
$records = New-Object 'System.Collections.Generic.List[object]'
$files = New-Object 'System.Collections.Generic.List[object]'

foreach ($file in @(Get-ChildItem -LiteralPath $releaseRoot -File -Filter '*.exe')) {
    $files.Add($file)
}
$unpacked = Join-Path $releaseRoot 'win-unpacked'
if (Test-Path -LiteralPath $unpacked -PathType Container) {
    foreach ($file in @(Get-ChildItem -LiteralPath $unpacked -Recurse -File |
            Where-Object { $_.Extension -in '.exe', '.dll', '.node' })) {
        $files.Add($file)
    }
}
$uninstallerEvidence = Join-Path $releaseRoot 'signing-audit/ShareRoom-uninstaller.exe'
if (Test-Path -LiteralPath $uninstallerEvidence -PathType Leaf) {
    $files.Add((Get-Item -LiteralPath $uninstallerEvidence))
} elseif ($RequireValid) {
    $issues.Add('Missing required binary: signing-audit/ShareRoom-uninstaller.exe')
}

$installers = @($files | Where-Object {
    $_.DirectoryName -eq $releaseRoot -and $_.Name -match '^ShareRoom-Setup-.*\.exe$' -and
    $_.Name -notmatch '__uninstaller\.exe$'
})
if ($installers.Count -ne 1) {
    $issues.Add("Expected exactly one ShareRoom-Setup-*.exe; found $($installers.Count).")
}
foreach ($required in @('win-unpacked/CosmicNight.exe', 'win-unpacked/resources/helper/ShareRoomAudio.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $releaseRoot $required) -PathType Leaf)) {
        $issues.Add("Missing required binary: $required")
    }
}
if ($RequireValid -and [string]::IsNullOrWhiteSpace($ExpectedPublisher)) {
    $issues.Add('ExpectedPublisher is required for an official release audit.')
}

$statusCounts = [ordered]@{}
foreach ($file in @($files | Sort-Object FullName -Unique)) {
    $relativePath = $file.FullName.Substring($releaseRoot.Length + 1).Replace('\', '/')
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    $certificate = $signature.SignerCertificate
    $timestampCertificate = $signature.TimeStamperCertificate
    $status = $signature.Status.ToString()
    $publisher = $null
    $isSelfSigned = $false
    $fileIssues = New-Object 'System.Collections.Generic.List[string]'
    if ($null -ne $certificate) {
        $publisher = $certificate.GetNameInfo(
            [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
        $isSelfSigned = $certificate.Subject -eq $certificate.Issuer
    }
    if ($status -ne 'Valid') {
        $fileIssues.Add("Authenticode status: $status")
    }
    if ($null -eq $timestampCertificate) {
        $fileIssues.Add('Missing Authenticode timestamp.')
    }
    if ($isSelfSigned) {
        $fileIssues.Add('Self-signed leaf certificate is not accepted for official releases.')
    }
    if ($file.Extension -ieq '.exe' -and -not [string]::IsNullOrWhiteSpace($ExpectedPublisher) -and
            -not [string]::Equals($publisher, $ExpectedPublisher, [System.StringComparison]::Ordinal)) {
        $fileIssues.Add('Executable publisher does not match ExpectedPublisher exactly.')
    }
    foreach ($issue in $fileIssues) {
        $issues.Add("${relativePath}: $issue")
    }
    if (-not $statusCounts.Contains($status)) { $statusCounts[$status] = 0 }
    $statusCounts[$status]++
    $records.Add([ordered]@{
        path = $relativePath
        size = $file.Length
        sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        status = $status
        publisher = $publisher
        subject = $(if ($certificate) { $certificate.Subject } else { $null })
        issuer = $(if ($certificate) { $certificate.Issuer } else { $null })
        thumbprint = $(if ($certificate) { $certificate.Thumbprint } else { $null })
        selfSignedLeaf = $isSelfSigned
        hasTimestamp = $null -ne $timestampCertificate
        timestampSubject = $(if ($timestampCertificate) { $timestampCertificate.Subject } else { $null })
        issues = @($fileIssues.ToArray())
    })
}

$report = [ordered]@{
    schemaVersion = 1
    auditedAtUtc = [DateTime]::UtcNow.ToString('o')
    expectedPublisher = $(if ($ExpectedPublisher) { $ExpectedPublisher } else { $null })
    requireValid = [bool]$RequireValid
    fileCount = $records.Count
    statusCounts = $statusCounts
    passed = $issues.Count -eq 0
    trustScope = 'Windows trust on this audit machine. A Valid result does not prove acceptance on other PCs or by their App Control policies. Use a public-trust code signing certificate and a clean Windows test machine.'
    uninstallerEvidencePresent = Test-Path -LiteralPath $uninstallerEvidence -PathType Leaf
    files = @($records.ToArray())
    issues = @($issues.ToArray())
}
$json = $report | ConvertTo-Json -Depth 8
if ($ReportPath) {
    $absoluteReport = [System.IO.Path]::GetFullPath($ReportPath)
    $reportDirectory = [System.IO.Path]::GetDirectoryName($absoluteReport)
    [System.IO.Directory]::CreateDirectory($reportDirectory) | Out-Null
    [System.IO.File]::WriteAllText($absoluteReport, $json + [Environment]::NewLine,
        (New-Object System.Text.UTF8Encoding($false)))
    Write-Output ("Audited {0} binaries; {1} issue(s)." -f $records.Count, $issues.Count)
} else {
    Write-Output $json
}
if ($RequireValid -and $issues.Count -gt 0) {
    Write-Error -Message 'Official release rejected: the Authenticode audit failed. See the signature report.' -ErrorAction Continue
    exit 1
}
