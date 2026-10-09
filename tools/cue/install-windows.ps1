# Reuse Manus's signed Microsoft Store package installer with Cue's identity.
[CmdletBinding()]
param()
& (Join-Path $PSScriptRoot '..\manus\install-windows.ps1') -Tool cue
