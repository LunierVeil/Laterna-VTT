@echo off
rem Laterna VTT: zapusk dlya Windows. Menyu - v laterna.ps1.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0laterna.ps1"
pause
