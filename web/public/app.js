// ===== Global State =====
let ws;
let reconnectInterval = 3000;
let currentView = 'user'; // 'user', 'dev', or 'history'

// ===== WebSocket Connection =====
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connected');
        updateConnectionStatus(true);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            updateUI(data);
            checkAlerts(data);
        } catch (err) {
            console.error('Error parsing WebSocket message:', err);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus(false);
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected. Reconnecting...');
        updateConnectionStatus(false);
        setTimeout(connectWebSocket, reconnectInterval);
    };
}

// ===== Connection Status =====
function updateConnectionStatus(isConnected) {
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    if (isConnected) {
        statusDot.className = 'status-dot online';
        statusText.textContent = 'Verbunden';
    } else {
        statusDot.className = 'status-dot offline';
        statusText.textContent = 'Getrennt';
    }
}

// ===== View Navigation =====
function switchView(view) {
    const userView = document.getElementById('user-view');
    const devView = document.getElementById('dev-view');
    const historyView = document.getElementById('history-view');
    const modeToggleBtn = document.getElementById('mode-toggle');
    const historyToggleBtn = document.getElementById('history-toggle');

    // Hide all views
    userView.classList.add('hidden');
    devView.classList.add('hidden');
    historyView.classList.add('hidden');

    // Update state
    currentView = view;

    // Show selected view and update buttons
    if (view === 'user') {
        userView.classList.remove('hidden');
        modeToggleBtn.querySelector('.label').textContent = 'Dev Mode';
        modeToggleBtn.querySelector('.icon').textContent = '⚙️';
        historyToggleBtn.style.display = 'flex';
        modeToggleBtn.style.display = 'flex';
    } else if (view === 'dev') {
        devView.classList.remove('hidden');
        modeToggleBtn.querySelector('.label').textContent = 'User Mode';
        modeToggleBtn.querySelector('.icon').textContent = '👤';
        historyToggleBtn.style.display = 'flex';
        modeToggleBtn.style.display = 'flex';
    } else if (view === 'history') {
        historyView.classList.remove('hidden');
        historyToggleBtn.style.display = 'none';
        modeToggleBtn.style.display = 'flex';
        modeToggleBtn.querySelector('.label').textContent = 'Back';
        modeToggleBtn.querySelector('.icon').textContent = '←';

        // Load historical data
        loadHistoricalData();
        loadAlerts();
    }
}

// Mode Toggle Button
document.getElementById('mode-toggle').addEventListener('click', () => {
    if (currentView === 'history') {
        // Return to user mode when exiting history
        switchView('user');
    } else if (currentView === 'user') {
        switchView('dev');
    } else if (currentView === 'dev') {
        switchView('user');
    }
});

// ===== LED Control =====
document.getElementById('led-toggle').addEventListener('change', (e) => {
    toggleLED(e.target.checked);
});

function toggleLED(enabled) {
    fetch('/api/control/led', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
    })
    .then(res => res.json())
    .then(data => {
        console.log('LED control:', data);
        // Update dev mode buttons
        updateLEDButtons(enabled);
    })
    .catch(err => console.error('LED control error:', err));
}

function updateLEDButtons(enabled) {
    const onBtn = document.getElementById('led-on-btn');
    const offBtn = document.getElementById('led-off-btn');

    if (enabled) {
        onBtn.classList.add('btn-success');
        onBtn.classList.remove('btn-secondary');
        offBtn.classList.add('btn-secondary');
        offBtn.classList.remove('btn-success');
    } else {
        onBtn.classList.add('btn-secondary');
        onBtn.classList.remove('btn-success');
        offBtn.classList.add('btn-success');
        offBtn.classList.remove('btn-secondary');
    }
}

// ===== Alert System =====
function checkAlerts(data) {
    const alerts = [];

    // Check Fire
    if (data.flame && data.flame.status === 'FIRE DETECTED') {
        alerts.push('🔥 FEUER ERKANNT! Sofort evakuieren!');
    }

    // Check CO Level
    if (data.mq7) {
        if (data.mq7.level === 'Dangerous') {
            alerts.push('☠️ GEFÄHRLICHER CO-LEVEL! Raum verlassen!');
        } else if (data.mq7.level === 'High') {
            alerts.push('⚠️ Hoher CO-Level erkannt!');
        }
    }

    // Check Air Quality
    if (data.pm25 && (data.pm25.quality === 'Very Unhealthy' || data.pm25.quality === 'Hazardous')) {
        alerts.push('🌫️ Sehr schlechte Luftqualität!');
    }

    // Update alert banner
    if (alerts.length > 0) {
        showAlert(alerts.join(' | '));
    } else {
        hideAlert();
    }
}

function showAlert(message) {
    const banner = document.getElementById('alert-banner');
    const messageEl = document.getElementById('alert-message');

    messageEl.textContent = message;
    banner.classList.remove('hidden');
}

function hideAlert() {
    const banner = document.getElementById('alert-banner');
    banner.classList.add('hidden');
}

// ===== UI Update Functions =====
function updateUI(data) {
    updateUserMode(data);
    updateDevMode(data);
    updateTimestamps(data);
}

function updateUserMode(data) {
    // Fire Status
    if (data.flame) {
        const fireStatus = document.getElementById('fire-status');
        const statusValue = fireStatus.querySelector('.status-value');
        const statusLabel = fireStatus.querySelector('.status-label');

        statusValue.textContent = data.flame.status;
        statusValue.className = 'status-value ' + getStatusClass(data.flame.status);
        statusLabel.textContent = data.flame.status === 'FIRE DETECTED' ? 'ALARM!' : 'Status';
    }

    // CO Status
    if (data.mq7) {
        const coStatus = document.getElementById('co-status');
        const statusValue = coStatus.querySelector('.status-value');

        statusValue.textContent = data.mq7.level || '--';
        statusValue.className = 'status-value ' + getStatusClass(data.mq7.level);
    }

    // Air Quality
    if (data.pm25) {
        const airQuality = document.getElementById('air-quality-status');
        const statusValue = airQuality.querySelector('.status-value');

        statusValue.textContent = data.pm25.quality || '--';
        statusValue.className = 'status-value ' + getStatusClass(data.pm25.quality);
    }

    // Temperature (Averaged)
    if (data.avgTemperature && data.avgTemperature.temp) {
        document.getElementById('avg-temp').textContent = data.avgTemperature.temp.toFixed(1);
        document.getElementById('temp-status').textContent = data.avgTemperature.status;
    }

    // Individual temperatures
    if (data.dht22 && data.dht22.temperature) {
        document.getElementById('dht22-temp').textContent = data.dht22.temperature.toFixed(1) + '°C';
    }
    if (data.se95 && data.se95.temp) {
        document.getElementById('se95-temp').textContent = data.se95.temp.toFixed(1) + '°C';
    }

    // Humidity
    if (data.dht22) {
        document.getElementById('humidity-value').textContent = data.dht22.humidity?.toFixed(1) || '--';
        document.getElementById('humidity-label').textContent = data.dht22.humidStatus || '--';
    }

    // Last Update (User Mode)
    if (data.lastUpdate) {
        document.getElementById('last-update-user').textContent = formatTime(data.lastUpdate);
    }
}

function updateDevMode(data) {
    // MQ-7 CO Sensor
    if (data.mq7) {
        document.getElementById('co-level').textContent = data.mq7.level || '--';
        document.getElementById('co-level').className = 'value badge ' + getBadgeClass(data.mq7.level);
        document.getElementById('co-raw').textContent = data.mq7.raw || '--';
        document.getElementById('co-voltage').textContent = data.mq7.voltage ? `${data.mq7.voltage.toFixed(2)}V` : '--';
        document.getElementById('co-timestamp').textContent = data.mq7.timestamp ? formatTime(data.mq7.timestamp) : '--';
    }

    // Flame Sensor
    if (data.flame) {
        document.getElementById('flame-status-dev').textContent = data.flame.status || '--';
        document.getElementById('flame-status-dev').className = 'value badge ' + getBadgeClass(data.flame.status);
        document.getElementById('flame-raw').textContent = data.flame.raw || '--';
        document.getElementById('flame-voltage').textContent = data.flame.voltage ? `${data.flame.voltage.toFixed(2)}V` : '--';
        document.getElementById('flame-timestamp').textContent = data.flame.timestamp ? formatTime(data.flame.timestamp) : '--';
    }

    // DHT22
    if (data.dht22) {
        document.getElementById('dht-temp-dev').textContent = data.dht22.temperature ? `${data.dht22.temperature.toFixed(1)}°C` : '--';
        document.getElementById('dht-temp-status').textContent = data.dht22.tempStatus || '--';
        document.getElementById('dht-temp-status').className = 'value badge ' + getBadgeClass(data.dht22.tempStatus);
        document.getElementById('dht-humidity').textContent = data.dht22.humidity ? `${data.dht22.humidity.toFixed(1)}%` : '--';
        document.getElementById('dht-humid-status').textContent = data.dht22.humidStatus || '--';
        document.getElementById('dht-humid-status').className = 'value badge ' + getBadgeClass(data.dht22.humidStatus);
        document.getElementById('dht-timestamp').textContent = data.dht22.timestamp ? formatTime(data.dht22.timestamp) : '--';
    }

    // PM2.5
    if (data.pm25) {
        document.getElementById('pm25-quality').textContent = data.pm25.quality || '--';
        document.getElementById('pm25-quality').className = 'value badge ' + getBadgeClass(data.pm25.quality);
        document.getElementById('pm25-dust').textContent = data.pm25.dust ? `${data.pm25.dust.toFixed(2)} mg/m³` : '--';
        document.getElementById('pm25-raw').textContent = data.pm25.raw || '--';
        document.getElementById('pm25-voltage').textContent = data.pm25.voltage ? `${data.pm25.voltage.toFixed(2)}V` : '--';
        document.getElementById('pm25-timestamp').textContent = data.pm25.timestamp ? formatTime(data.pm25.timestamp) : '--';
    }

    // SE95
    if (data.se95) {
        document.getElementById('se95-temp-dev').textContent = data.se95.temp ? `${data.se95.temp.toFixed(1)}°C` : '--';
        document.getElementById('se95-status').textContent = data.se95.status || '--';
        document.getElementById('se95-status').className = 'value badge ' + getBadgeClass(data.se95.status);
        document.getElementById('se95-timestamp').textContent = data.se95.timestamp ? formatTime(data.se95.timestamp) : '--';
    }

    // Polling Rate
    if (data.pollingRate) {
        document.getElementById('current-rate').textContent = `${data.pollingRate} ms`;
    }

    // Last Update (Dev Mode)
    if (data.lastUpdate) {
        document.getElementById('last-update-dev').textContent = formatTime(data.lastUpdate);
    }
}

function updateTimestamps(data) {
    // Connection status
    if (data.status === 'online') {
        updateConnectionStatus(true);
    } else if (data.status === 'offline') {
        updateConnectionStatus(false);
    }
}

// ===== Helper Functions =====
function getStatusClass(status) {
    if (!status) return '';

    const statusLower = status.toLowerCase();

    if (statusLower.includes('fire') || statusLower.includes('dangerous') || statusLower.includes('hazardous')) {
        return 'fire';
    } else if (statusLower.includes('high') || statusLower.includes('unhealthy') || statusLower.includes('very')) {
        return 'danger';
    } else if (statusLower.includes('moderate') || statusLower.includes('heat')) {
        return 'moderate';
    } else if (statusLower.includes('good') || statusLower.includes('normal') || statusLower.includes('comfortable')) {
        return 'good';
    }

    return 'moderate';
}

function getBadgeClass(status) {
    return getStatusClass(status);
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// ===== Control Functions (Dev Mode) =====
function updatePollingRate() {
    const rate = parseInt(document.getElementById('polling-rate').value);

    if (rate < 100 || rate > 60000) {
        alert('Polling rate must be between 100 and 60000 ms');
        return;
    }

    fetch('/api/control/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate })
    })
    .then(res => res.json())
    .then(data => {
        console.log('Polling rate updated:', data);
    })
    .catch(err => console.error('Polling rate error:', err));
}

function triggerBuzzer(command) {
    fetch('/api/control/buzzer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
    })
    .then(res => res.json())
    .then(data => {
        console.log('Buzzer triggered:', data);
    })
    .catch(err => console.error('Buzzer error:', err));
}

// ===== Sensor Toggle (Dev Mode) =====
document.querySelectorAll('[data-sensor]').forEach(toggle => {
    toggle.addEventListener('change', (e) => {
        const sensor = e.target.dataset.sensor;
        const enabled = e.target.checked;

        fetch('/api/control/enable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sensor, enabled })
        })
        .then(res => res.json())
        .then(data => {
            console.log('Sensor toggle:', data);
        })
        .catch(err => console.error('Sensor toggle error:', err));
    });
});

// ===== HISTORY MODE =====
let charts = {};

// History Toggle Button
document.getElementById('history-toggle').addEventListener('click', () => {
    switchView('history');
});

// Initialize Charts
function initCharts() {
    const chartConfig = {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
            legend: {
                labels: { color: '#a0aec0' }
            }
        },
        scales: {
            x: {
                ticks: { color: '#a0aec0' },
                grid: { color: '#2d3748' }
            },
            y: {
                ticks: { color: '#a0aec0' },
                grid: { color: '#2d3748' }
            }
        }
    };

    // Temperature Chart
    const tempCtx = document.getElementById('temp-chart').getContext('2d');
    charts.temperature = new Chart(tempCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'DHT22',
                    data: [],
                    borderColor: '#4299e1',
                    backgroundColor: 'rgba(66, 153, 225, 0.1)',
                    tension: 0.4,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'SE95',
                    data: [],
                    borderColor: '#9f7aea',
                    backgroundColor: 'rgba(159, 122, 234, 0.1)',
                    tension: 0.4,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4
                }
            ]
        },
        options: chartConfig
    });

    // Humidity Chart
    const humidityCtx = document.getElementById('humidity-chart').getContext('2d');
    charts.humidity = new Chart(humidityCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Humidity (%)',
                data: [],
                borderColor: '#48bb78',
                backgroundColor: 'rgba(72, 187, 120, 0.1)',
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4
            }]
        },
        options: chartConfig
    });

    // CO Level Chart
    const coCtx = document.getElementById('co-chart').getContext('2d');
    charts.co = new Chart(coCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'CO Level (V)',
                data: [],
                borderColor: '#ed8936',
                backgroundColor: 'rgba(237, 131, 54, 0.1)',
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4
            }]
        },
        options: chartConfig
    });

    // Air Quality Chart
    const airQualityCtx = document.getElementById('air-quality-chart').getContext('2d');
    charts.airQuality = new Chart(airQualityCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'PM2.5 (mg/m³)',
                data: [],
                borderColor: '#ecc94b',
                backgroundColor: 'rgba(236, 201, 75, 0.1)',
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4
            }]
        },
        options: chartConfig
    });
}

// Load Historical Data
function loadHistoricalData() {
    const hours = parseFloat(document.getElementById('time-range').value);
    const bucketSize = document.getElementById('bucket-size').value;

    // Build query parameters
    let queryParams = `hours=${hours}`;
    if (bucketSize !== 'auto') {
        queryParams += `&bucket=${bucketSize}`;
    }

    console.log(`Loading historical data: hours=${hours}, bucket=${bucketSize}, query=${queryParams}`);

    // Determine point visibility based on data density
    const showPoints = bucketSize === '0' || parseInt(bucketSize) <= 5;
    const pointRadius = showPoints ? 2 : 0;
    const tension = bucketSize === '0' ? 0 : 0.4; // No smoothing for raw data

    // Fetch temperature data (DHT22)
    fetch(`/api/history/temperature_dht22?${queryParams}`)
        .then(res => res.json())
        .then(data => {
            console.log(`Temperature DHT22: ${data.data.length} data points`);
            const labels = data.data.map(d => formatChartTime(d.timestamp));
            const values = data.data.map(d => d.value);

            charts.temperature.data.labels = labels;
            charts.temperature.data.datasets[0].data = values;
            charts.temperature.data.datasets[0].pointRadius = pointRadius;
            charts.temperature.data.datasets[0].tension = tension;

            // Update data point info
            const infoEl = document.getElementById('data-point-info');
            infoEl.textContent = `(${data.data.length} data points)`;

            // Also fetch SE95 temperature
            return fetch(`/api/history/temperature_se95?${queryParams}`);
        })
        .then(res => res.json())
        .then(data => {
            console.log(`Temperature SE95: ${data.data.length} data points`);
            const values = data.data.map(d => d.value);
            charts.temperature.data.datasets[1].data = values;
            charts.temperature.data.datasets[1].pointRadius = pointRadius;
            charts.temperature.data.datasets[1].tension = tension;
            charts.temperature.update();
        })
        .catch(err => console.error('Error loading temperature data:', err));

    // Fetch humidity data
    fetch(`/api/history/humidity?${queryParams}`)
        .then(res => res.json())
        .then(data => {
            console.log(`Humidity: ${data.data.length} data points`);
            const labels = data.data.map(d => formatChartTime(d.timestamp));
            const values = data.data.map(d => d.value);

            charts.humidity.data.labels = labels;
            charts.humidity.data.datasets[0].data = values;
            charts.humidity.data.datasets[0].pointRadius = pointRadius;
            charts.humidity.data.datasets[0].tension = tension;
            charts.humidity.update();
        })
        .catch(err => console.error('Error loading humidity data:', err));

    // Fetch CO data
    fetch(`/api/history/co_level?${queryParams}`)
        .then(res => res.json())
        .then(data => {
            console.log(`CO Level: ${data.data.length} data points`);
            const labels = data.data.map(d => formatChartTime(d.timestamp));
            const values = data.data.map(d => d.value);

            charts.co.data.labels = labels;
            charts.co.data.datasets[0].data = values;
            charts.co.data.datasets[0].pointRadius = pointRadius;
            charts.co.data.datasets[0].tension = tension;
            charts.co.update();
        })
        .catch(err => console.error('Error loading CO data:', err));

    // Fetch air quality data
    fetch(`/api/history/air_quality?${queryParams}`)
        .then(res => res.json())
        .then(data => {
            console.log(`Air Quality: ${data.data.length} data points`);
            const labels = data.data.map(d => formatChartTime(d.timestamp));
            const values = data.data.map(d => d.value);

            charts.airQuality.data.labels = labels;
            charts.airQuality.data.datasets[0].data = values;
            charts.airQuality.data.datasets[0].pointRadius = pointRadius;
            charts.airQuality.data.datasets[0].tension = tension;
            charts.airQuality.update();
        })
        .catch(err => console.error('Error loading air quality data:', err));
}

// Load Alerts
function loadAlerts() {
    fetch('/api/alerts?limit=20')
        .then(res => res.json())
        .then(data => {
            const alertsList = document.getElementById('alerts-list');

            if (data.alerts.length === 0) {
                alertsList.innerHTML = '<p class="loading">No alerts found</p>';
                return;
            }

            alertsList.innerHTML = data.alerts.map(alert => `
                <div class="alert-item ${alert.severity}">
                    <div class="alert-info">
                        <div class="alert-type">${alert.alert_type}</div>
                        <div class="alert-message">${alert.message}</div>
                        <div class="alert-time">${formatTime(alert.timestamp)}</div>
                    </div>
                </div>
            `).join('');
        })
        .catch(err => {
            console.error('Error loading alerts:', err);
            document.getElementById('alerts-list').innerHTML = '<p class="loading">Error loading alerts</p>';
        });
}

// Format time for charts (with seconds for precision)
function formatChartTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// ===== Initialize =====
connectWebSocket();
initCharts();
console.log('Feuermelder Frontend initialized');