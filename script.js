const $ = (sel) => document.querySelector(sel);
const unitBtn = $('#unitBtn');
const state = { unit: 'C', last: null, place: null };

// ——— Weather codes to label + emoji ———
function codeToIconLabel(code) {
  const map = [
    [[0], ['Clear sky', '☀️']],
    [[1, 2, 3], ['Partly cloudy', '⛅']],
    [[45, 48], ['Fog', '🌫️']],
    [[51, 53, 55], ['Drizzle', '🌦️']],
    [[61, 63, 65], ['Rain', '🌧️']],
    [[66, 67], ['Freezing rain', '🌧️🧊']],
    [[71, 73, 75], ['Snow', '🌨️']],
    [[77], ['Snow grains', '❄️']],
    [[80, 81, 82], ['Showers', '🌦️']],
    [[85, 86], ['Snow showers', '🌨️']],
    [[95], ['Thunderstorm', '⛈️']],
    [[96, 99], ['Thunderstorm & hail', '⛈️🧊']],
  ];
  for (const [codes, result] of map) {
    if (codes.includes(Number(code))) return { label: result[0], icon: result[1] };
  }
  return { label: 'Unknown', icon: '❓' };
}

const toF = (c) => (c * 9 / 5) + 32;
const fmtTemp = (t) => state.unit === 'C' ? `${Math.round(t)}°C` : `${Math.round(toF(t))}°F`;
const kmhToMph = (k) => k / 1.60934;
const fmtWind = (k) => state.unit === 'C' ? `${Math.round(k)} km/h` : `${Math.round(kmhToMph(k))} mph`;

function setStatus(text, cls = '') {
  const el = $('#status');
  el.textContent = text;
  el.className = `footer ${cls}`;
}

// ——— Geolocation ———
async function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Geolocation not supported.'));
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

async function reverseGeocode({ lat, lon }) {
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('reverse geocode failed');
    const data = await res.json();
    const city = data.city || data.locality || data.principalSubdivision || data.countryName || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    return city;
  } catch {
    return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  }
}

// ——— Weather API ———
async function fetchWeather({ lat, lon }) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current_weather: 'true',
    hourly: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,weathercode',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max,weathercode',
    timezone: 'auto'
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather request failed');
  return res.json();
}

function render(data) {
  // Place name
  $('#place').textContent = state.place ? `• ${state.place}` : '';

  // Current weather
  const cw = data.current_weather;
  const hourly = data.hourly;
  const feelsIdx = hourly.time.indexOf(cw.time);
  const feelsC = feelsIdx !== -1 ? hourly.apparent_temperature[feelsIdx] : cw.temperature;
  const humidity = feelsIdx !== -1 ? hourly.relative_humidity_2m[feelsIdx] : null;
  const { label, icon } = codeToIconLabel(cw.weathercode);

  $('#temp').textContent = fmtTemp(cw.temperature);
  $('#cond').textContent = `${icon} ${label}`;
  $('#feels').textContent = fmtTemp(feelsC);
  $('#humidity').textContent = humidity != null ? `${Math.round(humidity)}%` : '—';
  $('#wind').textContent = fmtWind(cw.windspeed);
  $('#updated').textContent = new Date(cw.time).toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short'
  });

  // UV
  const uv = data.daily?.uv_index_max?.[0];
  $('#uv').textContent = uv != null ? `${uv.toFixed(1)}` : '—';

  // 7-day forecast
  const days = data.daily.time.map((t, i) => ({
    date: new Date(t),
    tmax: data.daily.temperature_2m_max[i],
    tmin: data.daily.temperature_2m_min[i],
    code: data.daily.weathercode[i],
    rain: data.daily.precipitation_sum[i]
  }));

  const container = $('#forecast');
  container.innerHTML = '';
  days.forEach((d) => {
    const { label, icon } = codeToIconLabel(d.code);
    const el = document.createElement('div');
    el.className = 'tile';
    el.innerHTML = `
      <div class="day">${d.date.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' })}</div>
      <div style="font-size:20px">${icon}</div>
      <div style="font-weight:700">${fmtTemp(d.tmax)} / ${fmtTemp(d.tmin)}</div>
      <div style="color:var(--muted); font-size:12px">${label}</div>
      <div style="color:var(--muted); font-size:12px">💧 ${d.rain?.toFixed(1) ?? 0} mm</div>
    `;
    container.appendChild(el);
  });
}

async function loadByCoords(coords) {
  try {
    setStatus('Fetching weather…');
    state.place = await reverseGeocode(coords);
    const data = await fetchWeather(coords);
    state.last = data;
    render(data);
    setStatus('Live weather loaded ✓', 'ok');
  } catch (err) {
    console.error(err);
    setStatus('Could not load weather. Check your internet connection or try again.', 'bad');
  }
}

// ——— Event Handlers ———
unitBtn.addEventListener('click', () => {
  state.unit = state.unit === 'C' ? 'F' : 'C';
  unitBtn.textContent = `°${state.unit}`;
  if (state.last) render(state.last);
});

$('#locBtn').addEventListener('click', async () => {
  try {
    setStatus('Requesting location…');
    const coords = await getCurrentPosition();
    await loadByCoords(coords);
  } catch (err) {
    console.warn(err);
    const msg = err.code === 1
      ? 'Permission denied. Please allow location in your browser.'
      : 'Could not get your location.';
    setStatus(msg, 'warn');
  }
});

// ——— Auto-load on first visit ———
(async function init() {
  const isSecure = location.protocol === 'https:' || location.hostname === 'localhost';
  if (!isSecure) {
    setStatus('For automatic location, open this page over HTTPS or localhost. Otherwise, click “Use my location”.', 'warn');
  }
  try {
    const coords = await getCurrentPosition();
    await loadByCoords(coords);
  } catch (err) {
    setStatus('Click “Use my location” and allow permission.', 'warn');
  }
})();

// ——— Search by city/country ———
async function searchLocation(query) {
  try {
    setStatus(`Searching for "${query}"…`);
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Search request failed');
    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      setStatus(`No results for "${query}"`, 'warn');
      return;
    }
    const loc = data.results[0];
    state.place = `${loc.name}, ${loc.country}`;
    await loadByCoords({ lat: loc.latitude, lon: loc.longitude });
  } catch (err) {
    console.error(err);
    setStatus('Could not search location.', 'bad');
  }
}

// ——— Event: Search button & Enter key ———
$('#searchBtn').addEventListener('click', async () => {
  const query = $('#searchInput').value.trim();
  if (query) await searchLocation(query);
});

$('#searchInput').addEventListener('keypress', async (e) => {
  if (e.key === 'Enter') {
    const query = e.target.value.trim();
    if (query) await searchLocation(query);
  }
});

