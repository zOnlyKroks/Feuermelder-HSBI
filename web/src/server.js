const express = require('express');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const {
    saveSensorReading,
    saveAlert,
    getHistoricalData,
    getRecentAlerts,
    ackAlert,
    getStatistics,
    cleanOldData
} = require('./database');

const app = express();
const PORT = 3000;

setInterval(() => {
    cleanOldData(30);
}, 24 * 60 * 60 * 1000);

const MQTT_BROKER = process.env.MQTT_BROKER || '192.168.178.49';
const MQTT_PORT = process.env.MQTT_PORT || 1883;
const MQTT_USER = process.env.MQTT_USER || '';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';

const TOPICS = {
    SENSORS: 'home/sensors/data',
    STATUS: 'home/sensors/status',
    CONTROL_RATE: 'home/sensors/control/rate',
    CONTROL_ENABLE: 'home/sensors/control/enable',
    CONTROL_BUZZER: 'home/sensors/control/buzzer',
    CONTROL_LED: 'home/sensors/control/led'
};

let sensorData = {
    mq7: { raw: 0, voltage: 0, level: '', timestamp: null },
    flame: { raw: 0, voltage: 0, status: '', timestamp: null },
    dht22: { temperature: 0, humidity: 0, tempStatus: '', humidStatus: '', timestamp: null },
    pm25: { raw: 0, voltage: 0, dust: 0, quality: '', timestamp: null },
    se95: { temp: 0, status: '', timestamp: null },
    avgTemperature: { temp: 0, status: '', timestamp: null },
    status: 'offline',
    lastUpdate: null,
    sensorsEnabled: {
        mq7: true,
        flame: true,
        dht: true,
        pm25: true,
        se95: true
    },
    pollingRate: 1000,
    statusLedEnabled: true
};

const mqttOptions = {
    clientId: 'feuermelder-webapp-' + Math.random().toString(16).substr(2, 8),
    clean: true,
    reconnectPeriod: 1000
};

if (MQTT_USER && MQTT_USER.length > 0) {
    mqttOptions.username = MQTT_USER;
    mqttOptions.password = MQTT_PASSWORD;
}

const mqttClient = mqtt.connect(`mqtt://${MQTT_BROKER}:${MQTT_PORT}`, mqttOptions);

mqttClient.on('connect', () => {
    console.log('✓ Connected to MQTT broker');

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
            const data = JSON.parse(payload);

            switch(data.sensor) {
                case 'mq7':
                    sensorData.mq7 = {
                        raw: data.raw,
                        voltage: data.voltage,
                        level: data.level,
                        timestamp
                    };

                    saveSensorReading(timestamp, 'co_level', data.voltage, 'V', data.level, data);

                    if (data.level === 'Dangerous' || data.level === 'High') {
                        saveAlert(timestamp, 'CO', `CO Level: ${data.level}`, data.level === 'Dangerous' ? 'critical' : 'warning');
                    }
                    break;

                case 'flame':
                    sensorData.flame = {
                        raw: data.raw,
                        voltage: data.voltage,
                        status: data.status,
                        timestamp
                    };

                    saveSensorReading(timestamp, 'flame', data.raw, 'raw', data.status, data);

                    if (data.status === 'FIRE DETECTED') {
                        saveAlert(timestamp, 'FIRE', 'Fire detected!', 'critical');
                    }
                    break;

                case 'dht22':
                    sensorData.dht22 = {
                        temperature: data.temp,
                        humidity: data.humidity,
                        tempStatus: data.tempStatus,
                        humidStatus: data.humidStatus,
                        timestamp
                    };

                    saveSensorReading(timestamp, 'temperature_dht22', data.temp, '°C', data.tempStatus, data);
                    saveSensorReading(timestamp, 'humidity', data.humidity, '%', data.humidStatus, data);
                    break;

                case 'pm25':
                    sensorData.pm25 = {
                        raw: data.raw,
                        voltage: data.voltage,
                        dust: data.dust,
                        quality: data.quality,
                        timestamp
                    };

                    saveSensorReading(timestamp, 'air_quality', data.dust, 'mg/m³', data.quality, data);

                    if (data.quality === 'Very Unhealthy' || data.quality === 'Hazardous') {
                        saveAlert(timestamp, 'AIR_QUALITY', `Air quality: ${data.quality}`, 'warning');
                    }
                    break;

                case 'se95':
                    sensorData.se95 = {
                        temp: data.temp,
                        status: data.status,
                        timestamp
                    };

                    saveSensorReading(timestamp, 'temperature_se95', data.temp, '°C', data.status, data);
                    break;

                default:
                    console.warn('⚠️ Unknown sensor type:', data.sensor);
            }

            sensorData.lastUpdate = timestamp;
            sensorData.status = 'online';

            if (sensorData.dht22.temperature && sensorData.se95.temp) {
                const avgTemp = (sensorData.dht22.temperature + sensorData.se95.temp) / 2;
                let tempStatus;
                if (avgTemp < 15) tempStatus = 'Cold';
                else if (avgTemp < 20) tempStatus = 'Cool';
                else if (avgTemp < 25) tempStatus = 'Comfortable';
                else if (avgTemp < 30) tempStatus = 'Warm';
                else tempStatus = 'Hot';

                sensorData.avgTemperature = {
                    temp: avgTemp,
                    status: tempStatus,
                    timestamp
                };
            }

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

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

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

    res.json({ success: true, command });
});

app.post('/api/control/led', (req, res) => {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Invalid LED state. Use: true or false' });
    }

    sensorData.statusLedEnabled = enabled;
    mqttClient.publish(TOPICS.CONTROL_LED, enabled ? 'on' : 'off');

    res.json({ success: true, enabled });
});

// Historical Data API Endpoints
app.get('/api/history/:sensorType', (req, res) => {
    const { sensorType } = req.params;
    const hours = parseFloat(req.query.hours) || 24;
    const bucket = req.query.bucket ? parseInt(req.query.bucket) : null;

    try {
        const data = getHistoricalData(sensorType, hours, bucket);
        res.json({ sensor: sensorType, hours, bucket, data });
    } catch (err) {
        console.error('Error fetching historical data:', err);
        res.status(500).json({ error: 'Failed to fetch historical data' });
    }
});

app.get('/api/statistics/:sensorType', (req, res) => {
    const { sensorType } = req.params;
    const hours = parseInt(req.query.hours) || 24;

    try {
        const stats = getStatistics(sensorType, hours);
        res.json({ sensor: sensorType, hours, statistics: stats });
    } catch (err) {
        console.error('Error fetching statistics:', err);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

app.get('/api/alerts', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;

    try {
        const alerts = getRecentAlerts(limit);
        res.json({ alerts });
    } catch (err) {
        console.error('Error fetching alerts:', err);
        res.status(500).json({ error: 'Failed to fetch alerts' });
    }
});

app.post('/api/alerts/:id/acknowledge', (req, res) => {
    const { id } = req.params;

    try {
        const success = ackAlert(parseInt(id));
        if (success) {
            res.json({ success: true, id });
        } else {
            res.status(404).json({ error: 'Alert not found' });
        }
    } catch (err) {
        console.error('Error acknowledging alert:', err);
        res.status(500).json({ error: 'Failed to acknowledge alert' });
    }
});

// HTTPS Configuration
const ENABLE_HTTPS = process.env.ENABLE_HTTPS === 'true';
const CERT_PATH = process.env.CERT_PATH || path.join(__dirname, '../certs/cert.pem');
const KEY_PATH = process.env.KEY_PATH || path.join(__dirname, '../certs/key.pem');

// Start Server (HTTP or HTTPS)
let server;
if (ENABLE_HTTPS && fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    const options = {
        key: fs.readFileSync(KEY_PATH),
        cert: fs.readFileSync(CERT_PATH)
    };
    server = https.createServer(options, app);
    server.listen(PORT, () => {
        console.log('\n=== Feuermelder Web Application ===');
        console.log(`🔒 HTTPS server: https://localhost:${PORT}`);
        console.log(`📡 MQTT Broker: ${MQTT_BROKER}:${MQTT_PORT}`);
        console.log('================================\n');
    });
} else {
    if (ENABLE_HTTPS) {
        console.warn('⚠️  HTTPS enabled but certificates not found, falling back to HTTP');
    }
    server = http.createServer(app);
    server.listen(PORT, () => {
        console.log('\n=== Feuermelder Web Application ===');
        console.log(`🌐 HTTP server: http://localhost:${PORT}`);
        console.log(`📡 MQTT Broker: ${MQTT_BROKER}:${MQTT_PORT}`);
        console.log('================================\n');
    });
}

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
let isShuttingDown = false;
process.on('SIGINT', () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log('\n🛑 Shutting down gracefully...');

    mqttClient.end(false, {}, () => {
        console.log('✓ MQTT disconnected');
    });

    wss.clients.forEach(client => {
        client.close();
    });

    server.close(() => {
        console.log('✓ Server closed');
        process.exit(0);
    });

    // Force exit after 3 seconds if graceful shutdown fails
    setTimeout(() => {
        console.log('⚠️  Force exit');
        process.exit(1);
    }, 3000);
});