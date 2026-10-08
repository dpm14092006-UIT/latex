@echo off
cd /d "%~dp0"
node "%~dp0scripts\run-desktop.mjs"
if errorlevel 1 pause
