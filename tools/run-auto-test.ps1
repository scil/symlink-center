param(
  [switch]$KeepRuntime
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "== $Message =="
}

function Add-ReportItem([System.Collections.Generic.List[string]]$List, [string]$Kind, [string]$Path) {
  $List.Add("$Kind`t$Path")
}

function Assert-InRuntime([string]$RuntimeRoot, [string]$Path) {
  $runtimeFull = [System.IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\')
  $pathFull = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
  if (-not ($pathFull.Equals($runtimeFull, [System.StringComparison]::OrdinalIgnoreCase) -or $pathFull.StartsWith("$runtimeFull\", [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "Refusing to touch path outside auto-test runtime: $pathFull"
  }
}

function New-TestDirectory([string]$Path, [System.Collections.Generic.List[string]]$Created) {
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  Add-ReportItem $Created "directory" $Path
}

function New-TestFile([string]$Path, [string]$Content, [System.Collections.Generic.List[string]]$Created) {
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Set-Content -LiteralPath $Path -Value $Content -NoNewline
  Add-ReportItem $Created "file" $Path
}

function New-TestSymlink([string]$LinkPath, [string]$TargetPath, [System.Collections.Generic.List[string]]$Created) {
  if (Test-Path -LiteralPath $LinkPath) {
    throw "Target link path already exists: $LinkPath"
  }
  try {
    New-Item -ItemType SymbolicLink -Path $LinkPath -Target $TargetPath | Out-Null
    Add-ReportItem $Created "symlink" "$LinkPath -> $TargetPath"
  } catch {
    if (-not (Test-Path -LiteralPath $TargetPath -PathType Container)) {
      throw
    }
    $parent = Split-Path -Parent $LinkPath
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $output = cmd /c mklink /J "$LinkPath" "$TargetPath" 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to create SymbolicLink and junction fallback. SymbolicLink error: $($_.Exception.Message). Junction output: $output"
    }
    Add-ReportItem $Created "junction-fallback" "$LinkPath -> $TargetPath"
  }
}

function Remove-TestSymlink([string]$Path, [System.Collections.Generic.List[string]]$Deleted) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  $item = Get-Item -LiteralPath $Path -Force
  if (-not ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    throw "Refusing to delete non-symlink path: $Path"
  }
  if ($item.PSIsContainer) {
    $output = cmd /c rmdir "$Path" 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to remove reparse directory: $Path. Output: $output"
    }
  } else {
    Remove-Item -LiteralPath $Path -Force
  }
  Add-ReportItem $Deleted "symlink" $Path
}

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$runtimeRoot = Join-Path $projectRoot "data\auto-test-runtime"
$repoRoot = Join-Path $runtimeRoot "repo"
$targetRoot = Join-Path $runtimeRoot "target"
$created = [System.Collections.Generic.List[string]]::new()
$deleted = [System.Collections.Generic.List[string]]::new()
$preDeleted = [System.Collections.Generic.List[string]]::new()
$symlinks = @(
  (Join-Path $targetRoot "root-target\tool-a"),
  (Join-Path $targetRoot "root-target\tool-b"),
  (Join-Path $targetRoot "direct-link"),
  (Join-Path $targetRoot "free-link")
)

try {
  Write-Step "Prepare auto-test runtime"
  Assert-InRuntime $runtimeRoot $runtimeRoot
  if (Test-Path -LiteralPath $runtimeRoot) {
    foreach ($link in $symlinks) {
      Assert-InRuntime $runtimeRoot $link
      Remove-TestSymlink $link $preDeleted
    }
    Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
    Add-ReportItem $preDeleted "runtime-cleanup" $runtimeRoot
  }

  New-TestDirectory (Join-Path $repoRoot "root-children\tool-a") $created
  New-TestDirectory (Join-Path $repoRoot "root-children\tool-b") $created
  New-TestDirectory (Join-Path $repoRoot "root-children\ignored-child") $created
  New-TestDirectory (Join-Path $repoRoot "direct-source") $created
  New-TestDirectory (Join-Path $repoRoot "free-source") $created
  New-TestDirectory (Join-Path $targetRoot "root-target") $created
  New-TestFile (Join-Path $repoRoot "root-children\tool-a\config.txt") "tool-a config" $created
  New-TestFile (Join-Path $repoRoot "root-children\tool-b\settings.json") "{ `"tool`": `"b`" }" $created
  New-TestFile (Join-Path $repoRoot "direct-source\direct.txt") "direct source" $created
  New-TestFile (Join-Path $repoRoot "free-source\free.txt") "free source" $created

  Write-Step "Create symlinks"
  New-TestSymlink (Join-Path $targetRoot "root-target\tool-a") (Join-Path $repoRoot "root-children\tool-a") $created
  New-TestSymlink (Join-Path $targetRoot "root-target\tool-b") (Join-Path $repoRoot "root-children\tool-b") $created
  New-TestSymlink (Join-Path $targetRoot "direct-link") (Join-Path $repoRoot "direct-source") $created
  New-TestSymlink (Join-Path $targetRoot "free-link") (Join-Path $repoRoot "free-source") $created

  Write-Step "Verify symlinks"
  foreach ($link in $symlinks) {
    $item = Get-Item -LiteralPath $link -Force
    if (-not ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
      throw "Expected symlink was not created: $link"
    }
    Write-Host "verified`t$link"
  }
}
finally {
  Write-Step "Cleanup symlinks created during test"
  foreach ($link in $symlinks) {
    Assert-InRuntime $runtimeRoot $link
    Remove-TestSymlink $link $deleted
  }

  if (-not $KeepRuntime -and (Test-Path -LiteralPath $runtimeRoot)) {
    Assert-InRuntime $runtimeRoot $runtimeRoot
    Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
    Add-ReportItem $deleted "runtime-cleanup" $runtimeRoot
  }

  Write-Step "Created during test"
  if ($created.Count -eq 0) {
    Write-Host "(none)"
  } else {
    $created | ForEach-Object { Write-Host $_ }
  }

  Write-Step "Deleted before test (old leftovers)"
  if ($preDeleted.Count -eq 0) {
    Write-Host "(none)"
  } else {
    $preDeleted | ForEach-Object { Write-Host $_ }
  }

  Write-Step "Deleted during cleanup"
  if ($deleted.Count -eq 0) {
    Write-Host "(none)"
  } else {
    $deleted | ForEach-Object { Write-Host $_ }
  }
}
