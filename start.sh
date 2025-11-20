#!/bin/bash
# Feuermelder - Start All Services

set -e

echo "=========================================="
echo "  Feuermelder - Fire Detection System"
echo "=========================================="
echo ""

# Load configuration
if [ ! -f "config.env" ]; then
    echo "ERROR: config.env not found!"
    echo "Please create config.env from the template"
    exit 1
fi

source config.env

# Generate config.h for ESP32
echo "Generating ESP32 configuration..."
./generate_config.sh
echo ""

# Kill any existing Mosquitto processes
pkill -f mosquitto 2>/dev/null || true
sleep 1

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed!"
    echo "Please install Node.js from: https://nodejs.org/"
    echo ""
    exit 1
fi

# Check if Mosquitto is installed
if ! command -v mosquitto &> /dev/null; then
    echo "ERROR: Mosquitto is not installed!"
    echo "Please install Mosquitto with: brew install mosquitto"
    echo ""
    exit 1
fi

# Setup cleanup trap
cleanup() {
    echo ""
    echo "Stopping services..."
    pkill -f mosquitto 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# Detect MQTT broker IP
if [ -z "$MQTT_BROKER_IP" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        MQTT_BROKER_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")
    else
        MQTT_BROKER_IP=$(hostname -I | awk '{print $1}' || echo "localhost")
    fi
fi

# Start Mosquitto in background
echo "Starting Mosquitto MQTT Broker..."
mosquitto -c mqtt/config/mosquitto.conf &
MOSQUITTO_PID=$!

# Wait for Mosquitto to start
sleep 3

# Install web dependencies if needed
if [ ! -d "web/node_modules" ]; then
    echo "Installing web dependencies..."
    cd web
    npm install
    cd ..
    echo ""
fi

# HTTPS Setup
if [ ! -f "web/certs/cert.pem" ] || [ ! -f "web/certs/key.pem" ]; then
    echo "=========================================="
    echo "  HTTPS Certificate Setup"
    echo "=========================================="
    echo ""
    echo "No SSL certificates found. Would you like to:"
    echo "1) Generate self-signed certificate (local/testing)"
    echo "2) Skip and use HTTP only"
    echo ""
    read -p "Enter choice [1-2] (default: 2): " https_choice
    https_choice=${https_choice:-2}

    if [ "$https_choice" = "1" ]; then
        echo "Generating self-signed certificate..."
        mkdir -p web/certs

        if command -v openssl &> /dev/null; then
            openssl req -x509 -newkey rsa:2048 -nodes \
                -keyout web/certs/key.pem \
                -out web/certs/cert.pem \
                -days 365 \
                -subj "/C=DE/ST=NRW/L=Bielefeld/O=Feuermelder/CN=localhost" 2>/dev/null

            if [ $? -eq 0 ]; then
                echo "✓ Self-signed certificate generated"
                export ENABLE_HTTPS=true
                export CERT_PATH="$(pwd)/web/certs/cert.pem"
                export KEY_PATH="$(pwd)/web/certs/key.pem"
            else
                echo "✗ Failed to generate certificate, using HTTP"
                export ENABLE_HTTPS=false
            fi
        else
            echo "✗ OpenSSL not found, using HTTP"
            export ENABLE_HTTPS=false
        fi
        echo ""
    else
        echo "Using HTTP only"
        export ENABLE_HTTPS=false
        echo ""
    fi
else
    # Certificates exist, enable HTTPS
    export ENABLE_HTTPS=true
    export CERT_PATH="$(pwd)/web/certs/cert.pem"
    export KEY_PATH="$(pwd)/web/certs/key.pem"
fi

echo ""
echo "=========================================="
echo "  Services Started!"
echo "=========================================="
echo "  - MQTT Broker: ${MQTT_BROKER_IP}:${MQTT_PORT}"
if [ "$ENABLE_HTTPS" = "true" ]; then
    echo "  - Web Server: https://localhost:${WEB_SERVER_PORT:-3000}"
    echo ""
    echo "  ⚠️  Self-signed certificate warning is normal"
    echo "  ⚠️  Click 'Advanced' → 'Proceed to localhost' in browser"
else
    echo "  - Web Server: http://localhost:${WEB_SERVER_PORT:-3000}"
fi
echo ""
echo "  Configure ESP32 to connect to: ${MQTT_BROKER_IP}:${MQTT_PORT}"
echo "  (Config will be embedded during PlatformIO build)"
echo ""
echo "  Press Ctrl+C to stop all services"
echo "=========================================="
echo ""

# Export environment variables for web server
export MQTT_BROKER="$MQTT_BROKER_IP"
export MQTT_PORT="$MQTT_PORT"
export MQTT_USER="$MQTT_USER"
export MQTT_PASSWORD="$MQTT_PASSWORD"
export PORT="${WEB_SERVER_PORT:-3000}"

# Start the web server (foreground)
cd web
node src/server.js

# Cleanup on normal exit
cleanup