#include <DHT.h>


//i need tro fig a good baude rate and also timing like does this not use much bcs some snsrs dont need constant
// pins
#define LIGHT_PIN A0   // photoresistor voltage divider output
#define MIC_PIN    A1   // analog microphone output
#define DHTPIN     2    // DHT data pin
#define DHTTYPE    DHT11 // change to proper sensor


DHT dht(DHTPIN, DHTTYPE);


//###### ERROR ADD-ON BLOCK START ######
//error flags for sensor failure checking
bool lightError = false;
bool micError = false;
bool dhtError = false;
//###### ERROR ADD-ON BLOCK END ######


// timing since some are slow looking at DHT.... compared to chad light
const unsigned long LIGHT_INTERVAL_MS = 100; //so light is read every 100 ms


// DHT11 cnt b read too fast
const unsigned long DHT_INTERVAL_MS = 2000;


// mic sampled faster
const unsigned long MIC_SAMPLE_US = 1000; // 1000 us = 1 kHz but as u increase rates u get t drift and overload


// Print one CSV row every 2 seconds
const unsigned long LOG_INTERVAL_MS = 2000;


// state
//first block is the timing which will be added or refer to last update (refer to mic code if u need explanation)
unsigned long lastLightReadMs = 0;
unsigned long lastDhtReadMs   = 0;
unsigned long lastMicSampleUs = 0;
unsigned long lastLogMs       = 0;
//data
int lightRaw = 0;
float temperatureC = NAN; //these are for failures from time sensor
float humidityPct = NAN;



// mic stats over each logging window
unsigned long micSampleCount = 0;
unsigned long micSum = 0; //average
int micMin = 1023;
int micMax = 0;


//reset every time u log
void resetMicStats() {
  micSampleCount = 0;
  micSum = 0;
  micMin = 1023;
  micMax = 0;
}


//this is for comms with computer and this is the baud rate
void setup() {
  Serial.begin(115200);
  dht.begin();


  //###### ERROR ADD-ON BLOCK START ######
  // CSV header for Python with error flags
  Serial.println("ms,light_raw,noise_avg,noise_p2p,temp_c,humidity_pct,light_err,mic_err,dht_err");
  //###### ERROR ADD-ON BLOCK END ######
  resetMicStats();
}
//time snapcshot
void loop() {
  unsigned long nowMs = millis();
  unsigned long nowUs = micros();


  // light sensor just checking time passed so it knows what it should be doing and giving data
  if (nowMs - lastLightReadMs >= LIGHT_INTERVAL_MS) {
    lastLightReadMs += LIGHT_INTERVAL_MS;
    lightRaw = analogRead(LIGHT_PIN);


    //###### ERROR ADD-ON BLOCK START ######
    // basic light sensor failure / wiring check
    lightError = false;
    //###### ERROR ADD-ON BLOCK END ######
  }


  // noise sensor
  // Sample mic continuously at about 1 kHz so fixed rate so right below is sample rate
  if (nowUs - lastMicSampleUs >= MIC_SAMPLE_US) {
    lastMicSampleUs += MIC_SAMPLE_US; //steady frequency


    int micValue = analogRead(MIC_PIN);
    micSum += micValue; //average
    micSampleCount++;


    if (micValue < micMin) micMin = micValue;
    if (micValue > micMax) micMax = micValue; //ranges
  }


  // temp and hum
  // DHT11 should be read slowly like right below is it checking like the light sensor
  if (nowMs - lastDhtReadMs >= DHT_INTERVAL_MS) {
    lastDhtReadMs += DHT_INTERVAL_MS;


    float h = dht.readHumidity();
    float t = dht.readTemperature(); // Celsius


    //###### ERROR ADD-ON BLOCK START ######
    dhtError = (isnan(h) || isnan(t));
    if (!dhtError) {
      humidityPct = h;
      temperatureC = t;
    } else {
      humidityPct = NAN;
      temperatureC = NAN;
    }
    //###### ERROR ADD-ON BLOCK END ######
  }


  // printing the data AND '
  //LOGGING BLOCK likewise to light sensor block of checking time so this is every 2 sec
  if (nowMs - lastLogMs >= LOG_INTERVAL_MS) {
    lastLogMs += LOG_INTERVAL_MS;


    int micAvg = 0;
    int micP2P = 0;


    if (micSampleCount > 0) {
      micAvg = micSum / micSampleCount;
      micP2P = micMax - micMin;
    }


    //###### ERROR ADD-ON BLOCK START ######
    // basic mic failure / dead-signal check
    micError = (micSampleCount == 0 || micP2P < 2);
    //###### ERROR ADD-ON BLOCK END ######


    //###### ERROR ADD-ON BLOCK START ######
    int lightToPrint = lightError ? -1 : lightRaw;
    int micAvgToPrint = micError ? -1 : micAvg;
    int micP2PToPrint = micError ? -1 : micP2P;
    //###### ERROR ADD-ON BLOCK END ######


    Serial.print(nowMs);
    Serial.print(",");
    Serial.print(lightToPrint);
    Serial.print(",");
    Serial.print(micAvgToPrint);
    Serial.print(",");
    Serial.print(micP2PToPrint);
    Serial.print(",");


    if (isnan(temperatureC)) Serial.print("nan");
    else Serial.print(temperatureC, 1);


    Serial.print(",");


    if (isnan(humidityPct)) Serial.print("nan");
    else Serial.print(humidityPct, 1);


    //###### ERROR ADD-ON BLOCK START ######
    Serial.print(",");
    Serial.print(lightError ? 1 : 0);
    Serial.print(",");
    Serial.print(micError ? 1 : 0);
    Serial.print(",");
    Serial.println(dhtError ? 1 : 0);
    //###### ERROR ADD-ON BLOCK END ######


    resetMicStats();
  }
}


//using time blocking as seen and also focus on baud rate and timing and sample rates add a failure checl too
// so the data in order is
// millisecs,light reading (raw), noise avg, noise p2p, temp in c, humidity, light error, mic error, dht error