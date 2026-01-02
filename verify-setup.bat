@echo off
REM Windows Setup Verification Script for Payment Gateway
REM This script verifies that all prerequisites are installed correctly

echo ========================================
echo Payment Gateway - Setup Verification
echo ========================================
echo.

REM Check Node.js
echo [1/4] Checking Node.js installation...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [FAIL] Node.js is not installed or not in PATH
    echo        Download from: https://nodejs.org/
) else (
    node --version
    echo [OK] Node.js is installed
)
echo.

REM Check npm
echo [2/4] Checking npm installation...
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [FAIL] npm is not installed or not in PATH
) else (
    npm --version
    echo [OK] npm is installed
)
echo.

REM Check PostgreSQL
echo [3/4] Checking PostgreSQL installation...
where psql >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARN] PostgreSQL psql command not found in PATH
    echo        This is optional if using a remote database
    echo        If you installed PostgreSQL, add it to PATH:
    echo        Usually: C:\Program Files\PostgreSQL\14\bin
) else (
    psql --version
    echo [OK] PostgreSQL is installed
)
echo.

REM Check Redis/Memurai
echo [4/4] Checking Redis/Memurai installation...
where memurai-cli >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    where redis-cli >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo [WARN] Redis/Memurai CLI not found
        echo        For Redis: Install via WSL2 or Docker
        echo        For Memurai: Download from https://www.memurai.com/
    ) else (
        redis-cli --version
        echo [OK] Redis CLI is installed
    )
) else (
    memurai-cli --version
    echo [OK] Memurai CLI is installed
)
echo.

REM Check for .env file
echo [5/5] Checking configuration...
if exist .env (
    echo [OK] .env file exists
) else (
    echo [WARN] .env file not found
    echo        Copy .env.example to .env and configure it
    echo        Run: copy .env.example .env
)
echo.

REM Check for node_modules
if exist node_modules (
    echo [OK] Dependencies are installed
) else (
    echo [WARN] Dependencies not installed
    echo        Run: npm install
)
echo.

echo ========================================
echo Verification Complete!
echo ========================================
echo.
echo Next Steps:
echo 1. If any [FAIL] messages appear, install the missing prerequisites
echo 2. If .env file is missing, run: copy .env.example .env
echo 3. If dependencies are missing, run: npm install
echo 4. Start the server with: npm run dev
echo.
echo For detailed instructions, see: docs\WINDOWS_SETUP.md
echo.
pause
