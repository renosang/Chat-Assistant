
@echo off
setlocal enabledelayedexpansion
title Onpoint Gemini Auto-Updater

:: CẤU HÌNH: Thay link này bằng link GitHub chứa file raw của bạn
set "BASE_URL=https://raw.githubusercontent.com/USER_CUA_BAN/REPO_CUA_BAN/main"

echo [1/3] Dang kiem tra ket noi den Server cap nhat...
powershell -Command "try { Invoke-WebRequest -Uri '%BASE_URL%/manifest.json' -Method Head; exit 0 } catch { exit 1 }"
if %ERRORLEVEL% NEQ 0 (
    echo [LOI] Khong the ket noi den Server. Vui long kiem tra mang!
    pause
    exit
)

echo [2/3] Dang tai tung file va ghi de...

:: Liet ke cac file quan trong can cap nhat o day
set "FILES=manifest.json background.js content.js styles.css popup.js popup.html index.html"

for %%f in (%FILES%) do (
    echo    - Dang tai: %%f...
    powershell -Command "Invoke-WebRequest -Uri '%BASE_URL%/%%f' -OutFile '%%f.tmp'"
    if exist "%%f.tmp" (
        move /y "%%f.tmp" "%%f" >nul
    ) else (
        echo    [LOI] Khong the tai file %%f
    )
)

echo [3/3] Dang lam moi Extension...
:: Script nay se thong bao cho Chrome biet file da doi
echo Cap nhat hoan tat! 
echo.
echo QUAN TRONG: 
echo 1. Quay lai Chrome.
echo 2. Truy cap chrome://extensions
echo 3. Bam nut 'Reload' (bieu tuong xoay) o Extension Onpoint.
echo.
pause
