const Database = require('better-sqlite3');
const path = require('path');

// Create database connection
const db = new Database(path.join(__dirname, '../data/feuermelder.db'));

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Create tables if they don't exist
function initDatabase() {
    // Sensor readings table
    db.exec(`
        CREATE TABLE IF NOT EXISTS sensor_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            sensor_type TEXT NOT NULL,
            value REAL,
            unit TEXT,
            status TEXT,
            raw_data TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_timestamp ON sensor_readings(timestamp);
        CREATE INDEX IF NOT EXISTS idx_sensor_type ON sensor_readings(sensor_type);
        CREATE INDEX IF NOT EXISTS idx_sensor_timestamp ON sensor_readings(sensor_type, timestamp);

        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            alert_type TEXT NOT NULL,
            message TEXT NOT NULL,
            severity TEXT NOT NULL,
            acknowledged INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_alert_timestamp ON alerts(timestamp);
    `);

    console.log('✓ Database initialized');
}

// Initialize database immediately
initDatabase();

// Insert sensor reading
const insertReading = db.prepare(`
    INSERT INTO sensor_readings (timestamp, sensor_type, value, unit, status, raw_data)
    VALUES (?, ?, ?, ?, ?, ?)
`);

function saveSensorReading(timestamp, sensorType, value, unit, status, rawData) {
    try {
        insertReading.run(
            timestamp,
            sensorType,
            value,
            unit,
            status,
            JSON.stringify(rawData)
        );
    } catch (err) {
        console.error('Error saving sensor reading:', err);
    }
}

// Insert alert
const insertAlert = db.prepare(`
    INSERT INTO alerts (timestamp, alert_type, message, severity)
    VALUES (?, ?, ?, ?)
`);

function saveAlert(timestamp, alertType, message, severity) {
    try {
        insertAlert.run(timestamp, alertType, message, severity);
    } catch (err) {
        console.error('Error saving alert:', err);
    }
}

// Get historical data with aggregation for smooth graphs
function getHistoricalData(sensorType, hours = 24, intervalMinutes = null) {
    // Special case: 0 means no aggregation (raw data)
    if (intervalMinutes === 0) {
        const query = db.prepare(`
            SELECT
                timestamp,
                value,
                status
            FROM sensor_readings
            WHERE sensor_type = ?
            AND datetime(timestamp) >= datetime('now', '-' || ? || ' hours')
            ORDER BY timestamp ASC
        `);
        return query.all(sensorType, hours);
    }

    if (intervalMinutes === null || intervalMinutes === undefined) {
        if (hours <= 0.0833) { // <= 5 minutes
            intervalMinutes = 0; // No aggregation (raw data)
        } else if (hours <= 0.25) { // <= 15 minutes
            intervalMinutes = 0; // No aggregation (raw data)
        } else if (hours <= 0.5) { // <= 30 minutes
            intervalMinutes = 1; // 1 minute buckets
        } else if (hours <= 1) { // <= 1 hour
            intervalMinutes = 1; // 1 minute buckets (60 points)
        } else if (hours <= 6) {
            intervalMinutes = 5; // 6 hours: 5 minute buckets (72 points)
        } else if (hours <= 24) {
            intervalMinutes = 15; // 24 hours: 15 minute buckets (96 points)
        } else {
            intervalMinutes = 60; // 1 week: 1 hour buckets (168 points)
        }
    }

    if (intervalMinutes === 0) {
        const query = db.prepare(`
            SELECT
                timestamp,
                value,
                status
            FROM sensor_readings
            WHERE sensor_type = ?
            AND datetime(timestamp) >= datetime('now', '-' || ? || ' hours')
            ORDER BY timestamp ASC
        `);
        return query.all(sensorType, hours);
    }

    const intervalSeconds = intervalMinutes * 60;
    const query = db.prepare(`
        SELECT
            datetime(
                (CAST(strftime('%s', timestamp) AS INTEGER) / ?) * ?,
                'unixepoch'
            ) as timestamp,
            AVG(value) as value,
            GROUP_CONCAT(DISTINCT status) as status
        FROM sensor_readings
        WHERE sensor_type = ?
        AND datetime(timestamp) >= datetime('now', '-' || ? || ' hours')
        GROUP BY CAST(strftime('%s', timestamp) AS INTEGER) / ?
        ORDER BY timestamp ASC
    `);

    return query.all(intervalSeconds, intervalSeconds, sensorType, hours, intervalSeconds);
}

// Get recent alerts
function getRecentAlerts(limit = 50) {
    const query = db.prepare(`
        SELECT id, timestamp, alert_type, message, severity, acknowledged
        FROM alerts
        ORDER BY timestamp DESC
        LIMIT ?
    `);

    return query.all(limit);
}

// Acknowledge alert
const acknowledgeAlert = db.prepare(`
    UPDATE alerts SET acknowledged = 1 WHERE id = ?
`);

function ackAlert(alertId) {
    try {
        acknowledgeAlert.run(alertId);
        return true;
    } catch (err) {
        console.error('Error acknowledging alert:', err);
        return false;
    }
}

// Get statistics
function getStatistics(sensorType, hours = 24) {
    const query = db.prepare(`
        SELECT
            MIN(value) as min,
            MAX(value) as max,
            AVG(value) as avg,
            COUNT(*) as count
        FROM sensor_readings
        WHERE sensor_type = ?
        AND datetime(timestamp) >= datetime('now', '-' || ? || ' hours')
    `);

    return query.get(sensorType, hours);
}

// Clean old data (keep last 30 days)
function cleanOldData(days = 30) {
    try {
        db.prepare(`
            DELETE FROM sensor_readings
            WHERE datetime(timestamp) < datetime('now', '-' || ? || ' days')
        `).run(days);

        db.prepare(`
            DELETE FROM alerts
            WHERE datetime(timestamp) < datetime('now', '-' || ? || ' days')
            AND acknowledged = 1
        `).run(days);
    } catch (err) {
        console.error('Error cleaning old data:', err);
    }
}

// Export functions
module.exports = {
    saveSensorReading,
    saveAlert,
    getHistoricalData,
    getRecentAlerts,
    ackAlert,
    getStatistics,
    cleanOldData,
    db
};