# Windows 11 Setup Guide - Payment Gateway Fintech Solution

This guide provides step-by-step instructions to setup and run the Payment Gateway fintech solution on Windows 11.

## 📋 Table of Contents

1. [Prerequisites Installation](#prerequisites-installation)
2. [Repository Setup](#repository-setup)
3. [Configuration](#configuration)
4. [Running the Application](#running-the-application)
5. [Verification](#verification)
6. [Troubleshooting](#troubleshooting)
7. [Next Steps](#next-steps)

---

## 🔧 Prerequisites Installation

### Step 1: Install Node.js

1. **Download Node.js**
   - Visit [https://nodejs.org/](https://nodejs.org/)
   - Download the LTS (Long Term Support) version for Windows (18.x or higher)
   - The installer is typically named `node-v18.x.x-x64.msi`

2. **Run the Installer**
   - Double-click the downloaded `.msi` file
   - Follow the installation wizard
   - **Important**: Make sure to check "Automatically install the necessary tools" option
   - Accept the license agreement
   - Keep the default installation path (usually `C:\Program Files\nodejs\`)
   - Click "Next" and then "Install"

3. **Verify Installation**
   - Open **Command Prompt** (Press `Win + R`, type `cmd`, press Enter)
   - Run the following commands:
     ```cmd
     node --version
     npm --version
     ```
   - You should see version numbers (e.g., `v18.19.0` and `10.2.3`)

### Step 2: Install PostgreSQL

1. **Download PostgreSQL**
   - Visit [https://www.postgresql.org/download/windows/](https://www.postgresql.org/download/windows/)
   - Click on "Download the installer" from EDB
   - Download PostgreSQL 14 or higher (64-bit)

2. **Run the Installer**
   - Double-click the downloaded `.exe` file
   - Click "Next" through the setup wizard
   - Keep the default installation directory
   - Select components: PostgreSQL Server, pgAdmin 4, Command Line Tools
   - Use default data directory
   - **Set a password** for the database superuser (postgres) - **Remember this password!**
   - Use default port: **5432**
   - Use default locale
   - Complete the installation

3. **Verify Installation**
   - Open **Command Prompt**
   - Run:
     ```cmd
     psql --version
     ```
   - You should see the PostgreSQL version

4. **Create Database**
   - Open **pgAdmin 4** from Start Menu
   - Expand "Servers" → Right-click "PostgreSQL 14" → "Connect Server"
   - Enter the password you set during installation
   - Right-click "Databases" → "Create" → "Database"
   - Database name: `payment_gateway`
   - Owner: `postgres`
   - Click "Save"

### Step 3: Install Redis

Redis doesn't have an official Windows version, but we have alternatives:

#### Option A: Using Memurai (Redis-compatible, Recommended for Windows)

1. **Download Memurai**
   - Visit [https://www.memurai.com/](https://www.memurai.com/)
   - Click "Download" and get the free developer version
   - Create a free account if required

2. **Install Memurai**
   - Run the downloaded installer
   - Follow the installation wizard
   - Keep default settings
   - Memurai runs as a Windows service on port **6379**

3. **Verify Installation**
   - Open **Command Prompt**
   - Run:
     ```cmd
     memurai-cli ping
     ```
   - You should see `PONG`

#### Option B: Using Redis on WSL2 (Windows Subsystem for Linux)

1. **Enable WSL2**
   - Open **PowerShell as Administrator**
   - Run:
     ```powershell
     wsl --install
     ```
   - Restart your computer when prompted

2. **Install Redis on WSL2**
   - Open **Ubuntu** from Start Menu (installed with WSL)
   - Run:
     ```bash
     sudo apt update
     sudo apt install redis-server
     sudo service redis-server start
     ```

3. **Verify Installation**
   ```bash
   redis-cli ping
   ```
   - You should see `PONG`

#### Option C: Using Docker Desktop (Alternative)

If you prefer Docker:
1. Install Docker Desktop for Windows from [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
2. Run Redis container:
   ```cmd
   docker run -d -p 6379:6379 --name redis redis:7-alpine
   ```

### Step 4: Install Git (if not already installed)

1. **Download Git**
   - Visit [https://git-scm.com/download/win](https://git-scm.com/download/win)
   - Download the 64-bit version

2. **Install Git**
   - Run the installer
   - Use default settings (recommended)
   - Complete the installation

3. **Verify Installation**
   ```cmd
   git --version
   ```

---

## 📥 Repository Setup

### Step 1: Clone the Repository

1. **Open Command Prompt or PowerShell**
   - Press `Win + R`, type `cmd`, press Enter
   - Or press `Win + X`, select "Windows Terminal" or "PowerShell"

2. **Navigate to your desired directory**
   ```cmd
   cd C:\Projects
   ```
   (Create this folder if it doesn't exist: `mkdir C:\Projects`)

3. **Clone the repository**
   ```cmd
   git clone https://github.com/nitra-1/PG.git
   cd PG
   ```

### Step 2: Install Dependencies

1. **Install npm packages**
   ```cmd
   npm install
   ```
   
   This will install all required dependencies including:
   - Express (web framework)
   - PostgreSQL client
   - Redis client
   - Security packages
   - Payment gateway integrations
   - And more...

2. **Wait for completion**
   - The installation may take 2-5 minutes depending on your internet connection
   - You should see "added XXX packages" message when complete

### Step 3: Verify Setup (Optional but Recommended)

Run the verification script to check if all prerequisites are installed correctly:

**Using PowerShell (Recommended):**
```powershell
.\verify-setup.ps1
```

**Using Command Prompt:**
```cmd
verify-setup.bat
```

The script will check:
- ✅ Node.js installation
- ✅ npm installation
- ✅ PostgreSQL installation
- ✅ Redis/Memurai installation
- ✅ Configuration file (.env)
- ✅ Dependencies (node_modules)

---

## ⚙️ Configuration

### Step 1: Create Environment File

1. **Copy the example environment file**
   ```cmd
   copy .env.example .env
   ```

2. **Edit the .env file**
   - Open `.env` file in a text editor (Notepad, VS Code, etc.)
   - You can use:
     ```cmd
     notepad .env
     ```
   
### Step 2: Configure Basic Settings

Edit the `.env` file with your settings:

```env
# Server Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=payment_gateway
DB_USER=postgres
DB_PASSWORD=YOUR_POSTGRES_PASSWORD_HERE
DB_SSL=false
DB_POOL_SIZE=10

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Security Configuration (Generate secure random strings for production)
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
HMAC_SECRET=change-this-to-a-secure-random-string-in-production
JWT_SECRET=change-this-to-a-secure-jwt-secret-in-production
JWT_EXPIRES_IN=1h

# Payment Gateway Configuration (Use test credentials for development)
DEFAULT_GATEWAY=razorpay

# Feature Flags (Enable/disable features as needed)
FEATURE_UPI=true
FEATURE_CARDS=true
FEATURE_NETBANKING=true
FEATURE_WALLETS=true
FEATURE_BNPL=true
FEATURE_EMI=true
FEATURE_BIOMETRIC=true
FEATURE_QR=true
FEATURE_PAYOUT=true
```

**Important Notes:**
- Replace `YOUR_POSTGRES_PASSWORD_HERE` with the password you set during PostgreSQL installation
- For testing, you can leave the payment gateway credentials as is
- For production, you'll need to obtain real API keys from payment gateway providers

### Step 3: Verify Database Connection

1. **Test PostgreSQL connection**
   ```cmd
   psql -U postgres -d payment_gateway -c "SELECT version();"
   ```
   - Enter your PostgreSQL password when prompted
   - You should see the PostgreSQL version information

---

## 🚀 Running the Application

### Step 1: Start the Development Server

1. **Run the application**
   ```cmd
   npm run dev
   ```

   **Alternative (for production mode):**
   ```cmd
   npm start
   ```

2. **Wait for the server to start**
   - You should see a banner indicating the server has started
   - Look for:
     ```
     ╔═══════════════════════════════════════════════════════════╗
     ║           Payment Gateway Server Started                  ║
     ╚═══════════════════════════════════════════════════════════╝
     
     Server: http://0.0.0.0:3000
     Environment: development
     ```

### Step 2: Keep the Terminal Open

- The terminal window must remain open while the server is running
- To stop the server, press `Ctrl + C` in the terminal

---

## ✅ Verification

### Step 1: Test the Health Endpoint

1. **Open a web browser**
   - Navigate to: [http://localhost:3000/health](http://localhost:3000/health)
   - You should see a JSON response:
     ```json
     {
       "status": "healthy",
       "timestamp": "2024-01-02T15:30:00.000Z",
       "uptime": 45.123
     }
     ```

2. **Test the root endpoint**
   - Navigate to: [http://localhost:3000/](http://localhost:3000/)
   - You should see API information:
     ```json
     {
       "name": "Payment Gateway API",
       "version": "1.0.0",
       "description": "Comprehensive fintech payment gateway...",
       "documentation": "/api/docs",
       "health": "/health"
     }
     ```

### Step 2: Test with Command Line (Optional)

Using **PowerShell**:
```powershell
Invoke-WebRequest -Uri http://localhost:3000/health | Select-Object -Expand Content
```

Using **Command Prompt with curl** (if installed):
```cmd
curl http://localhost:3000/health
```

### Step 3: Test API Endpoints

You can use tools like:
- **Postman** - [Download here](https://www.postman.com/downloads/)
- **Insomnia** - [Download here](https://insomnia.rest/download)
- **Thunder Client** - VS Code extension

Example API test:
```
GET http://localhost:3000/api/payments/health
```

---

## 🐛 Troubleshooting

### Issue 1: "Node is not recognized as an internal or external command"

**Solution:**
1. Close and reopen Command Prompt
2. Check if Node.js is in PATH:
   - Open System Properties → Environment Variables
   - Look for `C:\Program Files\nodejs\` in PATH
3. Reinstall Node.js if needed

### Issue 2: PostgreSQL Connection Error

**Symptoms:** `ECONNREFUSED` or `password authentication failed`

**Solutions:**
1. **Verify PostgreSQL is running:**
   - Open Services (Press `Win + R`, type `services.msc`)
   - Find "postgresql-x64-14" service
   - Make sure it's "Running"
   - If not, right-click and select "Start"

2. **Check password:**
   - Verify the password in `.env` matches your PostgreSQL password
   - Try connecting with pgAdmin to confirm credentials

3. **Check port:**
   - Ensure PostgreSQL is running on port 5432
   - Check `.env` file has `DB_PORT=5432`

### Issue 3: Redis Connection Error

**Symptoms:** `ECONNREFUSED` on port 6379

**Solutions:**

For Memurai:
1. Open Services (Win + R → `services.msc`)
2. Find "Memurai" service
3. Make sure it's "Running"
4. If not, right-click and select "Start"

For WSL2:
1. Open Ubuntu terminal
2. Run: `sudo service redis-server start`
3. Verify: `redis-cli ping` should return `PONG`

For Docker:
1. Start Docker Desktop
2. Check container: `docker ps`
3. Start if stopped: `docker start redis`

### Issue 4: Port 3000 Already in Use

**Symptoms:** `EADDRINUSE: address already in use :::3000`

**Solutions:**
1. **Find and close the application using port 3000:**
   ```cmd
   netstat -ano | findstr :3000
   ```
   This shows the PID (Process ID)

2. **Kill the process:**
   ```cmd
   taskkill /PID <PID_NUMBER> /F
   ```
   Replace `<PID_NUMBER>` with the actual number

3. **Or change the port:**
   - Edit `.env` file
   - Change `PORT=3000` to `PORT=3001` (or any available port)
   - Restart the application

### Issue 5: npm install Fails

**Solutions:**
1. **Clear npm cache:**
   ```cmd
   npm cache clean --force
   ```

2. **Delete node_modules and reinstall:**
   ```cmd
   rmdir /s /q node_modules
   del package-lock.json
   npm install
   ```

3. **Check internet connection and proxy settings**

4. **Run as Administrator** (right-click Command Prompt → "Run as administrator")

### Issue 6: Permission Errors

**Solution:**
- Run Command Prompt or PowerShell as Administrator
- Right-click the application → "Run as administrator"

### Issue 7: Windows Firewall Blocking

**Symptoms:** Cannot access `http://localhost:3000` from browser

**Solution:**
1. Open Windows Defender Firewall
2. Click "Allow an app or feature through Windows Defender Firewall"
3. Click "Change settings" → "Allow another app"
4. Add Node.js: `C:\Program Files\nodejs\node.exe`
5. Allow for both Private and Public networks

---

## 🎯 Next Steps

### 1. Explore the Documentation

- **[Quick Start Guide](QUICK_START.md)** - Quick reference and integration examples
- **[E-commerce Integration Guide](ECOMMERCE_INTEGRATION.md)** - Complete integration tutorial
- **[API Reference](API.md)** - Detailed API documentation
- **[Security Guidelines](SECURITY.md)** - Security best practices
- **[Payment Flow Diagrams](PAYMENT_FLOW_DIAGRAMS.md)** - Visual flow diagrams

### 2. Configure Payment Gateways

For production use, you'll need to:
1. Sign up with payment gateway providers (Razorpay, PayU, CCAvenue)
2. Get API credentials
3. Update `.env` file with real credentials
4. Test with sandbox/test environment first

### 3. Test the Features

Try out different features:
- UPI payments: `/api/upi`
- Card payments: `/api/payments`
- QR code generation: `/api/qr`
- Wallet integration: `/api/wallets`
- Payout services: `/api/payout`

### 4. Set Up Development Environment

Consider using:
- **Visual Studio Code** - [Download here](https://code.visualstudio.com/)
- **Postman** - For API testing
- **Git GUI** - Like GitHub Desktop for easier Git operations

### 5. Run Tests

```cmd
npm test
```

---

## 📞 Support

If you encounter any issues:

1. **Check Existing Documentation:**
   - [Main README](../README.md)
   - [Architecture Documentation](../ARCHITECTURE.md)
   - [Contributing Guidelines](../CONTRIBUTING.md)

2. **Search for Issues:**
   - Visit: [https://github.com/nitra-1/PG/issues](https://github.com/nitra-1/PG/issues)
   - Search for similar problems

3. **Create a New Issue:**
   - Provide Windows version (Windows 11)
   - Include error messages
   - Share relevant configuration (remove sensitive data)
   - Describe steps to reproduce

4. **Contact Support:**
   - Email: support@paymentgateway.com
   - Documentation: https://docs.paymentgateway.com

---

## 🔒 Security Reminders

Before deploying to production:

- ✅ Change all default passwords and secrets
- ✅ Generate secure random strings for `ENCRYPTION_KEY`, `JWT_SECRET`, `HMAC_SECRET`
- ✅ Use environment-specific configuration files
- ✅ Enable HTTPS/TLS
- ✅ Set up proper firewall rules
- ✅ Regular security updates
- ✅ Enable database backups
- ✅ Implement proper logging and monitoring

---

## 📚 Additional Resources

### Windows-Specific Tips

1. **Use Windows Terminal** (recommended)
   - Modern terminal with tabs
   - Better than traditional Command Prompt
   - Download from Microsoft Store

2. **Use PowerShell 7+** (recommended)
   - More powerful than PowerShell 5.1
   - Better cross-platform support
   - Download from [https://aka.ms/powershell](https://aka.ms/powershell)

3. **Consider using WSL2** for development
   - More Unix-like environment
   - Better compatibility with some tools
   - Can run Linux containers

### Recommended Tools for Windows Development

- **Visual Studio Code** - Code editor
- **Git for Windows** - Version control
- **Windows Terminal** - Modern terminal
- **Postman** - API testing
- **Docker Desktop** - Containerization
- **DBeaver** - Database management (alternative to pgAdmin)

---

## 📋 Quick Command Reference

### Common npm Commands
```cmd
npm install          # Install all dependencies
npm run dev          # Start development server
npm start            # Start production server
npm test             # Run tests
npm run lint         # Run linter
```

### Database Commands
```cmd
# Connect to PostgreSQL
psql -U postgres -d payment_gateway

# Create database (if needed)
createdb -U postgres payment_gateway

# Check PostgreSQL service status
sc query postgresql-x64-14
```

### Redis/Memurai Commands
```cmd
# Test Redis/Memurai connection
memurai-cli ping
# or
redis-cli ping

# Check service status
sc query Memurai
```

### Git Commands
```cmd
git status           # Check repository status
git pull             # Update to latest code
git log              # View commit history
```

### Verification
```cmd
# Check versions
node --version
npm --version
psql --version
git --version

# Check if port is in use
netstat -ano | findstr :3000

# Run setup verification
.\verify-setup.ps1   # PowerShell
verify-setup.bat     # Command Prompt
```

---

**🎉 Congratulations!** You've successfully set up the Payment Gateway fintech solution on Windows 11!

If everything is working, you're ready to start integrating payment processing into your applications.
