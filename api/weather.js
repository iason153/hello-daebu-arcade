// /api/weather.js
// 헬로런(및 향후 다른 오락실 게임)이 사용하는 실시간 날씨 + 시간대 판정 서버리스 함수.
//
// - 기상청 단기예보 조회서비스(getUltraSrtNcst, 초단기실황)를 서버에서 호출해
//   실제 API 키(KMA_SERVICE_KEY)를 클라이언트에 노출시키지 않는다.
// - 강수형태(PTY) 코드를 게임이 이해하는 weatherMode('clear'|'rain'|'snow')로 변환한다.
// - 대부도 좌표 기준 일출/일몰 시각을 서버에서 계산해 timeOfDay('day'|'sunset'|'night')로 내려준다.
//   (클라이언트에 별도 라이브러리를 추가하지 않기 위해 계산도 서버에서 끝낸다.)
// - 프론트가 자주 호출해도 기상청 API 호출 횟수가 늘지 않도록 CDN 캐시(10분)를 건다.
//
// 필요한 환경변수 (Vercel 프로젝트 설정 > Environment Variables):
//   KMA_SERVICE_KEY : data.go.kr에서 발급받은 공공데이터포털 인증키 (다른 프로젝트에서 쓰는 것과 동일 계정 사용 가능)
//
// 대부도 5개 장소(시화방조제/방아머리/대부도테마파크/구봉도/탄도항)는 서로 아주 가까워서
// 기상청 격자(nx, ny) 기준으로는 사실상 같은 칸에 들어간다. 그래서 장소별로 별도 조회를
// 하지 않고 대부도 대표 격자 하나만 쓴다 — 이후 필요해지면 STATION_GRID에 장소별 좌표를
// 추가해서 분기하면 된다.
const DAEBU_GRID = { nx: 52, ny: 116 }; // 기상청 격자좌표(안산/대부도 인근)
const DAEBU_LAT = 37.2333;
const DAEBU_LON = 126.5833;

export const config = { runtime: 'edge' };

function pad2(n) { return String(n).padStart(2, '0'); }

// 기상청 초단기실황은 매시 정시 10분 이후에 그 시각 데이터가 올라온다.
// 그래서 "현재 시각 - 정시" 기준으로, 10분 이전이면 한 시간 전 데이터를 요청해야 한다.
function getBaseDateTime(nowKST) {
  const d = new Date(nowKST);
  if (d.getMinutes() < 10) {
    d.setHours(d.getHours() - 1);
  }
  const baseDate = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  const baseTime = `${pad2(d.getHours())}00`;
  return { baseDate, baseTime };
}

function toKST(date) {
  // UTC 기준 서버 시간을 KST(UTC+9)로 변환
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

// PTY(강수형태) 코드 -> 게임 weatherMode
// 0: 없음, 1: 비, 2: 비/눈, 3: 눈, 5: 빗방울, 6: 빗방울눈날림, 7: 눈날림
function ptyToWeatherMode(pty) {
  if (pty === '3' || pty === '7') return 'snow';
  if (pty === '1' || pty === '2' || pty === '5' || pty === '6') return 'rain';
  return 'clear';
}

// NOAA 근사 공식 기반 일출/일몰 계산 (초 단위 정밀도는 필요 없어 단순화된 버전 사용)
// 반환값: 그날의 일몰 시각(KST, Date 객체)
function calcSunset(lat, lon, dateKST) {
  const rad = Math.PI / 180;
  const start = Date.UTC(dateKST.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((Date.UTC(dateKST.getFullYear(), dateKST.getMonth(), dateKST.getDate()) - start) / 86400000) + 1;

  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)); // 분 단위
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma); // 라디안

  const latRad = lat * rad;
  const zenith = 90.833 * rad; // 대기굴절 보정 포함 표준 일몰 기준각
  const cosH = (Math.cos(zenith) - Math.sin(latRad) * Math.sin(decl)) / (Math.cos(latRad) * Math.cos(decl));
  const clamped = Math.min(1, Math.max(-1, cosH));
  const hourAngle = Math.acos(clamped) / rad; // 도 단위

  // 일몰 = 720분(정오) + 4*(hourAngle - 경도) - eqTime, 분 단위(UTC)
  // (경도가 동쪽으로 클수록 UTC 기준 정오/일몰 시각은 더 이른 시각이 됨 — 이전 버전은
  //  이 항목의 부호가 반대로 들어가 있어서 일몰이 몇 시간씩 틀리게 나왔음)
  const sunsetUTCMinutes = 720 + 4 * (hourAngle - lon) - eqTime;
  const sunsetUTC = new Date(Date.UTC(dateKST.getFullYear(), dateKST.getMonth(), dateKST.getDate(), 0, 0, 0) + sunsetUTCMinutes * 60000);
  return toKST(sunsetUTC);
}

function computeTimeOfDay(nowKST, sunsetKST) {
  const sunsetMs = sunsetKST.getTime();
  const nowMs = nowKST.getTime();
  const duskWindowMs = 40 * 60000; // 일몰 전후 40분을 "노을"로 처리
  if (nowMs < sunsetMs - duskWindowMs) return 'day';
  if (nowMs < sunsetMs + duskWindowMs) return 'sunset';
  return 'night';
}

export default async function handler(req) {
  const KMA_KEY = process.env.KMA_SERVICE_KEY;
  const nowKST = toKST(new Date());

  const sunset = calcSunset(DAEBU_LAT, DAEBU_LON, nowKST);
  const timeOfDay = computeTimeOfDay(nowKST, sunset);

  let weatherMode = 'clear';
  let tempC = null;

  if (KMA_KEY) {
    try {
      const { baseDate, baseTime } = getBaseDateTime(nowKST);
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

  return new Response(
    JSON.stringify({
      weatherMode,
      timeOfDay,
      tempC,
      sunset: sunset.toISOString(),
      updatedAt: nowKST.toISOString(),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // CDN(Vercel Edge) 캐시 10분 — 기상청 API 호출 횟수를 줄인다
        'Cache-Control': 's-maxage=600, stale-while-revalidate=120',
      },
    }
  );
}
