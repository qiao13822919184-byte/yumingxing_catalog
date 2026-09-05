@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish-pages.ps1"
if errorlevel 1 (
  echo Publishing stopped. Read the message above before trying again.
)
pause
