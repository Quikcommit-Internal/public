#!/bin/bash
# QuikCommit SaaS CLI install script
# Usage: curl -fsSL https://quikcommit.dev/install | sh

set -e

# Detect platform
OS="unknown"
case "$(uname)" in
    "Darwin") OS="macos" ;;
    "Linux")  OS="linux" ;;
    "MINGW"*|"MSYS"*|"CYGWIN"*) OS="windows" ;;
esac

# Don't run as root on Unix
if [ "$OS" != "windows" ] && [ "$EUID" -eq 0 ]; then
    echo "Please do not run this script with sudo. Run as a regular user."
    exit 1
fi

# Check for bun or node
if command -v bun >/dev/null 2>&1; then
    echo "Installing QuikCommit via npm (using bun)..."
    npm install -g @quikcommit/cli
elif command -v node >/dev/null 2>&1; then
    echo "Installing QuikCommit via npm..."
    npm install -g @quikcommit/cli
else
    echo "Error: Neither bun nor node found. Please install Node.js (https://nodejs.org) or Bun (https://bun.sh) first."
    echo "Alternatively, download a pre-built binary from: https://github.com/Quikcommit-Internal/public/releases"
    exit 1
fi

# Verify installation
if command -v qc >/dev/null 2>&1; then
    echo ""
    echo "Installation complete!"
    echo "Run 'qc login' to get started."
    echo ""
    qc --help 2>/dev/null || true
else
    echo "Installation may have completed, but 'qc' was not found in PATH."
    echo "Ensure your npm global bin directory is in your PATH."
    echo "Run 'qc login' to get started once qc is available."
fi
