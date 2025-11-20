#!/bin/bash
# Build script for ESP32 firmware
# Generates config and builds with PlatformIO

set -e

echo "=========================================="
echo "  Feuermelder - ESP32 Build Script"
echo "=========================================="
echo ""

# Check if PlatformIO is installed
if ! command -v pio &> /dev/null && ! command -v platformio &> /dev/null; then
    echo "ERROR: PlatformIO is not installed!"
    echo "Please install PlatformIO: https://platformio.org/install"
    echo ""
    exit 1
fi

# Generate config
echo "Generating configuration..."
./generate_config.sh
echo ""

# Build firmware
echo "Building ESP32 firmware..."
pio run

echo ""
echo "=========================================="
echo "  Build Complete!"
echo "=========================================="
echo ""
echo "To upload to ESP32, run:"
echo "  pio run --target upload"
echo ""