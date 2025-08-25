// Plugin/WeatherReporter/weather-reporter.js
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');
// const fetch = require('node-fetch'); // Use require for node-fetch - Removed

// Load main config.env from project root
dotenv.config({ path: path.resolve(__dirname, '../../config.env') });

// Load plugin-specific config.env
dotenv.config({ path: path.join(__dirname, 'config.env') });

const CACHE_FILE_PATH = path.join(__dirname, 'weather_cache.txt');
const JSON_CACHE_FILE_PATH = path.join(__dirname, 'weather_cache.json');
const CITY_CACHE_FILE_PATH = path.join(__dirname, 'city_cache.txt');

// --- Start QWeather API Functions ---

// Function to read city cache
async function readCityCache() {
    try {
        const data = await fs.readFile(CITY_CACHE_FILE_PATH, 'utf-8');
        const cache = new Map();
        data.split('\n').forEach(line => {
            if (!line) return;
            const separatorIndex = line.indexOf(':');
            if (separatorIndex === -1) return;

            const cityName = line.substring(0, separatorIndex).trim();
            const cityJson = line.substring(separatorIndex + 1).trim();

            if (cityName && cityJson) {
                try {
                    cache.set(cityName, JSON.parse(cityJson));
                } catch (e) {
                    console.error(`[WeatherReporter] Failed to parse city cache for ${cityName}:`, e.message);
                }
            }
        });
        console.error(`[WeatherReporter] Successfully read city cache from ${CITY_CACHE_FILE_PATH}`);
        return cache;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error(`[WeatherReporter] Error reading city cache file ${CITY_CACHE_FILE_PATH}:`, error.message);
        }
        return new Map(); // Return empty map if file doesn't exist or error occurs
    }
}

// Function to write city cache
async function writeCityCache(cityName, cityInfo) {
    try {
        const cityJson = JSON.stringify(cityInfo);
        // Append to the file, creating it if it doesn't exist
        await fs.appendFile(CITY_CACHE_FILE_PATH, `${cityName}:${cityJson}\n`, 'utf-8');
        console.error(`[WeatherReporter] Successfully wrote city cache for ${cityName} to ${CITY_CACHE_FILE_PATH}`);
    } catch (error) {
        console.error(`[WeatherReporter] Error writing city cache file ${CITY_CACHE_FILE_PATH}:`, error.message);
    }
}

// Function to get City Info from city name
async function getCityInfo(cityName, weatherKey, weatherUrl) {
    const { default: fetch } = await import('node-fetch'); // Dynamic import
    if (!cityName || !weatherKey || !weatherUrl) {
        console.error('[WeatherReporter] City name, Weather Key or Weather URL is missing for getCityInfo.');
        return { success: false, data: null, error: new Error('Missing parameters for getCityInfo.') };
    }

    // Check cache first
    const cityCache = await readCityCache();
    if (cityCache.has(cityName)) {
       const cachedCityInfo = cityCache.get(cityName);
       // Add validation for the cached data
       if (typeof cachedCityInfo === 'object' && cachedCityInfo !== null && cachedCityInfo.id && cachedCityInfo.lat && cachedCityInfo.lon && cachedCityInfo.utcOffset) {
           console.error(`[WeatherReporter] Using valid cached city info for ${cityName}`);
           return { success: true, data: cachedCityInfo, error: null };
       } else {
           console.error(`[WeatherReporter] Invalid or incomplete cached city info for ${cityName}. Refetching...`);
           // If cache is invalid, proceed to fetch from API as if cache didn't exist.
       }
   }

    const lookupUrl = `https://${weatherUrl}/geo/v2/city/lookup?location=${encodeURIComponent(cityName)}&key=${weatherKey}`;

    try {
        console.error(`[WeatherReporter] Fetching city info for: ${cityName}`);
        const response = await fetch(lookupUrl, { timeout: 10000 }); // 10s timeout

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`QWeather City Lookup API failed: ${response.status} ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
        if (data.code === '200' && data.location && data.location.length > 0) {
            const cityInfo = data.location[0]; // Get the first and most relevant city object
            console.error(`[WeatherReporter] Successfully found city info for ${cityName}: ID ${cityInfo.id}`);
            // Write to cache
            await writeCityCache(cityName, cityInfo);
            return { success: true, data: cityInfo, error: null };
        } else {
             const errorMsg = data.code === '200' ? 'No location found' : `API returned code ${data.code}`;
             throw new Error(`Failed to get city info for ${cityName}. ${errorMsg}`);
        }

    } catch (error) {
        console.error(`[WeatherReporter] Error fetching city info: ${error.message}`);
        return { success: false, data: null, error: error };
    }
}

// Function to get Current Weather from City ID
async function getCurrentWeather(cityId, weatherKey, weatherUrl) {
    const { default: fetch } = await import('node-fetch'); // Dynamic import
    if (!cityId || !weatherKey || !weatherUrl) {
        console.error('[WeatherReporter] City ID, Weather Key or Weather URL is missing for getCurrentWeather.');
        return { success: false, data: null, error: new Error('Missing parameters for getCurrentWeather.') };
    }

    const weatherUrlEndpoint = `https://${weatherUrl}/v7/weather/now?location=${cityId}&key=${weatherKey}`;

    try {
        console.error(`[WeatherReporter] Fetching current weather for city ID: ${cityId}`);
        const response = await fetch(weatherUrlEndpoint, { timeout: 10000 }); // 10s timeout

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`QWeather Current Weather API failed: ${response.status} ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
         if (data.code === '200' && data.now) {
            console.error(`[WeatherReporter] Successfully fetched current weather for ${cityId}.`);
            return { success: true, data: data.now, error: null };
        } else {
             throw new Error(`Failed to get current weather for ${cityId}. API returned code ${data.code}`);
        }

    } catch (error) {
        console.error(`[WeatherReporter] Error fetching current weather: ${error.message}`);
        return { success: false, data: null, error: error };
    }
}

// Function to get N-day Forecast from City ID
async function getNDayForecast(cityId, weatherKey, weatherUrl, days = 7) {
    const { default: fetch } = await import('node-fetch'); // Dynamic import
    if (!cityId || !weatherKey || !weatherUrl) {
        console.error('[WeatherReporter] City ID, Weather Key or Weather URL is missing for getNDayForecast.');
        return { success: false, data: null, error: new Error('Missing parameters for getNDayForecast.') };
    }

    // Determine the correct API endpoint based on the number of days
    let endpoint;
    if (days <= 3) {
        endpoint = '3d';
    } else if (days <= 7) {
        endpoint = '7d';
    } else if (days <= 10) {
        endpoint = '10d';
    } else if (days <= 15) {
        endpoint = '15d';
    } else {
        // Fallback to 7 days if the requested number is out of a reasonable range
        console.warn(`[WeatherReporter] Requested forecast days (${days}) is out of typical range, falling back to 7 days.`);
        endpoint = '7d';
    }

    const forecastUrlEndpoint = `https://${weatherUrl}/v7/weather/${endpoint}?location=${cityId}&key=${weatherKey}`;

    try {
        console.error(`[WeatherReporter] Fetching ${days}-day forecast for city ID: ${cityId}`);
        const response = await fetch(forecastUrlEndpoint, { timeout: 10000 }); // 10s timeout

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`QWeather 7-day Forecast API failed: ${response.status} ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
        if (data.code === '200' && data.daily) {
            console.error(`[WeatherReporter] Successfully fetched ${days}-day forecast for ${cityId}.`);
            return { success: true, data: data.daily, error: null };
        } else {
            throw new Error(`Failed to get ${days}-day forecast for ${cityId}. API returned code ${data.code}`);
        }

    } catch (error) {
        console.error(`[WeatherReporter] Error fetching ${days}-day forecast: ${error.message}`);
        return { success: false, data: null, error: error };
    }
}

// Function to get 24-hour Forecast from City ID
async function get24HourForecast(cityId, weatherKey, weatherUrl) {
    const { default: fetch } = await import('node-fetch'); // Dynamic import
     if (!cityId || !weatherKey || !weatherUrl) {
        console.error('[WeatherReporter] City ID, Weather Key or Weather URL is missing for get24HourForecast.');
        return { success: false, data: null, error: new Error('Missing parameters for get24HourForecast.') };
    }

    const forecastUrlEndpoint = `https://${weatherUrl}/v7/weather/24h?location=${cityId}&key=${weatherKey}`;

    try {
        console.error(`[WeatherReporter] Fetching 24-hour forecast for city ID: ${cityId}`);
        const response = await fetch(forecastUrlEndpoint, { timeout: 10000 }); // 10s timeout

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`QWeather 24-hour Forecast API failed: ${response.status} ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
         if (data.code === '200' && data.hourly) {
            console.error(`[WeatherReporter] Successfully fetched 24-hour forecast for ${cityId}.`);
            return { success: true, data: data.hourly, error: null };
        } else {
             throw new Error(`Failed to get 24-hour forecast for ${cityId}. API returned code ${data.code}`);
        }

    } catch (error) {
        console.error(`[WeatherReporter] Error fetching 24-hour forecast: ${error.message}`);
        return { success: false, data: null, error: error };
    }
}

// Function to get Weather Warning from City ID
async function getWeatherWarning(cityId, weatherKey, weatherUrl) {
    const { default: fetch } = await import('node-fetch'); // Dynamic import
     if (!cityId || !weatherKey || !weatherUrl) {
        console.error('[WeatherReporter] City ID, Weather Key or Weather URL is missing for getWeatherWarning.');
        return { success: false, data: null, error: new Error('Missing parameters for getWeatherWarning.') };
    }

    const warningUrlEndpoint = `https://${weatherUrl}/v7/warning/now?location=${cityId}&key=${weatherKey}`;

    try {
        console.error(`[WeatherReporter] Fetching weather warning for city ID: ${cityId}`);
        const response = await fetch(warningUrlEndpoint, { timeout: 10000 }); // 10s timeout

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`QWeather Weather Warning API failed: ${response.status} ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
         if (data.code === '200') {
            console.error(`[WeatherReporter] Successfully fetched weather warning for ${cityId}.`);
            // The 'warning' field might be empty if no warnings exist
            return { success: true, data: data.warning || [], error: null };
        } else {
             throw new Error(`Failed to get weather warning for ${cityId}. API returned code ${data.code}`);
        }

    } catch (error) {
        console.error(`[WeatherReporter] Error fetching weather warning: ${error.message}`);
        return { success: false, data: null, error: error };
    }
}

// Function to get Moon Phase from City ID
async function getMoonPhase(cityId, weatherKey, weatherUrl) {
    const { default: fetch } = await import('node-fetch'); // Dynamic import
    if (!cityId || !weatherKey || !weatherUrl) {
        console.error('[WeatherReporter] City ID, Weather Key or Weather URL is missing for getMoonPhase.');
        return { success: false, data: null, error: new Error('Missing parameters for getMoonPhase.') };
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const moonPhaseUrlEndpoint = `https://${weatherUrl}/v7/astronomy/moon?location=${cityId}&date=${today}&key=${weatherKey}`;

    try {
        console.error(`[WeatherReporter] Fetching moon phase for city ID: ${cityId}`);
        const response = await fetch(moonPhaseUrlEndpoint, { timeout: 10000 }); // 10s timeout

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`QWeather Moon Phase API failed: ${response.status} ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
        if (data.code === '200') {
            console.error(`[WeatherReporter] Successfully fetched moon phase for ${cityId}.`);
            return { success: true, data: data, error: null };
        } else {
            throw new Error(`Failed to get moon phase for ${cityId}. API returned code ${data.code}`);
        }

    } catch (error) {
        console.error(`[WeatherReporter] Error fetching moon phase: ${error.message}`);
        return { success: false, data: null, error: error };
    }
}

// Function to get Air Quality
async function getAirQuality(latitude, longitude, weatherKey, weatherUrl) {
    const { default: fetch } = await import('node-fetch');
    if (!latitude || !longitude || !weatherKey || !weatherUrl) {
        console.error('[WeatherReporter] Latitude, Longitude, Weather Key or Weather URL is missing for getAirQuality.');
        return { success: false, data: null, error: new Error('Missing parameters for getAirQuality.') };
    }
    
    const airQualityUrlEndpoint = `https://${weatherUrl}/v7/air/now?location=${longitude},${latitude}&key=${weatherKey}`;

    try {
        console.error(`[WeatherReporter] Fetching air quality for coords: ${latitude},${longitude}`);
        const response = await fetch(airQualityUrlEndpoint, { timeout: 10000 });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Air Quality API failed: ${response.status} ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
        if (data.code === '200') {
            console.error(`[WeatherReporter] Successfully fetched air quality for ${latitude},${longitude}.`);
            return { success: true, data: data.now, error: null };
        } else {
            throw new Error(`Failed to get air quality for ${latitude},${longitude}. Response: ${JSON.stringify(data)}`);
        }

    } catch (error) {
        console.error(`[WeatherReporter] Error fetching air quality: ${error.message}`);
        return { success: false, data: null, error: error };
    }
}

// Function to get Solar Elevation Angle
async function getSolarElevationAngle(latitude, longitude, altitude, date, time, tz, weatherKey, weatherUrl) {
    const { default: fetch } = await import('node-fetch');
    if (!latitude || !longitude || !altitude || !date || !time || !tz || !weatherKey || !weatherUrl) {
        console.error('[WeatherReporter] One or more parameters are missing for getSolarElevationAngle (lat, lon, alt, date, time, tz, key, url).');
        return { success: false, data: null, error: new Error('Missing parameters for getSolarElevationAngle.') };
    }
    
    const locationString = `${longitude},${latitude}`;
    const solarAngleUrlEndpoint = `https://${weatherUrl}/v7/astronomy/solar-elevation-angle?location=${locationString}&alt=${altitude}&date=${date}&time=${time}&tz=${tz}&key=${weatherKey}`;

    try {
        console.error(`[WeatherReporter] Fetching solar elevation angle for coords: ${locationString}`);
        const response = await fetch(solarAngleUrlEndpoint, { timeout: 10000 });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[WeatherReporter] Solar Angle API request failed: ${response.status} ${errorText.substring(0, 200)}`);
            return { success: false, data: null, error: new Error(`Solar Angle API request failed: ${response.status}`) };
        }

        const data = await response.json();
        if (data.code === '200') {
            console.error(`[WeatherReporter] Successfully fetched solar elevation angle for ${locationString}.`);
            return { success: true, data: data, error: null };
        } else {
            throw new Error(`Failed to get solar elevation angle for ${locationString}. API returned code ${data.code}`);
        }

    } catch (error) {
        console.error(`[WeatherReporter] Error fetching solar elevation angle: ${error.message}`);
        return { success: false, data: null, error: error };
    }
}

// Helper to format weather data into a readable string
function formatWeatherInfo(hourlyForecast, weatherWarning, forecast, moonPhase, airQuality, solarAngle, hourlyForecastInterval, hourlyForecastCount, forecastDays) {
    if (!hourlyForecast && (!weatherWarning || weatherWarning.length === 0) && (!forecast || forecast.length === 0) && !moonPhase && !airQuality && !solarAngle) {
        return "[天气信息获取失败]";
    }

    let result = "";

    // Add Air Quality section
    result += "【实时空气质量】\n";
    if (airQuality) {
        result += `空气质量指数 (AQI): ${airQuality.aqi}\n`;
        result += `主要污染物: ${airQuality.primary === 'NA' ? '无' : airQuality.primary}\n`;
        result += `空气质量等级: ${airQuality.category}\n`;
        result += `PM2.5 浓度: ${airQuality.pm2p5} μg/m³\n`;
    } else {
        result += "空气质量信息获取失败。\n";
    }

    // Add Weather Warning section
    result += "\n【天气预警】\n";
    if (weatherWarning && weatherWarning.length > 0) {
        weatherWarning.forEach(warning => {
            result += `\n标题: ${warning.title}\n`;
            result += `发布时间: ${new Date(warning.pubTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`;
            result += `级别: ${warning.severityColor || '未知'}\n`;
            result += `类型: ${warning.typeName}\n`;
            result += `内容: ${warning.text}\n`;
        });
    } else {
        result += "当前无天气预警信息。\n";
    }

    // Add 24-hour Forecast section
    result += "\n【未来24小时天气预报】\n";
    if (hourlyForecast && hourlyForecast.length > 0) {
        // Use interval and count from config
        for (let i = 0; i < hourlyForecast.length && i < hourlyForecastCount * hourlyForecastInterval; i += hourlyForecastInterval) {
            if (hourlyForecast[i]) {
                const hour = hourlyForecast[i];
                const time = new Date(hour.fxTime).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
                result += `\n时间: ${time}\n`;
                result += `天气: ${hour.text}\n`;
                result += `温度: ${hour.temp}℃\n`;
                result += `风向: ${hour.windDir}\n`;
                result += `风力: ${hour.windScale}级\n`;
                result += `湿度: ${hour.humidity}%\n`;
                result += `降水概率: ${hour.pop}%\n`;
                result += `降水量: ${hour.precip}毫米\n`;
            }
        }
    } else {
        result += "未来24小时天气预报获取失败。\n";
    }

    // Keep N-day Forecast section
    result += `\n【未来${forecastDays}日天气预报】\n`;
    if (forecast && forecast.length > 0) {
        forecast.forEach(day => {
            result += `\n日期: ${day.fxDate}\n`;
            result += `白天: ${day.textDay} (图标: ${day.iconDay}), 最高温: ${day.tempMax}℃, 风向: ${day.windDirDay}, 风力: ${day.windScaleDay}级\n`;
            result += `夜间: ${day.textNight} (图标: ${day.iconNight}), 最低温: ${day.tempMin}℃, 风向: ${day.windDirNight}, 风力: ${day.windScaleNight}级\n`;
            result += `湿度: ${day.humidity}%\n`;
            result += `降水: ${day.precip}毫米\n`;
            result += `紫外线指数: ${day.uvIndex}\n`;
        });
    } else {
         result += `\n未来${forecastDays}日天气预报获取失败。\n`;
    }

    // Add Moon Phase section
    result += "\n【今日月相】\n";
    if (moonPhase && moonPhase.moonPhase && moonPhase.moonPhase.length > 0) {
        const phase = moonPhase.moonPhase[0];
        result += `月相: ${phase.name}\n`;
        result += `月升时间: ${moonPhase.moonrise || '无'}\n`;
        result += `月落时间: ${moonPhase.moonset || '无'}\n`;
    } else {
        result += "今日月相信息获取失败。\n";
    }

    // Add Solar Angle section
    result += "\n【太阳角度】\n";
    if (solarAngle) {
        result += `太阳高度角: ${solarAngle.solarElevationAngle}°\n`;
        result += `太阳方位角: ${solarAngle.solarAzimuthAngle}°\n`;
    } else {
        result += "太阳角度信息获取失败。\n";
    }


    return result.trim();
}

// --- End QWeather API Functions ---


async function getCachedWeather() {
    try {
        const cachedData = await fs.readFile(CACHE_FILE_PATH, 'utf-8');
        // Basic validation: check if it's not an error message itself
        if (cachedData && !cachedData.startsWith("[Error") && !cachedData.startsWith("[天气API请求失败")) {
            return cachedData.trim();
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error(`[WeatherReporter] Error reading cache file ${CACHE_FILE_PATH}:`, error.message);
        }
    }
    return null;
}

async function fetchAndCacheWeather() {
    let lastError = null;

    const varCity = process.env.VarCity;
    const weatherKey = process.env.WeatherKey;
    const weatherUrl = process.env.WeatherUrl;
    const forecastDays = parseInt(process.env.forecastDays, 10) || 7;
    const hourlyForecastInterval = parseInt(process.env.hourlyForecastInterval, 10) || 2;
    const hourlyForecastCount = parseInt(process.env.hourlyForecastCount, 10) || 12;


    if (!varCity || !weatherKey || !weatherUrl) {
        lastError = new Error('天气插件错误：获取天气所需的配置不完整 (VarCity, WeatherKey, WeatherUrl)。');
        console.error(`[WeatherReporter] ${lastError.message}`);
        return { success: false, data: null, error: lastError };
    }

    let cityInfo = null;
    let hourlyForecast = null;
    let weatherWarning = null;
    let forecast = null;
    let moonPhase = null;
    let airQuality = null;
    let solarAngle = null;

    // 1. Get City Info (includes ID, lat, lon)
    const cityResult = await getCityInfo(varCity, weatherKey, weatherUrl);
    if (cityResult.success) {
        cityInfo = cityResult.data;
    } else {
        lastError = cityResult.error;
        console.error(`[WeatherReporter] Failed to get city info: ${lastError.message}`);
        // If we can't get city info, we can't proceed.
        return { success: false, data: null, error: lastError };
    }

    const { id: cityId, lat: latitude, lon: longitude, alt: altitude = '50', tz: timezoneName, utcOffset } = cityInfo;

    // Prepare params for solar angle
    const now = new Date();
    // Use 'sv-SE' format which is 'YYYY-MM-DD HH:mm:ss' and easy to parse
    const localTimeStr = now.toLocaleString('sv-SE', { timeZone: timezoneName });
    const date = localTimeStr.substring(0, 10).replace(/-/g, ''); // YYYYMMDD
    const time = localTimeStr.substring(11, 16).replace(':', ''); // HHmm
    const tzParam = utcOffset.replace(':', '').replace('+', ''); // e.g. +08:00 -> 0800, -05:00 -> -0500

    // 2. Get Air Quality (using lat, lon)
    const airQualityResult = await getAirQuality(latitude, longitude, weatherKey, weatherUrl);
    if (airQualityResult.success) {
        airQuality = airQualityResult.data;
    } else {
        lastError = airQualityResult.error;
        console.error(`[WeatherReporter] Failed to get air quality: ${lastError.message}`);
    }

    // 3. Get Solar Elevation Angle (using lat, lon)
    const solarAngleResult = await getSolarElevationAngle(latitude, longitude, altitude, date, time, tzParam, weatherKey, weatherUrl);
    if (solarAngleResult.success) {
        solarAngle = solarAngleResult.data;
    } else {
        lastError = solarAngleResult.error;
        console.error(`[WeatherReporter] Failed to get solar angle: ${lastError.message}`);
    }

    // 4. Get 24-hour Forecast (using cityId)
    const hourlyResult = await get24HourForecast(cityId, weatherKey, weatherUrl);
    if (hourlyResult.success) {
        hourlyForecast = hourlyResult.data;
    } else {
        lastError = hourlyResult.error;
        console.error(`[WeatherReporter] Failed to get 24-hour forecast: ${lastError.message}`);
    }

    // 5. Get Weather Warning (using cityId)
    const warningResult = await getWeatherWarning(cityId, weatherKey, weatherUrl);
    if (warningResult.success) {
        weatherWarning = warningResult.data;
    } else {
        lastError = warningResult.error;
        console.error(`[WeatherReporter] Failed to get weather warning: ${lastError.message}`);
    }

    // 6. Get N-day Forecast (using cityId)
    const forecastResult = await getNDayForecast(cityId, weatherKey, weatherUrl, forecastDays);
    if (forecastResult.success) {
        forecast = forecastResult.data;
    } else {
        lastError = forecastResult.error;
        console.error(`[WeatherReporter] Failed to get ${forecastDays}-day forecast: ${lastError.message}`);
    }

    // 7. Get Moon Phase (using cityId)
    const moonResult = await getMoonPhase(cityId, weatherKey, weatherUrl);
    if (moonResult.success) {
        moonPhase = moonResult.data;
    } else {
        lastError = moonResult.error;
        console.error(`[WeatherReporter] Failed to get moon phase: ${lastError.message}`);
    }


    // 8. Format and Cache the results
    // Update condition to check for any data
    if (hourlyForecast || weatherWarning || (forecast && forecast.length > 0) || moonPhase || airQuality || solarAngle) {
        // Update function call
        const formattedWeather = formatWeatherInfo(hourlyForecast, weatherWarning, forecast, moonPhase, airQuality, solarAngle, hourlyForecastInterval, hourlyForecastCount, forecastDays);

        // --- New JSON Cache Logic ---
        const rawWeatherData = {
            hourly: hourlyForecast,
            warning: weatherWarning,
            daily: forecast,
            moon: moonPhase,
            airQuality: airQuality,
            solarAngle: solarAngle,
            lastUpdate: new Date().toISOString()
        };
        try {
            await fs.writeFile(JSON_CACHE_FILE_PATH, JSON.stringify(rawWeatherData, null, 2), 'utf-8');
            console.error(`[WeatherReporter] Successfully cached raw weather JSON to ${JSON_CACHE_FILE_PATH}.`);
        } catch (jsonWriteError) {
            console.error(`[WeatherReporter] Error writing to JSON cache file: ${jsonWriteError.message}`);
        }
        // --- End New JSON Cache Logic ---

        try {
            await fs.writeFile(CACHE_FILE_PATH, formattedWeather, 'utf-8');
            console.error(`[WeatherReporter] Successfully fetched, formatted, and cached new weather info.`);
            return { success: true, data: formattedWeather, error: null };
        } catch (writeError) {
            lastError = writeError;
            console.error(`[WeatherReporter] Error writing to cache file: ${writeError.message}`);
            return { success: false, data: formattedWeather, error: lastError }; // Return data even if cache write fails
        }
    } else {
        // If all fetches failed
        lastError = lastError || new Error("未能获取天气信息 (24小时预报, 预警, 7日预报, 月相, 空气质量, 太阳角度)。");
        console.error(`[WeatherReporter] ${lastError.message}`);
        return { success: false, data: null, error: lastError };
    }
}

async function main() {
    const apiResult = await fetchAndCacheWeather();

    if (apiResult.success && apiResult.data) {
        process.stdout.write(apiResult.data);
        process.exit(0);
    } else {
        // API failed, try to use cache
        const cachedData = await getCachedWeather();
        if (cachedData) {
            console.warn("[WeatherReporter] API fetch failed, using stale cache.");
            process.stdout.write(cachedData);
            process.exit(0); // Exit 0 because we are providing data, albeit stale.
        } else {
            // API failed AND no cache available
            const errorMessage = `[天气API请求失败且无可用缓存: ${apiResult.error ? apiResult.error.message.substring(0,100) : '未知错误'}]`;
            console.error(`[WeatherReporter] ${errorMessage}`);
            process.stdout.write(errorMessage); // Output error to stdout so Plugin.js can use it as placeholder
            process.exit(1); // Exit 1 to indicate to Plugin.js that the update truly failed to produce a usable value.
        }
    }
}

if (require.main === module) {
    main();
}