#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>

#define MQTT_MAX_PACKET_SIZE 512

#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>

// Include auto-generated configuration
#include "config.h"

// ===== Pin Definitions =====
#define MQ7_PIN 32          // MQ-7 CO sensor analog output
#define FLAME_PIN 35        // IR flame sensor digital output
#define DHT_PIN 33          // AM2302 (DHT22) data pin
#define PM25_VO_PIN 34      // PM2.5 sensor analog output
#define PM25_LED_PIN 23     // PM2.5 sensor LED control
#define STATUS_LED 2        // Built-in LED for status indication
#define I2C_SDA 19          // I2C SDA pin for SE95
#define I2C_SCL 18          // I2C SCL pin for SE95
#define PIEZO_PIN 4        // Piezo speaker PWM pin

#define SE95_ADDRESS 0x4F   // SE95 temperature sensor I2C address

#define DHT_TYPE DHT22
DHT dht(DHT_PIN, DHT_TYPE);

unsigned long lastPublish = 0;
unsigned long publishInterval = 1000;

struct SensorStates {
    bool mq7 = true;
    bool flame = true;
    bool dht = true;
    bool pm25 = true;
    bool se95 = true;
} sensorsEnabled;

bool statusLedEnabled = true;

constexpr unsigned int PM25_SAMPLING_TIME = 280;
constexpr unsigned int PM25_DELTA_TIME = 40;
constexpr unsigned int PM25_SLEEP_TIME = 9680;

static int lastVoRaw = 0;
static float lastVoVoltage = 0;
static float lastDustDensity = 0;
static auto lastAirQuality = "Good";
static unsigned long lastPM25Read = 0;

WiFiClient espClient;
PubSubClient mqttClient(espClient);

void connectWiFi();
void connectMQTT();
void publishSensorData();
void mqttCallback(const char* topic, const byte* payload, unsigned int length);
void handleRateControl(const char* payload);
void handleEnableControl(const char* payload);

void setup() {
    Serial.begin(115200);
    delay(1000);

    Serial.println("\n=== ESP32 Sensor Monitor ===");
    Serial.println("Initializing...");

    Wire.begin(I2C_SDA, I2C_SCL);
    Serial.println("I2C initialized (SDA=19, SCL=18)");

    dht.begin();
    Serial.println("DHT22 initialized");

    pinMode(MQ7_PIN, INPUT);
    pinMode(FLAME_PIN, INPUT);
    pinMode(PM25_VO_PIN, INPUT);
    pinMode(PM25_LED_PIN, OUTPUT);
    pinMode(STATUS_LED, OUTPUT);

    digitalWrite(PM25_LED_PIN, HIGH);

    pinMode(PIEZO_PIN, OUTPUT);

    analogReadResolution(12);
    analogSetAttenuation(ADC_11db);

    WiFiClass::mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.persistent(true);

    connectWiFi();

    mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    mqttClient.setSocketTimeout(15);  // 15 second socket timeout
    mqttClient.setKeepAlive(30);      // 30 second keepalive

    Serial.println("Setup complete!");
}

void loop() {
    if (WiFiClass::status() != WL_CONNECTED) {
        Serial.println("WiFi connection lost! Reconnecting...");
        connectWiFi();
    }

    static unsigned long lastBlink = 0;

    if (statusLedEnabled) {
        if (!mqttClient.connected()) {
            if (millis() - lastBlink > 200) {
                digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));
                lastBlink = millis();
            }
            connectMQTT();
        } else {
            if (millis() - lastBlink > 1000) {
                digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));
                lastBlink = millis();
            }
        }
    } else {
        if (!mqttClient.connected()) {
            connectMQTT();
        }
    }

    mqttClient.loop();

    const unsigned long currentTime = millis();
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
    while (WiFiClass::status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFiClass::status() == WL_CONNECTED) {
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

    if (millis() - lastAttempt < 5000) {
        return;
    }
    lastAttempt = millis();

    if (WiFiClass::status() != WL_CONNECTED) {
        Serial.println("WiFi not connected, skipping MQTT connection attempt");
        return;
    }

    Serial.print("Attempting MQTT connection to ");
    Serial.print(MQTT_SERVER);
    Serial.print(":");
    Serial.println(MQTT_PORT);

    delay(100);

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
        mqttClient.subscribe(TOPIC_CONTROL_LED);
        Serial.println("Subscribed to: home/sensors/control/led");
    } else {
        Serial.print("MQTT connection failed, rc=");
        Serial.println(mqttClient.state());
    }
}

void playTone(const int frequency, const int duration) {
    if (frequency > 0) {
        ledcSetup(0, frequency, 8);
        ledcAttachPin(PIEZO_PIN, 0);
        ledcWrite(0, 128);
        delay(duration);
        ledcWrite(0, 0);
    } else {
        delay(duration);
    }
}

void playAlarm() {
    for (int i = 0; i < 3; i++) {
        playTone(1000, 200);
        playTone(500, 200);
    }
}

void playWarning() {
    playTone(800, 500);
}

void mqttCallback(const char* topic, const byte* payload, const unsigned int length) {
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
    } else if (strcmp(topic, TOPIC_CONTROL_LED) == 0) {
        if (strcmp(message, "on") == 0) {
            statusLedEnabled = true;
            Serial.println("Status LED enabled");
        } else if (strcmp(message, "off") == 0) {
            statusLedEnabled = false;
            digitalWrite(STATUS_LED, LOW);
            Serial.println("Status LED disabled");
        }
    }
}

void handleRateControl(const char* payload) {
    Serial.print("Received rate control command: ");
    Serial.println(payload);

    char *endptr;
    const long val = strtol(payload, &endptr, 10);

    const auto newRate = static_cast<unsigned long>(val);

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
    const DeserializationError error = deserializeJson(doc, payload);

    if (error) {
        Serial.print("JSON parsing failed: ");
        Serial.println(error.c_str());
        return;
    }

    const char* sensor = doc["sensor"];
    const bool enabled = doc["enabled"];

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

    if (sensorsEnabled.mq7) {
        const int mq7Raw = analogRead(MQ7_PIN);
        const float mq7Voltage = static_cast<float>(mq7Raw) * (3.3f / 4095.0f);

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

    if (sensorsEnabled.flame) {
        const int flameDetected = digitalRead(FLAME_PIN);

        const char* flameStatus;
        if (flameDetected == HIGH) {
            flameStatus = "FIRE DETECTED";
            playAlarm();
        } else {
            flameStatus = "Normal";
        }

        char payload[150];
        snprintf(payload, sizeof(payload),
                 R"({"sensor":"flame","type":"ir","detected":%s,"status":"%s"})",
                 flameDetected == LOW ? "true" : "false", flameStatus);

        mqttClient.publish(TOPIC_SENSORS, payload);
    }

    if (sensorsEnabled.dht) {
        const float temperature = dht.readTemperature();
        const float humidity = dht.readHumidity();

        if (!isnan(temperature) && !isnan(humidity)) {
            const char* tempStatus;
            if (temperature < 15) tempStatus = "Cold";
            else if (temperature < 20) tempStatus = "Cool";
            else if (temperature < 25) tempStatus = "Comfortable";
            else if (temperature < 30) tempStatus = "Warm";
            else tempStatus = "Hot";

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

    if (sensorsEnabled.pm25) {
        const unsigned long now = millis();

        if (now - lastPM25Read >= 10) {
            digitalWrite(PM25_LED_PIN, LOW);
            delayMicroseconds(PM25_SAMPLING_TIME);

            lastVoRaw = analogRead(PM25_VO_PIN);

            delayMicroseconds(PM25_DELTA_TIME);
            digitalWrite(PM25_LED_PIN, HIGH);
            delayMicroseconds(PM25_SLEEP_TIME);

            lastVoVoltage = static_cast<float>(lastVoRaw) * (3.3f / 4095.0f);
            const float sensorVoltage = lastVoVoltage * (5.0f / 3.3f);
            constexpr float cleanAirVoltage = 2.2f;
            lastDustDensity = max(0.0f, (sensorVoltage - cleanAirVoltage) * 0.17f);
            if (lastDustDensity < 0) lastDustDensity = 0;

            const float dustUgM3 = lastDustDensity * 1000;
            if (dustUgM3 <= 12.0) lastAirQuality = "Good";
            else if (dustUgM3 <= 35.4) lastAirQuality = "Moderate";
            else if (dustUgM3 <= 55.4) lastAirQuality = "Unhealthy (Sensitive)";
            else if (dustUgM3 <= 150.4) lastAirQuality = "Unhealthy";
            else if (dustUgM3 <= 250.4) lastAirQuality = "Very Unhealthy";
            else lastAirQuality = "Hazardous";

            lastPM25Read = now;
        }

        char payload[200];
        snprintf(payload, sizeof(payload),
                 R"({"sensor":"pm25","type":"dust","raw":%d,"voltage":%.2f,"dust":%.2f,"quality":"%s"})",
                 lastVoRaw, lastVoVoltage, lastDustDensity, lastAirQuality);

        mqttClient.publish(TOPIC_SENSORS, payload);
    }

    if (sensorsEnabled.se95) {
        Wire.beginTransmission(SE95_ADDRESS);
        Wire.write(0x00);
        const byte error = Wire.endTransmission();

        if (error == 0) {
            Wire.requestFrom(SE95_ADDRESS, 2);

            if (Wire.available() >= 2) {
                const int a = Wire.read();
                const int b = Wire.read();
                const auto temp = static_cast<float>(a + (static_cast<float>(b) / 256.0));

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