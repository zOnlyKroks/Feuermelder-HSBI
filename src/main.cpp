#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>

// Configure MQTT buffer size before including PubSubClient
#define MQTT_MAX_PACKET_SIZE 512

#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>

// ===== WiFi Configuration =====
const char* WIFI_SSID = "Rades";
const char* WIFI_PASSWORD = "0368647844490928";

// ===== MQTT Configuration =====
const char* MQTT_SERVER = "192.168.178.49";
const int MQTT_PORT = 1883;
const char* MQTT_CLIENT_ID = "ESP32_Feuermelder";
const char* MQTT_USER = "";
const char* MQTT_PASSWORD = "";

// ===== MQTT Topics =====
const char* TOPIC_SENSORS = "home/sensors/data";  // Unified topic
const char* TOPIC_STATUS = "home/sensors/status";
const char* TOPIC_CONTROL_RATE = "home/sensors/control/rate";
const char* TOPIC_CONTROL_ENABLE = "home/sensors/control/enable";
const char* TOPIC_CONTROL_BUZZER = "home/sensors/control/buzzer";

// ===== Pin Definitions =====
#define MQ7_PIN 32          // MQ-7 CO sensor analog output
#define FLAME_PIN 35        // IR flame sensor analog output
#define DHT_PIN 15          // AM2302 (DHT22) data pin
#define PM25_VO_PIN 34      // PM2.5 sensor analog output
#define PM25_LED_PIN 23     // PM2.5 sensor LED control
#define STATUS_LED 2        // Built-in LED for status indication
#define I2C_SDA 19          // I2C SDA pin for SE95
#define I2C_SCL 18          // I2C SCL pin for SE95
#define PIEZO_PIN 25        // Piezo speaker PWM pin

// ===== I2C Sensor Configuration =====
#define SE95_ADDRESS 0x4F   // SE95 temperature sensor I2C address

// ===== Sensor Configuration =====
#define DHT_TYPE DHT22
DHT dht(DHT_PIN, DHT_TYPE);

// ===== Runtime Configuration =====
unsigned long lastPublish = 0;
unsigned long publishInterval = 100;  // Dynamic polling rate (100ms default)

// Sensor enable/disable flags
struct SensorStates {
    bool mq7 = true;
    bool flame = true;
    bool dht = true;
    bool pm25 = true;
    bool se95 = true;
} sensorsEnabled;

// PM2.5 sensor timing parameters
const unsigned int PM25_SAMPLING_TIME = 280;
const unsigned int PM25_DELTA_TIME = 40;
const unsigned int PM25_SLEEP_TIME = 9680;

// ===== WiFi and MQTT Clients =====
WiFiClient espClient;
PubSubClient mqttClient(espClient);

// ===== Function Declarations =====
void connectWiFi();
void connectMQTT();
void publishSensorData();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void handleRateControl(const char* payload);
void handleEnableControl(const char* payload);

void setup() {
    Serial.begin(115200);
    delay(1000);

    Serial.println("\n=== ESP32 Sensor Monitor ===");
    Serial.println("Initializing...");

    // Initialize I2C for SE95 sensor
    Wire.begin(I2C_SDA, I2C_SCL);
    Serial.println("I2C initialized (SDA=19, SCL=18)");

    // Initialize sensors
    dht.begin();
    Serial.println("DHT22 initialized");

    // Configure analog pins
    pinMode(MQ7_PIN, INPUT);
    pinMode(FLAME_PIN, INPUT);
    pinMode(PM25_VO_PIN, INPUT);
    pinMode(PM25_LED_PIN, OUTPUT);
    pinMode(STATUS_LED, OUTPUT);

    // Initialize PM2.5 LED to OFF (HIGH)
    digitalWrite(PM25_LED_PIN, HIGH);

    pinMode(PIEZO_PIN, OUTPUT);

    // Configure ADC for better readings
    analogReadResolution(12);  // 12-bit resolution (0-4095)
    analogSetAttenuation(ADC_11db);  // Full 0-3.3V range

    // Configure WiFi with auto-reconnect
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.persistent(true);

    // Connect to WiFi
    connectWiFi();

    // Configure MQTT
    mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    mqttClient.setSocketTimeout(15);  // 15 second socket timeout
    mqttClient.setKeepAlive(30);      // 30 second keepalive

    Serial.println("Setup complete!");
}

void loop() {
    // Check WiFi connection and auto-reconnect
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFi connection lost! Reconnecting...");
        connectWiFi();
    }

    // LED status indicator
    static unsigned long lastBlink = 0;

    if (!mqttClient.connected()) {
        // Not connected - fast blink (200ms)
        if (millis() - lastBlink > 200) {
            digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));
            lastBlink = millis();
        }
        connectMQTT();
    } else {
        // Connected - slow blink (1000ms)
        if (millis() - lastBlink > 1000) {
            digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));
            lastBlink = millis();
        }
    }

    mqttClient.loop();

    // Publish sensor data at dynamic intervals
    unsigned long currentTime = millis();
    if (currentTime - lastPublish >= publishInterval) {
        publishSensorData();
        lastPublish = currentTime;
    }
}

void connectWiFi() {
    Serial.print("Connecting to WiFi: ");
    Serial.println(WIFI_SSID);

    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWiFi connected!");
        Serial.print("IP address: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("\nWiFi connection failed!");
        Serial.println("Please check credentials and reset device.");
    }
}

void connectMQTT() {
    static unsigned long lastAttempt = 0;

    // Try to reconnect only every 5 seconds
    if (millis() - lastAttempt < 5000) {
        return;
    }
    lastAttempt = millis();

    // Check WiFi connection first
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFi not connected, skipping MQTT connection attempt");
        return;
    }

    Serial.print("Attempting MQTT connection to ");
    Serial.print(MQTT_SERVER);
    Serial.print(":");
    Serial.println(MQTT_PORT);

    // Small delay to ensure network stack is ready
    delay(100);

    // Attempt to connect
    bool connected;
    if (strlen(MQTT_USER) > 0) {
        connected = mqttClient.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASSWORD);
    } else {
        connected = mqttClient.connect(MQTT_CLIENT_ID);
    }

    if (connected) {
        Serial.println("MQTT connected successfully!");
        mqttClient.publish(TOPIC_STATUS, "online");
        Serial.println("Published status: online");
        mqttClient.subscribe(TOPIC_CONTROL_RATE);
        Serial.println("Subscribed to: home/sensors/control/rate");
        mqttClient.subscribe(TOPIC_CONTROL_ENABLE);
        Serial.println("Subscribed to: home/sensors/control/enable");
        mqttClient.subscribe(TOPIC_CONTROL_BUZZER);
        Serial.println("Subscribed to: home/sensors/control/buzzer");
    } else {
        Serial.print("MQTT connection failed, rc=");
        Serial.println(mqttClient.state());
    }
}

void playTone(const int frequency, const int duration) {
    if (frequency > 0) {
        ledcSetup(0, frequency, 8);  // Channel 0, 8-bit resolution
        ledcAttachPin(PIEZO_PIN, 0);
        ledcWrite(0, 128);  // 50% duty cycle
        delay(duration);
        ledcWrite(0, 0);  // Stop tone
    } else {
        delay(duration);  // Rest
    }
}

void playAlarm() {
    // Simple two-tone alarm
    for (int i = 0; i < 3; i++) {
        playTone(1000, 200);  // High beep
        playTone(500, 200);   // Low beep
    }
}

void playWarning() {
    playTone(800, 500);  // Single warning beep
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
    // Convert payload to string
    char message[length + 1];
    memcpy(message, payload, length);
    message[length] = '\0';

    // Handle different control topics
    if (strcmp(topic, TOPIC_CONTROL_RATE) == 0) {
        handleRateControl(message);
    } else if (strcmp(topic, TOPIC_CONTROL_ENABLE) == 0) {
        handleEnableControl(message);
    } else if (strcmp(topic, TOPIC_CONTROL_BUZZER) == 0) {
        if (strcmp(message, "alarm") == 0) playAlarm();
        else if (strcmp(message, "warning") == 0) playWarning();
        else if (strcmp(message, "test") == 0) playTone(1000, 100);
    }
}

void handleRateControl(const char* payload) {
    Serial.print("Received rate control command: ");
    Serial.println(payload);

    unsigned long newRate = atol(payload);

    if (newRate >= 100 && newRate <= 60000) {
        publishInterval = newRate;
        Serial.print("✓ Polling rate updated to: ");
        Serial.print(publishInterval);
        Serial.println(" ms");
    } else {
        Serial.print("✗ Invalid polling rate: ");
        Serial.print(newRate);
        Serial.println(" (must be between 100 and 60000 ms)");
    }
}

void handleEnableControl(const char* payload) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (error) {
        Serial.print("JSON parsing failed: ");
        Serial.println(error.c_str());
        return;
    }

    const char* sensor = doc["sensor"];
    bool enabled = doc["enabled"];

    if (strcmp(sensor, "mq7") == 0) {
        sensorsEnabled.mq7 = enabled;
        Serial.print("MQ-7 sensor ");
        Serial.println(enabled ? "enabled" : "disabled");
    } else if (strcmp(sensor, "flame") == 0) {
        sensorsEnabled.flame = enabled;
        Serial.print("Flame sensor ");
        Serial.println(enabled ? "enabled" : "disabled");
    } else if (strcmp(sensor, "dht") == 0) {
        sensorsEnabled.dht = enabled;
        Serial.print("DHT22 sensor ");
        Serial.println(enabled ? "enabled" : "disabled");
    } else if (strcmp(sensor, "pm25") == 0) {
        sensorsEnabled.pm25 = enabled;
        Serial.print("PM2.5 sensor ");
        Serial.println(enabled ? "enabled" : "disabled");
    } else if (strcmp(sensor, "se95") == 0) {
        sensorsEnabled.se95 = enabled;
        Serial.print("SE95 sensor ");
        Serial.println(enabled ? "enabled" : "disabled");
    }
}

void publishSensorData() {
    if (!mqttClient.connected()) {
        return;
    }

    // Read and publish MQ-7 CO sensor
    if (sensorsEnabled.mq7) {
        int mq7Raw = analogRead(MQ7_PIN);
        float mq7Voltage = mq7Raw * (3.3 / 4095.0);

        // Interpret CO level
        const char* coLevel;
        if (mq7Voltage < 0.3) coLevel = "Good";
        else if (mq7Voltage < 0.6) coLevel = "Moderate";
        else if (mq7Voltage < 1.0) {
            coLevel = "High";
            playWarning();
        }
        else {
            coLevel = "Dangerous";
            playAlarm();
        }

        char payload[150];
        snprintf(payload, sizeof(payload),
                 R"({"sensor":"mq7","type":"co","raw":%d,"voltage":%.2f,"level":"%s"})",
                 mq7Raw, mq7Voltage, coLevel);

        mqttClient.publish(TOPIC_SENSORS, payload);
    }

    // Read and publish IR flame sensor
    if (sensorsEnabled.flame) {
        int flameRaw = analogRead(FLAME_PIN);
        float flameVoltage = flameRaw * (3.3 / 4095.0);

        // Interpret flame detection (lower value = more IR detected)
        const char* flameStatus;
        if (flameRaw < 1000) {
            flameStatus = "FIRE DETECTED";
            playAlarm();
        }
        else if (flameRaw < 2000) flameStatus = "Heat Source";
        else flameStatus = "Normal";

        char payload[150];
        snprintf(payload, sizeof(payload),
                 R"({"sensor":"flame","type":"ir","raw":%d,"voltage":%.2f,"status":"%s"})",
                 flameRaw, flameVoltage, flameStatus);

        mqttClient.publish(TOPIC_SENSORS, payload);
    }

    // Read and publish DHT22 sensor
    if (sensorsEnabled.dht) {
        float temperature = dht.readTemperature();
        float humidity = dht.readHumidity();

        if (!isnan(temperature) && !isnan(humidity)) {
            // Interpret temperature
            const char* tempStatus;
            if (temperature < 15) tempStatus = "Cold";
            else if (temperature < 20) tempStatus = "Cool";
            else if (temperature < 25) tempStatus = "Comfortable";
            else if (temperature < 30) tempStatus = "Warm";
            else tempStatus = "Hot";

            // Interpret humidity
            const char* humidStatus;
            if (humidity < 30) humidStatus = "Dry";
            else if (humidity < 60) humidStatus = "Comfortable";
            else if (humidity < 70) humidStatus = "Humid";
            else humidStatus = "Very Humid";

            char payload[200];
            snprintf(payload, sizeof(payload),
                     R"({"sensor":"dht22","type":"temp_humidity","temp":%.1f,"humidity":%.1f,"tempStatus":"%s","humidStatus":"%s"})",
                     temperature, humidity, tempStatus, humidStatus);

            mqttClient.publish(TOPIC_SENSORS, payload);
        } else {
            Serial.println("⚠ DHT22: Failed to read sensor!");
        }
    }

    // Read and publish PM2.5 sensor
    if (sensorsEnabled.pm25) {
        // Cache for last reading
        static int lastVoRaw = 0;
        static float lastVoVoltage = 0;
        static float lastDustDensity = 0;
        static const char* lastAirQuality = "Good";
        static unsigned long lastPM25Read = 0;

        // Only read sensor every 10ms (sensor cycle time)
        unsigned long now = millis();
        if (now - lastPM25Read >= 10) {
            // Turn on LED
            digitalWrite(PM25_LED_PIN, LOW);
            delayMicroseconds(PM25_SAMPLING_TIME);

            lastVoRaw = analogRead(PM25_VO_PIN);

            delayMicroseconds(PM25_DELTA_TIME);
            digitalWrite(PM25_LED_PIN, HIGH);
            delayMicroseconds(PM25_SLEEP_TIME);

            lastVoVoltage = lastVoRaw * (3.3 / 4095.0);
            float sensorVoltage = lastVoVoltage * (5.0 / 3.3);
            lastDustDensity = 0.17 * sensorVoltage - 0.1;
            if (lastDustDensity < 0) lastDustDensity = 0;

            // Convert to µg/m³ and interpret air quality (EPA standard)
            float dustUgM3 = lastDustDensity * 1000;
            if (dustUgM3 < 12) lastAirQuality = "Good";
            else if (dustUgM3 < 35.4) lastAirQuality = "Moderate";
            else if (dustUgM3 < 55.4) lastAirQuality = "Unhealthy (Sensitive)";
            else if (dustUgM3 < 150.4) lastAirQuality = "Unhealthy";
            else if (dustUgM3 < 250.4) lastAirQuality = "Very Unhealthy";
            else lastAirQuality = "Hazardous";

            lastPM25Read = now;
        }

        // Always publish last known good reading
        char payload[200];
        snprintf(payload, sizeof(payload),
                 R"({"sensor":"pm25","type":"dust","raw":%d,"voltage":%.2f,"dust":%.2f,"quality":"%s"})",
                 lastVoRaw, lastVoVoltage, lastDustDensity, lastAirQuality);

        mqttClient.publish(TOPIC_SENSORS, payload);
    }

    // Read and publish SE95 I2C temperature sensor
    if (sensorsEnabled.se95) {
        Wire.beginTransmission(SE95_ADDRESS);
        Wire.write(0x00);  // Temperature register
        byte error = Wire.endTransmission();

        if (error == 0) {
            Wire.requestFrom(SE95_ADDRESS, 2);

            if (Wire.available() >= 2) {
                int a = Wire.read();
                int b = Wire.read();
                float temp = a + (static_cast<float>(b) / 256.0);

                // Interpret temperature
                const char* tempStatus;
                if (temp < 15) tempStatus = "Cold";
                else if (temp < 20) tempStatus = "Cool";
                else if (temp < 25) tempStatus = "Comfortable";
                else if (temp < 30) tempStatus = "Warm";
                else tempStatus = "Hot";

                char payload[150];
                snprintf(payload, sizeof(payload),
                         R"({"sensor":"se95","type":"temp","temp":%.2f,"status":"%s"})",
                         temp, tempStatus);

                mqttClient.publish(TOPIC_SENSORS, payload);
            }
        } else {
            Serial.print("⚠ SE95: I2C error ");
            Serial.println(error);
        }
    }
}