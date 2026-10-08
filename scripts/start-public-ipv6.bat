@echo off
rem Stronghold Protocol - public IPv6 launcher. ASCII only on purpose: CMD parses
rem batch lines under the ACTIVE codepage, so UTF-8 Chinese would be misread as
rem commands on a GBK console. All Chinese text lives in scripts\public-ipv6.ps1,
rem which sets its own UTF-8 output encoding. Docs: docs\IPV6.md
rem
rem Double-click  -> menu.
rem With an option -> runs it directly and pauses so the result can be read:
rem   start-public-ipv6.bat serve | join <addr> | fw | install | diag
title Stronghold Protocol - Public IPv6
chcp 65001 >nul

cd /d "%~dp0.."
set "PSScript=%~dp0public-ipv6.ps1"
set "RC=0"

if not exist "%PSScript%" (
  echo.
  echo [ERROR] Missing: %PSScript%
  echo.
  pause
  exit /b 1
)

rem No argument: the interactive menu, rendered entirely by PowerShell
rem (it owns the Chinese text and the console encoding).
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PSScript%" -Menu
  exit /b %errorlevel%
)

set "ACTION=%~1"
if /i "%~1"=="join" set "ACTION=join %~2"

if /i "%~1"=="serve"   powershell -NoProfile -ExecutionPolicy Bypass -File "%PSScript%" -Serve && set "RC=%errorlevel%" && goto :done
if /i "%~1"=="join"    powershell -NoProfile -ExecutionPolicy Bypass -File "%PSScript%" -Join "%~2" && set "RC=%errorlevel%" && goto :done
if /i "%~1"=="fw"      powershell -NoProfile -ExecutionPolicy Bypass -File "%PSScript%" -Firewall && set "RC=%errorlevel%" && goto :done
if /i "%~1"=="install" powershell -NoProfile -ExecutionPolicy Bypass -File "%PSScript%" -Install && set "RC=%errorlevel%" && goto :done
if /i "%~1"=="diag"    powershell -NoProfile -ExecutionPolicy Bypass -File "%PSScript%" -Serve -NoStart && set "RC=%errorlevel%" && goto :done

if /i not "%~1"=="serve" if /i not "%~1"=="fw" if /i not "%~1"=="install" if /i not "%~1"=="diag" (
  echo.
  echo [ERROR] Unknown option: %~1
  echo   Usage: start-public-ipv6.bat [serve ^| join ^<addr^> ^| fw ^| install ^| diag]
  echo   With no option, a menu is shown.
  echo.
  pause
  exit /b 2
)

:done
echo.
pause
exit /b %RC%
