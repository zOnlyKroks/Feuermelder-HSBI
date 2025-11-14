const express = require('express');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = 3000;

// MQTT Configuration
const MQTT_BROKER = process.env.MQTT_BROKER || '192.168.178.49';
const MQTT_PORT = process.env.MQTT_PORT || 1883;
const MQTT_USER = process.env.MQTT_USER || '';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';

// MQTT Topics - Updated to match ESP32 firmware
const TOPICS = {
    SENSORS: 'home/sensors/data',           // ✓ Unified topic for all sensors
    STATUS: 'home/sensors/status',          // ✓ Status topic
    CONTROL_RATE: 'home/sensors/control/rate',
    CONTROL_ENABLE: 'home/sensors/control/enable',
    CONTROL_BUZZER: 'home/sensors/control/buzzer'
};

// Store latest sensor data
let sensorData = {
    mq7: { raw: 0, voltage: 0, level: '', timestamp: null },
    flame: { raw: 0, voltage: 0, status: '', timestamp: null },
    dht22: { temperature: 0, humidity: 0, tempStatus: '', humidStatus: '', timestamp: null },
    pm25: { raw: 0, voltage: 0, dust: 0, quality: '', timestamp: null },
    se95: { temp: 0, status: '', timestamp: null },
    status: 'offline',
    lastUpdate: null,
    sensorsEnabled: {
        mq7: true,
        flame: true,
        dht: true,
        pm25: true,
        se95: true
    },
    pollingRate: 100
};

// Connect to MQTT broker
const mqttOptions = {
    clientId: 'feuermelder-webapp-' + Math.random().toString(16).substr(2, 8),
    clean: true,
    reconnectPeriod: 1000
};

// Only add credentials if they're provided
if (MQTT_USER && MQTT_USER.length > 0) {
    mqttOptions.username = MQTT_USER;
    mqttOptions.password = MQTT_PASSWORD;
}

const mqttClient = mqtt.connect(`mqtt://${MQTT_BROKER}:${MQTT_PORT}`, mqttOptions);

mqttClient.on('connect', () => {
    console.log('✓ Connected to MQTT broker');

    // Subscribe to unified sensor data topic and status
    mqttClient.subscribe(TOPICS.SENSORS, { qos: 0 }, (err) => {
        if (err) {
            console.error('✗ Failed to subscribe to sensors topic:', err);
        } else {
            console.log('✓ Subscribed to:', TOPICS.SENSORS);
        }
    });

    mqttClient.subscribe(TOPICS.STATUS, { qos: 0 }, (err) => {
        if (err) {
            console.error('✗ Failed to subscribe to status topic:', err);
        } else {
            console.log('✓ Subscribed to:', TOPICS.STATUS);
        }
    });
});

mqttClient.on('message', (topic, message) => {
    const payload = message.toString();
    const timestamp = new Date().toISOString();

    try {
        if (topic === TOPICS.SENSORS) {
            // Parse unified sensor data
            const data = JSON.parse(payload);

            // Route data based on sensor type
            switch(data.sensor) {
                case 'mq7':
                    sensorData.mq7 = {
                        raw: data.raw,
                        voltage: data.voltage,
                        level: data.level,
                        timestamp
                    };
                    break;

                case 'flame':
                    sensorData.flame = {
                        raw: data.raw,
                        voltage: data.voltage,
                        status: data.status,
                        timestamp
                    };
                    break;

                case 'dht22':
                    sensorData.dht22 = {
                        temperature: data.temp,
                        humidity: data.humidity,
                        tempStatus: data.tempStatus,
                        humidStatus: data.humidStatus,
                        timestamp
                    };
                    break;

                case 'pm25':
                    sensorData.pm25 = {
                        raw: data.raw,
                        voltage: data.voltage,
                        dust: data.dust,
                        quality: data.quality,
                        timestamp
                    };
                    break;

                case 'se95':
                    sensorData.se95 = {
                        temp: data.temp,
                        status: data.status,
                        timestamp
                    };
                    break;

                default:
                    console.warn('⚠️ Unknown sensor type:', data.sensor);
            }

            sensorData.lastUpdate = timestamp;
            sensorData.status = 'online';
            broadcastSensorData();
        } else if (topic === TOPICS.STATUS) {
            sensorData.status = payload;
            console.log('🔌 ESP32 Status:', payload);
            broadcastSensorData();
        }
    } catch (err) {
        console.error('✗ Error parsing MQTT message:', err);
        console.error('   Topic:', topic);
        console.error('   Payload:', payload);
    }
});

mqttClient.on('error', (err) => {
    console.error('✗ MQTT connection error:', err);
});

mqttClient.on('reconnect', () => {
    console.log('🔄 Reconnecting to MQTT broker...');
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// REST API Endpoints
app.get('/api/sensors', (req, res) => {
    res.json(sensorData);
});

app.post('/api/control/rate', (req, res) => {
    const { rate } = req.body;

    if (!rate || rate < 100 || rate > 60000) {
        return res.status(400).json({ error: 'Invalid rate. Must be between 100 and 60000 ms' });
    }

    sensorData.pollingRate = rate;
    mqttClient.publish(TOPICS.CONTROL_RATE, rate.toString());
    console.log(`⚡ Polling rate changed to ${rate}ms`);

    res.json({ success: true, rate });
});

app.post('/api/control/enable', (req, res) => {
    const { sensor, enabled } = req.body;

    if (!['mq7', 'flame', 'dht', 'pm25', 'se95'].includes(sensor)) {
        return res.status(400).json({ error: 'Invalid sensor name' });
    }

    sensorData.sensorsEnabled[sensor] = enabled;
    mqttClient.publish(TOPICS.CONTROL_ENABLE, JSON.stringify({ sensor, enabled }));

    res.json({ success: true, sensor, enabled });
});

app.post('/api/control/buzzer', (req, res) => {
    const { command } = req.body;

    if (!['alarm', 'warning', 'test', 'off'].includes(command)) {
        return res.status(400).json({ error: 'Invalid command. Use: alarm, warning, test, or off' });
    }

    mqttClient.publish(TOPICS.CONTROL_BUZZER, command);
    console.log(`🔊 Buzzer command sent: ${command}`);

    res.json({ success: true, command });
});

// Start HTTP server
const server = app.listen(PORT, () => {
    console.log('\n=== Feuermelder Web Application ===');
    console.log(`🌐 Web server: http://localhost:${PORT}`);
    console.log(`📡 MQTT Broker: ${MQTT_BROKER}:${MQTT_PORT}`);
    console.log('================================\n');
});

// WebSocket server for real-time updates
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('✓ New WebSocket client connected');

    // Send current data immediately
    ws.send(JSON.stringify(sensorData));

    ws.on('close', () => {
        console.log('✗ WebSocket client disconnected');
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

function broadcastSensorData() {
    const message = JSON.stringify(sensorData);
    let sentCount = 0;

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
            sentCount++;
        }
    });

    if (sentCount > 0) {
        // console.log(`📤 Broadcast to ${sentCount} client(s)`);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    mqttClient.end();
    server.close(() => {
        console.log('✓ Server closed');
        process.exit(0);
    });
});