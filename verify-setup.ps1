# Windows Setup Verification Script for Payment Gateway
# This script verifies that all prerequisites are installed correctly

Write-Host "========================================"
Write-Host "Payment Gateway - Setup Verification"
Write-Host "========================================"
Write-Host ""

$allGood = $true

# Check Node.js
Write-Host "[1/5] Checking Node.js installation..." -ForegroundColor Cyan
try {
    $nodeVersion = node --version 2>$null
    if ($nodeVersion) {
        Write-Host "  [OK] Node.js is installed: $nodeVersion" -ForegroundColor Green
    } else {
        throw "Not found"
    }
} catch {
    Write-Host "  [FAIL] Node.js is not installed or not in PATH" -ForegroundColor Red
    Write-Host "         Download from: https://nodejs.org/" -ForegroundColor Yellow
    $allGood = $false
}
Write-Host ""

# Check npm
Write-Host "[2/5] Checking npm installation..." -ForegroundColor Cyan
try {
    $npmVersion = npm --version 2>$null
    if ($npmVersion) {
        Write-Host "  [OK] npm is installed: $npmVersion" -ForegroundColor Green
    } else {
        throw "Not found"
    }
} catch {
    Write-Host "  [FAIL] npm is not installed or not in PATH" -ForegroundColor Red
    $allGood = $false
}
Write-Host ""

# Check PostgreSQL
Write-Host "[3/5] Checking PostgreSQL installation..." -ForegroundColor Cyan
try {
    $psqlVersion = psql --version 2>$null
    if ($psqlVersion) {
        Write-Host "  [OK] PostgreSQL is installed: $psqlVersion" -ForegroundColor Green
    } else {
        throw "Not found"
    }
} catch {
    Write-Host "  [WARN] PostgreSQL psql command not found in PATH" -ForegroundColor Yellow
    Write-Host "         This is optional if using a remote database" -ForegroundColor Gray
    Write-Host "         If you installed PostgreSQL, add it to PATH:" -ForegroundColor Gray
    Write-Host "         Usually: C:\Program Files\PostgreSQL\14\bin" -ForegroundColor Gray
}
Write-Host ""

# Check Redis/Memurai
Write-Host "[4/5] Checking Redis/Memurai installation..." -ForegroundColor Cyan
$redisFound = $false
try {
    $memuraiPing = memurai-cli ping 2>$null
    if ($memuraiPing -eq "PONG") {
        Write-Host "  [OK] Memurai is installed and running" -ForegroundColor Green
        $redisFound = $true
    } elseif ($LASTEXITCODE -eq 0 -or $memuraiPing) {
        Write-Host "  [WARN] Memurai is installed but may not be running" -ForegroundColor Yellow
        $redisFound = $true
    }
} catch {}

if (-not $redisFound) {
    try {
        $redisPing = redis-cli ping 2>$null
        if ($redisPing -eq "PONG") {
            Write-Host "  [OK] Redis is installed and running" -ForegroundColor Green
            $redisFound = $true
        } elseif ($LASTEXITCODE -eq 0 -or $redisPing) {
            Write-Host "  [WARN] Redis is installed but may not be running" -ForegroundColor Yellow
            $redisFound = $true
        }
    } catch {}
}

if (-not $redisFound) {
    Write-Host "  [WARN] Redis/Memurai CLI not found" -ForegroundColor Yellow
    Write-Host "         Option 1: Install Memurai from https://www.memurai.com/" -ForegroundColor Gray
    Write-Host "         Option 2: Install Redis via WSL2 or Docker" -ForegroundColor Gray
}
Write-Host ""

# Check for .env file
Write-Host "[5/5] Checking configuration..." -ForegroundColor Cyan
if (Test-Path ".env") {
    Write-Host "  [OK] .env file exists" -ForegroundColor Green
} else {
    Write-Host "  [WARN] .env file not found" -ForegroundColor Yellow
    Write-Host "         Copy .env.example to .env and configure it" -ForegroundColor Gray
    Write-Host "         Run: Copy-Item .env.example .env" -ForegroundColor Gray
}
Write-Host ""

# Check for node_modules
if (Test-Path "node_modules") {
    Write-Host "  [OK] Dependencies are installed" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Dependencies not installed" -ForegroundColor Yellow
    Write-Host "         Run: npm install" -ForegroundColor Gray
}
Write-Host ""

Write-Host "========================================"
Write-Host "Verification Complete!"
Write-Host "========================================"
Write-Host ""

if ($allGood) {
    Write-Host "All critical prerequisites are installed!" -ForegroundColor Green
} else {
    Write-Host "Some prerequisites are missing. Please install them." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "1. If any [FAIL] messages appear, install the missing prerequisites"
Write-Host "2. If .env file is missing, run: Copy-Item .env.example .env"
Write-Host "3. Edit .env file with your configuration (database password, etc.)"
Write-Host "4. If dependencies are missing, run: npm install"
Write-Host "5. Start the server with: npm run dev"
Write-Host ""
Write-Host "For detailed instructions, see: docs\WINDOWS_SETUP.md" -ForegroundColor Gray
Write-Host ""
