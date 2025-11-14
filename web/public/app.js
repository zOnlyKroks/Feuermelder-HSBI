// WebSocket connection
let ws;
let reconnectInterval = 3000;

// DOM elements
const espStatus = document.getElementById('esp-status');
const mq7Raw = document.getElementById('mq7-raw');
const mq7Voltage = document.getElementById('mq7-voltage');
const mq7Level = document.getElementById('mq7-level');
const mq7Time = document.getElementById('mq7-time');
const flameRaw = document.getElementById('flame-raw');
const flameVoltage = document.getElementById('flame-voltage');
const flameStatus = document.getElementById('flame-status');
const flameTime = document.getElementById('flame-time');
const temperature = document.getElementById('temperature');
const humidity = document.getElementById('humidity');
const tempStatus = document.getElementById('temp-status');
const humidStatus = document.getElementById('humid-status');
const dhtTime = document.getElementById('dht-time');
const lastUpdate = document.getElementById('last-update');
const currentRate = document.getElementById('current-rate');
const pollingRateInput = document.getElementById('polling-rate');
const setRateBtn = document.getElementById('set-rate-btn');
const messageDiv = document.getElementById('message');
const toggleMq7 = document.getElementById('toggle-mq7');
const toggleFlame = document.getElementById('toggle-flame');
const toggleDht = document.getElementById('toggle-dht');
const togglePm25 = document.getElementById('toggle-pm25');
const pm25Dust = document.getElementById('pm25-dust');
const pm25Raw = document.getElementById('pm25-raw');
const pm25Voltage = document.getElementById('pm25-voltage');
const pm25Quality = document.getElementById('pm25-quality');
const pm25Time = document.getElementById('pm25-time');
const toggleSe95 = document.getElementById('toggle-se95');
const se95Temp = document.getElementById('se95-temp');
const se95Status = document.getElementById('se95-status');
const se95Time = document.getElementById('se95-time');

// Flag to prevent input updates while user is editing
let isEditingPollingRate = false;

// Initialize WebSocket connection
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            updateUI(data);
        } catch (err) {
            console.error('Error parsing WebSocket message:', err);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showMessage('Connection error', 'error');
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected. Reconnecting...');
        setTimeout(connectWebSocket, reconnectInterval);
    };
}

function updateUI(data) {
    // Update ESP32 status
    if (data.status === 'online') {
        espStatus.textContent = 'Online';
        espStatus.className = 'status online';
    } else {
        espStatus.textContent = 'Offline';
        espStatus.className = 'status offline';
    }

    // Update MQ-7 data
    if (data.mq7) {
        if (data.mq7.raw !== undefined) {
            mq7Raw.textContent = data.mq7.raw;
        }
        if (data.mq7.voltage !== undefined) {
            mq7Voltage.textContent = `${data.mq7.voltage.toFixed(2)} V`;
        }
        if (data.mq7.level) {
            mq7Level.textContent = data.mq7.level;
            mq7Level.className = 'status-badge ' + getSeverityClass(data.mq7.level);
        }
        if (data.mq7.timestamp) {
            mq7Time.textContent = `Last update: ${formatTime(data.mq7.timestamp)}`;
        }
    }

    // Update flame sensor data
    if (data.flame) {
        if (data.flame.raw !== undefined) {
            flameRaw.textContent = data.flame.raw;
        }
        if (data.flame.voltage !== undefined) {
            flameVoltage.textContent = `${data.flame.voltage.toFixed(2)} V`;
        }
        if (data.flame.status) {
            flameStatus.textContent = data.flame.status;
            flameStatus.className = 'status-badge ' + getFlameClass(data.flame.status);
        }
        if (data.flame.timestamp) {
            flameTime.textContent = `Last update: ${formatTime(data.flame.timestamp)}`;
        }
    }

    // Update DHT22 data
    if (data.dht22) {
        if (data.dht22.temperature !== undefined && !isNaN(data.dht22.temperature)) {
            temperature.textContent = `${data.dht22.temperature.toFixed(1)}°C`;
        }
        if (data.dht22.tempStatus) {
            tempStatus.textContent = data.dht22.tempStatus;
            tempStatus.className = 'status-badge ' + getTempClass(data.dht22.tempStatus);
        }
        if (data.dht22.humidity !== undefined && !isNaN(data.dht22.humidity)) {
            humidity.textContent = `${data.dht22.humidity.toFixed(1)}%`;
        }
        if (data.dht22.humidStatus) {
            humidStatus.textContent = data.dht22.humidStatus;
            humidStatus.className = 'status-badge ' + getHumidClass(data.dht22.humidStatus);
        }
        if (data.dht22.timestamp) {
            dhtTime.textContent = `Last update: ${formatTime(data.dht22.timestamp)}`;
        }
    }

    // Update PM2.5 data
    if (data.pm25) {
        if (data.pm25.dust !== undefined) {
            pm25Dust.textContent = `${data.pm25.dust.toFixed(2)} mg/m³`;
        }
        if (data.pm25.raw !== undefined) {
            pm25Raw.textContent = data.pm25.raw;
        }
        if (data.pm25.voltage !== undefined) {
            pm25Voltage.textContent = `${data.pm25.voltage.toFixed(2)} V`;
        }
        if (data.pm25.quality) {
            pm25Quality.textContent = data.pm25.quality;
            pm25Quality.className = 'status-badge ' + getAirQualityClass(data.pm25.quality);
        }
        if (data.pm25.timestamp) {
            pm25Time.textContent = `Last update: ${formatTime(data.pm25.timestamp)}`;
        }
    }

    // Update SE95 data
    if (data.se95) {
        if (data.se95.temp !== undefined) {
            se95Temp.textContent = `${data.se95.temp.toFixed(2)}°C`;
        }
        if (data.se95.status) {
            se95Status.textContent = data.se95.status;
            se95Status.className = 'status-badge ' + getTempClass(data.se95.status);
        }
        if (data.se95.timestamp) {
            se95Time.textContent = `Last update: ${formatTime(data.se95.timestamp)}`;
        }
    }

    // Update last update timestamp
    if (data.lastUpdate) {
        lastUpdate.textContent = formatTime(data.lastUpdate);
    }

    // Update polling rate display
    if (data.pollingRate) {
        currentRate.textContent = `${data.pollingRate} ms`;
        // Only update input if user is not editing it
        if (!isEditingPollingRate) {
            pollingRateInput.value = data.pollingRate;
        }
    }

    // Update toggle states
    if (data.sensorsEnabled) {
        toggleMq7.checked = data.sensorsEnabled.mq7;
        toggleFlame.checked = data.sensorsEnabled.flame;
        toggleDht.checked = data.sensorsEnabled.dht;
        togglePm25.checked = data.sensorsEnabled.pm25;
        toggleSe95.checked = data.sensorsEnabled.se95;
    }
}

// Helper function to format timestamps
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
}

// Severity class helpers (keep your existing implementations)
function getSeverityClass(level) {
    switch(level) {
        case 'Good': return 'good';
        case 'Moderate': return 'moderate';
        case 'High': return 'high';
        case 'Dangerous': return 'dangerous';
        default: return '';
    }
}

function getFlameClass(status) {
    if (status.includes('FIRE')) return 'dangerous';
    if (status.includes('Heat')) return 'high';
    return 'good';
}

function getTempClass(status) {
    switch(status) {
        case 'Cold': return 'cold';
        case 'Cool': return 'cool';
        case 'Comfortable': return 'good';
        case 'Warm': return 'warm';
        case 'Hot': return 'hot';
        default: return '';
    }
}

function getHumidClass(status) {
    switch(status) {
        case 'Dry': return 'dry';
        case 'Comfortable': return 'good';
        case 'Humid': return 'moderate';
        case 'Very Humid': return 'high';
        default: return '';
    }
}

function getAirQualityClass(quality) {
    if (quality.includes('Good')) return 'good';
    if (quality.includes('Moderate')) return 'moderate';
    if (quality.includes('Unhealthy')) return 'high';
    if (quality.includes('Hazardous')) return 'dangerous';
    return '';
}

// Show message
function showMessage(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;

    setTimeout(() => {
        messageDiv.className = 'message';
    }, 3000);
}

// Set polling rate
async function setPollingRate() {
    const rate = parseInt(pollingRateInput.value);

    if (rate < 100 || rate > 60000) {
        showMessage('Rate must be between 100 and 60000 ms', 'error');
        return;
    }

    try {
        const response = await fetch('/api/control/rate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ rate })
        });

        const data = await response.json();

        if (data.success) {
            showMessage(`Polling rate updated to ${rate} ms`, 'success');
            currentRate.textContent = `${rate} ms`;
        } else {
            showMessage('Failed to update rate', 'error');
        }
    } catch (err) {
        console.error('Error setting rate:', err);
        showMessage('Error updating rate', 'error');
    }
}

async function controlBuzzer(command) {
    try {
        const response = await fetch('/api/control/buzzer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command })
        });

        const result = await response.json();

        if (result.success) {
            showMessage(`Buzzer: ${command}`, 'success');
        } else {
            showMessage('Failed to control buzzer', 'error');
        }
    } catch (error) {
        console.error('Failed to control buzzer:', error);
        showMessage('Failed to control buzzer', 'error');
    }
}

// Toggle sensor
async function toggleSensor(sensor, enabled) {
    try {
        const response = await fetch('/api/control/enable', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sensor, enabled })
        });

        const data = await response.json();

        if (data.success) {
            showMessage(`${sensor.toUpperCase()} sensor ${enabled ? 'enabled' : 'disabled'}`, 'success');
        } else {
            showMessage(`Failed to toggle ${sensor}`, 'error');
        }
    } catch (err) {
        console.error('Error toggling sensor:', err);
        showMessage('Error toggling sensor', 'error');
    }
}

// Event listeners
setRateBtn.addEventListener('click', setPollingRate);

pollingRateInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        setPollingRate();
    }
});

// Prevent input updates while user is editing
pollingRateInput.addEventListener('focus', () => {
    isEditingPollingRate = true;
});

pollingRateInput.addEventListener('blur', () => {
    // Delay clearing the flag to prevent race conditions
    setTimeout(() => {
        isEditingPollingRate = false;
    }, 100);
});

// Also set flag when user starts typing
pollingRateInput.addEventListener('input', () => {
    isEditingPollingRate = true;
});

toggleMq7.addEventListener('change', (e) => {
    toggleSensor('mq7', e.target.checked);
});

toggleFlame.addEventListener('change', (e) => {
    toggleSensor('flame', e.target.checked);
});

toggleDht.addEventListener('change', (e) => {
    toggleSensor('dht', e.target.checked);
});

togglePm25.addEventListener('change', (e) => {
    toggleSensor('pm25', e.target.checked);
});

toggleSe95.addEventListener('change', (e) => {
    toggleSensor('se95', e.target.checked);
});

// Initialize
connectWebSocket();

// Fetch initial data
fetch('/api/sensors')
    .then(response => response.json())
    .then(data => updateUI(data))
    .catch(err => console.error('Error fetching initial data:', err));