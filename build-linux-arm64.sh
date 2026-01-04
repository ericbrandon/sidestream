#!/bin/bash
# Build script for Sidestream on ARM64 Linux (Ubuntu)
# Run this script in the project directory

set -e  # Exit on error

echo "=== Installing system dependencies ==="
sudo apt update
sudo apt install -y \
    libwebkit2gtk-4.1-dev \
    librsvg2-dev \
    patchelf \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    curl \
    build-essential \
    pkg-config \
    libssl-dev

echo "=== Installing Node.js 20 ==="
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "Node.js already installed: $(node --version)"
fi

echo "=== Installing Rust ==="
if ! command -v cargo &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source ~/.cargo/env
else
    echo "Rust already installed: $(cargo --version)"
fi

# Ensure cargo is in PATH
source ~/.cargo/env 2>/dev/null || true

echo "=== Installing npm dependencies ==="
npm install

echo "=== Building Tauri app ==="
npm run tauri build

echo ""
echo "=== Build complete! ==="
echo "Your .deb file is at:"
ls -la src-tauri/target/release/bundle/deb/*.deb
echo ""
echo "Install with: sudo dpkg -i src-tauri/target/release/bundle/deb/*.deb"
