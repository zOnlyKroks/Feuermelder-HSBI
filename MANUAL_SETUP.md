# Feuermelder - Manual Setup Guide

This guide explains how to run the Feuermelder system manually without Docker.

## Prerequisites

### 1. Mosquitto MQTT Broker
- **Ubuntu/Debian**: `sudo apt-get install mosquitto mosquitto-clients`
- **macOS**: `brew install mosquitto`
- **Windows**: Download from https://mosquitto.org/download/

### 2. Node.js
- Download from: https://nodejs.org/ (v14 or higher)
- Or use package manager: `apt install nodejs npm` / `brew install node`

### 3. PlatformIO (for ESP32 programming)
- Already installed if you're using CLion

## Quick Start

### Step 1: Start the MQTT Broker

Open a terminal and run:

```bash
./start-mosquitto.sh
```

This will start the Mosquitto MQTT broker on port 1883.

**Windows Users**: If the script doesn't run, use Git Bash or WSL, or run:
```bash
bash start-mosquitto.sh
```

### Step 2: Start the Web Server

Open a **new terminal** (keep the first one running) and run:

```bash
./start-website.sh
```

This will:
- Install npm dependencies (first time only)
- Start the web server on http://localhost:3000
- Connect to the MQTT broker

### Step 3: Upload Code to ESP32

1. Open your ESP32 in PlatformIO
2. Make sure the WiFi and MQTT settings in `src/main.cpp` are correct:
   - WiFi SSID/Password
   - MQTT Server IP (should be your computer's local IP, not "localhost")
3. Upload the code to ESP32

### Step 4: Monitor ESP32 (Optional)

Open a **third terminal** to see real-time MQTT messages:

```bash
./monitor-esp32.sh
```

This will display all sensor data being published by the ESP32.

You can also monitor the ESP32 serial output:
```bash
pio device monitor
```

## Access the Web Interface

Open your browser and navigate to:
```
http://localhost:3000
```

You should see the sensor dashboard with real-time data from your ESP32.

## Configuration

### MQTT Broker Address

The ESP32 needs to connect to your computer's IP address, not "localhost".

**Find your IP address:**
- **Linux/Mac**: `ifconfig` or `ip addr show`
- **Windows**: `ipconfig`

Update `src/main.cpp` line 12:
```cpp
const char* MQTT_SERVER = "192.168.178.49";  // Change to your computer's IP
```

### Environment Variables

You can customize the MQTT connection by setting environment variables before running the scripts:

```bash
export MQTT_BROKER="192.168.1.100"
export MQTT_PORT="1883"
export MQTT_USER="root"
export MQTT_PASSWORD="0811"
```

## Troubleshooting

### ESP32 Can't Connect to MQTT

1. **Check IP address**: Make sure `MQTT_SERVER` in `main.cpp` is your computer's local IP
2. **Check firewall**: Allow port 1883 through your firewall
3. **Check serial output**: Use `pio device monitor` to see connection errors
4. **Verify broker is running**: Run `./monitor-esp32.sh` to check if the broker is accessible

### Web Server Can't Connect to MQTT

1. Make sure Mosquitto is running (`./start-mosquitto.sh`)
2. Check the web server console output for errors
3. Verify MQTT_BROKER environment variable is set correctly

### No Data on Website

1. Check that ESP32 serial output shows "MQTT connected successfully!"
2. Run `./monitor-esp32.sh` to verify MQTT messages are being published
3. Check browser console (F12) for WebSocket errors

### Port Already in Use

If port 1883 or 3000 is already in use:

**For MQTT (1883)**:
- Stop other Mosquitto instances
- Change port in `start-mosquitto.sh` and update ESP32 code

**For Web Server (3000)**:
- Edit `docker/web/src/server.js` line 7 to use a different port
- Update browser URL accordingly

## Stopping the Services

Press `Ctrl+C` in each terminal window to stop the services.

## Running in Background (Linux/Mac)

To run services in the background:

```bash
# Start Mosquitto in background
nohup ./start-mosquitto.sh > mosquitto.log 2>&1 &

# Start Web Server in background
nohup ./start-website.sh > webapp.log 2>&1 &

# View logs
tail -f mosquitto.log
tail -f webapp.log

# Stop processes
pkill -f mosquitto
pkill -f "node src/server.js"
```

## Benefits of Manual Setup Over Docker

1. **Better control**: Direct access to logs and processes
2. **Easier debugging**: See exactly what's happening
3. **No container overhead**: Native performance
4. **Simpler networking**: No Docker network translation issues
5. **Persistent connections**: Services stay connected reliably

## Next Steps

- Monitor ESP32 serial output for debugging
- Adjust sensor polling rate via the web interface
- Enable/disable individual sensors
- Check MQTT messages with `./monitor-esp32.sh`
