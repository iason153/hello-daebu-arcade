// /api/weather.js
// 헬로런(및 향후 다른 오락실 게임)이 사용하는 실시간 날씨 + 시간대 판정 서버리스 함수.
//
// - 기상청 단기예보 조회서비스(getUltraSrtNcst, 초단기실황)를 서버에서 호출해
//   실제 API 키(KMA_SERVICE_KEY)를 클라이언트에 노출시키지 않는다.
// - 강수형태(PTY) 코드를 게임이 이해하는 weatherMode('clear'|'rain'|'snow')로 변환한다.
// - 대부도 좌표 기준 일출/일몰 시각을 서버에서 계산해 timeOfDay('day'|'sunset'|'night')로 내려준다.
//
// 중요 — 시간 계산은 전부 UTC epoch(ms) 숫자로만 한다. Date 객체의 로컬 getter(getHours,
// getDate 등)는 절대 쓰지 않는다. 이 함수는 Edge Function이라 Vercel의 여러 리전 중
// 어디서든 실행될 수 있는데, 로컬 getter는 실행 중인 서버의 기본 시간대에 의존하기 때문에
// (보통은 UTC지만 리전마다 다를 위험을 배제할 수 없음) 위치에 따라 낮/노을/밤 판정이
// 들쭉날쭉해질 수 있었다. UTC getter(getUTCHours 등)만 쓰면 이 위험 자체가 사라진다.
//
// 필요한 환경변수 (Vercel 프로젝트 설정 > Environment Variables):
//   KMA_SERVICE_KEY : data.go.kr에서 발급받은 공공데이터포털 인증키
//
// 대부도 5개 장소는 서로 아주 가까워서 기상청 격자(nx, ny) 기준으로는 사실상 같은 칸이라,
// 장소별로 별도 조회를 하지 않고 대부도 대표 격자 하나만 쓴다.
const DAEBU_GRID = { nx: 52, ny: 116 };
const DAEBU_LAT = 37.2333;
const DAEBU_LON = 126.5833;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const config = { runtime: 'edge' };

function pad2(n) { return String(n).padStart(2, '0'); }

// UTC epoch(ms) -> KST 벽시계 기준 연/월/일/시/분. Date의 UTC getter만 사용해서, 이 서버가
// 실제로 어느 리전에서 실행되든 항상 같은 결과가 나오게 한다.
function kstParts(utcMs) {
  const d = new Date(utcMs + KST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    date: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
  };
}

// 기상청 초단기실황은 매시 정시 10분 이후에 그 시각 데이터가 올라온다.
// "현재 시각(KST) - 정시" 기준으로, 10분 이전이면 한 시간 전 데이터를 요청한다.
function getBaseDateTime(nowUtcMs) {
  const p = kstParts(nowUtcMs);
  const baseMs = p.minutes < 10
    ? Date.UTC(p.year, p.month, p.date, p.hours) - 3600000
    : Date.UTC(p.year, p.month, p.date, p.hours);
  const b = new Date(baseMs);
  const baseDate = `${b.getUTCFullYear()}${pad2(b.getUTCMonth() + 1)}${pad2(b.getUTCDate())}`;
  const baseTime = `${pad2(b.getUTCHours())}00`;
  return { baseDate, baseTime };
}

// PTY(강수형태) 코드 -> 게임 weatherMode
// 0: 없음, 1: 비, 2: 비/눈, 3: 눈, 5: 빗방울, 6: 빗방울눈날림, 7: 눈날림
function ptyToWeatherMode(pty) {
  if (pty === '3' || pty === '7') return 'snow';
  if (pty === '1' || pty === '2' || pty === '5' || pty === '6') return 'rain';
  return 'clear';
}

// NOAA 근사 공식 기반 일출/일몰 계산. 반환값은 실제 UTC epoch(ms) 숫자.
function calcSunTimes(lat, lon, nowUtcMs) {
  const { year, month, date } = kstParts(nowUtcMs);
  const rad = Math.PI / 180;
  const start = Date.UTC(year, 0, 1);
  const dayOfYear = Math.floor((Date.UTC(year, month, date) - start) / 86400000) + 1;

  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)); // 분 단위
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma); // 라디안

  const latRad = lat * rad;
  const zenith = 90.833 * rad;
  const cosH = (Math.cos(zenith) - Math.sin(latRad) * Math.sin(decl)) / (Math.cos(latRad) * Math.cos(decl));
  const clamped = Math.min(1, Math.max(-1, cosH));
  const hourAngle = Math.acos(clamped) / rad;

  const solarNoonUTCMinutes = 720 - 4 * lon - eqTime;
  const sunriseUTCMinutes = solarNoonUTCMinutes - 4 * hourAngle;
  const sunsetUTCMinutes = solarNoonUTCMinutes + 4 * hourAngle;

  const midnightUTC = Date.UTC(year, month, date, 0, 0, 0);
  return {
    sunrise: midnightUTC + sunriseUTCMinutes * 60000,
    sunset: midnightUTC + sunsetUTCMinutes * 60000,
  };
}

// 일출/일몰 둘 다를 기준으로 낮/노을/밤을 판정한다. 전부 실제 UTC epoch(ms) 숫자 비교라
// 런타임 위치와 무관하게 항상 같은 결과가 나온다.
function computeTimeOfDay(nowUtcMs, sunriseUtcMs, sunsetUtcMs) {
  const w = 40 * 60000; // 일출/일몰 전후 40분을 "노을"로 처리
  if (nowUtcMs < sunriseUtcMs - w) return 'night';
  if (nowUtcMs < sunriseUtcMs + w) return 'sunset';
  if (nowUtcMs < sunsetUtcMs - w) return 'day';
  if (nowUtcMs < sunsetUtcMs + w) return 'sunset';
  return 'night';
}

export default async function handler(req) {
  const KMA_KEY = process.env.KMA_SERVICE_KEY;
  const nowUtcMs = Date.now();

  const { sunrise, sunset } = calcSunTimes(DAEBU_LAT, DAEBU_LON, nowUtcMs);
  const timeOfDay = computeTimeOfDay(nowUtcMs, sunrise, sunset);

  let weatherMode = 'clear';
  let tempC = null;

  if (KMA_KEY) {
    try {
      const { baseDate, baseTime } = getBaseDateTime(nowUtcMs);
      const url = new URL('http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst');
      url.searchParams.set('serviceKey', KMA_KEY);
      url.searchParams.set('pageNo', '1');
      url.searchParams.set('numOfRows', '10');
      url.searchParams.set('dataType', 'JSON');
      url.searchParams.set('base_date', baseDate);
      url.searchParams.set('base_time', baseTime);
      url.searchParams.set('nx', String(DAEBU_GRID.nx));
      url.searchParams.set('ny', String(DAEBU_GRID.ny));

      const kmaRes = await fetch(url.toString());
      if (kmaRes.ok) {
        const kmaData = await kmaRes.json();
        const items = kmaData?.response?.body?.items?.item || [];
        const ptyItem = items.find((it) => it.category === 'PTY');
        const tempItem = items.find((it) => it.category === 'T1H');
        if (ptyItem) weatherMode = ptyToWeatherMode(ptyItem.obsrValue);
        if (tempItem) tempC = Number(tempItem.obsrValue);
      }
    } catch (e) {
      // 기상청 API 실패 시 조용히 기본값(맑음) 유지 — 게임 진행을 막지 않는다
    }
  }

  // 응답의 sunrise/sunset/updatedAt은 사람이 브라우저에서 바로 읽고 확인하기 쉽도록,
  // KST 벽시계 숫자를 그대로 보여주되 ISO 문자열 표기(Z suffix)를 빌려 쓴다 — 실제 UTC
  // 표준시가 아니라 "이 숫자를 KST로 읽어라"는 디버그용 표기이니 다른 곳에서 파싱해서
  // 쓰지 않도록 주의. 내부 비교/판정 로직(timeOfDay)은 전부 진짜 UTC epoch로 계산했다.
  return new Response(
    JSON.stringify({
      weatherMode,
      timeOfDay,
      tempC,
      sunrise: new Date(sunrise + KST_OFFSET_MS).toISOString(),
      sunset: new Date(sunset + KST_OFFSET_MS).toISOString(),
      updatedAt: new Date(nowUtcMs + KST_OFFSET_MS).toISOString(),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=0, must-revalidate, s-maxage=600, stale-while-revalidate=120',
      },
    }
  );
}
