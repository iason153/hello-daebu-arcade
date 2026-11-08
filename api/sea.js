// /api/sea.js
// 방아머리 바닷가(/sea/)가 쓰는 실시간 바다·날씨 자료.
//
// - 기상청 초단기실황(getUltraSrtNcst): 기온 T1H, 강수형태 PTY, 1시간 강수량 RN1, 습도 REH, 풍속 WSD, 풍향 VEC
// - 기상청 초단기예보(getUltraSrtFcst): 하늘상태 SKY(실황에는 없어서 가장 가까운 시각 예보로 채운다)
// - 국립해양조사원 TideBED(GetTidebedApiService): 방아머리 좌표의 예측 물높이, 10분 간격, 오늘~모레
//
// 인증키는 서버에서만 읽는다: KMA_SERVICE_KEY(오락실에 이미 있는 값) 또는 DATA_GO_KR_KEY.
// 공공데이터포털 키는 계정 하나에 하나라서 같은 키로 두 기관 서비스를 함께 부를 수 있다(각 서비스 활용신청은 따로 필요).
// 응답은 10분 동안 Vercel 앞단에 저장되므로, 사람이 아무리 많아도 기관 API는 10분에 한 번만 불린다.
//
// 시간 계산은 전부 UTC epoch 숫자로만 한다(weather.js와 같은 원칙). 로컬 getter 금지.

export const config = { runtime: 'edge' };

const SITE = { lat: 37.2905, lon: 126.5795, nx: 53, ny: 121 };
// TideBED 는 바다 칸을 줘야 한다(해변 좌표는 육지 칸으로 잡혀 오류 10). 해변 정면 북서쪽 약 800m 앞바다.
const TIDE_PT = { lat: 37.2960, lon: 126.5720 };
const KST = 9 * 3600e3;
const p2 = (n) => String(n).padStart(2, '0');

function key() {
  let k = (process.env.KMA_SERVICE_KEY || process.env.DATA_GO_KR_KEY || '').trim();
  if (k.includes('%')) { try { k = decodeURIComponent(k); } catch (e) {} }
  return k;
}

async function call(path, params, timeoutMs = 8000) {
  const k = key();
  if (!k) throw new Error('no key');
  const qs = Object.entries(params).map(([a, b]) => encodeURIComponent(a) + '=' + encodeURIComponent(b)).join('&');
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch('https://apis.data.go.kr/' + path + '?serviceKey=' + encodeURIComponent(k) + '&' + qs, { signal: ctl.signal });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch (e) { const m = text.match(/<returnAuthMsg>([^<]+)|<errMsg>([^<]+)|<resultMsg>([^<]+)/); throw new Error('not json ' + (m ? (m[1] || m[2] || m[3]) : text.replace(/\s+/g, ' ').slice(0, 40))); }
    const root = j.response || j;
    const code = root.header && root.header.resultCode;
    if (code !== '00') {
      // 활용신청이 안 된 키는 기관 형식과 다른 오류가 온다. 원인을 알 수 있게 메시지를 짧게 남긴다(키는 남기지 않음)
      const h = (root.cmmMsgHeader || root.header || root);
      const msg = h.returnAuthMsg || h.errMsg || h.resultMsg || text.replace(/\s+/g, ' ').slice(0, 60);
      throw new Error('api ' + (code || h.returnReasonCode || h.resultCode || '?') + ' ' + msg);
    }
    const items = root.body && root.body.items;
    const it = items && (items.item !== undefined ? items.item : items);
    return Array.isArray(it) ? it : it ? [it] : [];
  } finally { clearTimeout(tm); }
}

// KST 벽시계 문자열(숫자만 뽑아 YYYY MM DD HH MM) → UTC epoch(ms)
function kstToMs(s) {
  const t = String(s).match(/\d+/g);
  if (!t) return NaN;
  let y, mo, d, h, mi;
  if (t.length >= 5) [y, mo, d, h, mi] = t.map(Number);
  else if (t.length === 1 && t[0].length >= 12) { const v = t[0]; y = +v.slice(0, 4); mo = +v.slice(4, 6); d = +v.slice(6, 8); h = +v.slice(8, 10); mi = +v.slice(10, 12); }
  else return NaN;
  return Date.UTC(y, mo - 1, d, h, mi) - KST;
}
function kstParts(ms) {
  const d = new Date(ms + KST);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}
const ymd = (p) => `${p.y}${p2(p.mo)}${p2(p.d)}`;

async function loadNowcast(now) {
  // 매시 정시 자료는 10분 뒤부터 올라온다
  const p = kstParts(now - 12 * 60e3);
  const items = await call('1360000/VilageFcstInfoService_2.0/getUltraSrtNcst', {
    pageNo: 1, numOfRows: 20, dataType: 'JSON', base_date: ymd(p), base_time: p2(p.h) + '00', nx: SITE.nx, ny: SITE.ny,
  });
  const v = {};
  items.forEach((it) => { v[it.category] = it.obsrValue; });
  const num = (x) => { const n = parseFloat(x); return isFinite(n) && n > -900 ? n : null; };
  return {
    t1h: num(v.T1H), pty: num(v.PTY), rn1: num(String(v.RN1 || '').replace(/[^\d.]/g, '') || 0),
    reh: num(v.REH), wsd: num(v.WSD), vec: num(v.VEC),
    at: kstToMs(ymd(p) + p2(p.h) + '00'),
  };
}

// 초단기예보: 하늘상태 SKY, 낙뢰 LGT(실황에는 없어서 가장 가까운 시각 예보로 채운다). 매시 30분 발표, 45분부터 받을 수 있다
async function loadUltra(now) {
  const p = kstParts(now - 46 * 60e3);
  const items = await call('1360000/VilageFcstInfoService_2.0/getUltraSrtFcst', {
    pageNo: 1, numOfRows: 60, dataType: 'JSON', base_date: ymd(p), base_time: p2(p.h) + '30', nx: SITE.nx, ny: SITE.ny,
  });
  const near = (cat) => {
    let best = null;
    items.filter((it) => it.category === cat).forEach((it) => {
      const d = Math.abs(kstToMs(it.fcstDate + it.fcstTime) - now);
      if (!best || d < best.d) best = { d, v: it.fcstValue };
    });
    return best ? best.v : null;
  };
  const sky = near('SKY'), lgt = near('LGT');
  return { sky: sky != null ? parseInt(sky, 10) : null, lgt: lgt != null ? parseFloat(lgt) || 0 : null };
}

// 단기예보: 파고 WAV(바다 격자에서만 나온다), 적설 SNO. 하루 8번(02·05·…·23시) 발표, 10분 뒤부터
const SEA_CELLS = [[52, 121], [52, 122]];
async function loadVilage(now) {
  const base = [2, 5, 8, 11, 14, 17, 20, 23];
  const q = kstParts(now - 15 * 60e3);
  let day = now - 15 * 60e3, h = base.filter((x) => x <= q.h).pop();
  if (h === undefined) { day -= 86400e3; h = 23; }
  const bd = ymd(kstParts(day)), bt = p2(h) + '00';
  for (const [nx, ny] of SEA_CELLS) {
    const items = await call('1360000/VilageFcstInfoService_2.0/getVilageFcst', {
      pageNo: 1, numOfRows: 400, dataType: 'JSON', base_date: bd, base_time: bt, nx, ny,
    }).catch(() => []);
    const pick = (cat) => {
      let best = null;
      items.filter((it) => it.category === cat).forEach((it) => {
        const d = Math.abs(kstToMs(it.fcstDate + it.fcstTime) - now);
        if (!best || d < best.d) best = { d, v: it.fcstValue };
      });
      return best ? best.v : null;
    };
    const wav = pick('WAV');
    if (wav != null && isFinite(parseFloat(wav))) {
      const sno = pick('SNO');
      return { wav: parseFloat(wav), sno: sno && /\d/.test(sno) ? parseFloat(sno) || 0 : 0, cell: [nx, ny] };
    }
  }
  throw new Error('no WAV');
}

// 에어코리아 대부동 측정소: 미세먼지(PM10)·초미세먼지(PM2.5)·통합대기 등급. 같은 공공데이터 키에 활용신청이 되어 있어야 한다
async function loadAir() {
  const items = await call('B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty', {
    pageNo: 1, numOfRows: 1, returnType: 'json', stationName: '대부동', dataTerm: 'DAILY', ver: '1.3',
  });
  const it = items[0];
  if (!it) throw new Error('no air');
  const n = (x) => { const v = parseFloat(x); return isFinite(v) ? v : null; };
  return { pm10: n(it.pm10Value), pm25: n(it.pm25Value), grade: n(it.khaiGrade), at: it.dataTime || '' };
}

async function loadTideBed(now) {
  const days = [0, 1, 2].map((k) => ymd(kstParts(now + k * 86400e3)));
  const dayErr = [];
  const sets = await Promise.all(days.map((d) => call('1192136/tidebed/GetTidebedApiService', {
    pageNo: 1, numOfRows: 150, type: 'json', reqDate: d, lat: TIDE_PT.lat, lot: TIDE_PT.lon, min: 10,
    include: 'obsvtrNm,slctdDt,slctdHgt',
  }).catch((e) => { dayErr.push(d + ' ' + e.message); return []; })));
  const seen = new Set();
  const pts = [];
  let ref = '';
  sets.flat().forEach((it) => {
    const h = parseFloat(it.slctdHgt);
    const t = kstToMs(it.slctdDt);
    if (!isFinite(h) || !isFinite(t) || seen.has(t)) return;
    seen.add(t);
    pts.push([Math.round(t / 60000), Math.round(h)]);
    ref = ref || it.obsvtrNm || '';
  });
  pts.sort((a, b) => a[0] - b[0]);
  if (pts.length < 100) throw new Error('tidebed ' + pts.length + 'pts ' + dayErr.join('; '));
  return { points: pts, ref, src: 'tidebed' };
}

// 예비: 물길온(구봉도, 방아머리에서 약 4km)이 같은 TideBED에서 받아 둔 예측 물높이. 같은 바다라 시각·높이 차이가 거의 없다.
async function loadTideFallback() {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch('https://mulgilon.com/api/tide', { signal: ctl.signal });
    const j = await r.json();
    if (!j.ok || !Array.isArray(j.points) || j.points.length < 100) throw new Error('mulgilon empty');
    return { points: j.points, ref: j.ref || '', src: 'mulgilon' };
  } finally { clearTimeout(tm); }
}

async function loadTide(now) {
  try { return await loadTideBed(now); }
  catch (e) {
    const fb = await loadTideFallback();
    fb.note = e.message;
    return fb;
  }
}

export default async function handler() {
  const now = Date.now();
  const [nc, ul, tide, vil, air] = await Promise.allSettled([loadNowcast(now), loadUltra(now), loadTide(now), loadVilage(now), loadAir()]);
  const errors = [], notes = [];
  const out = { ok: true, fetchedAt: now, site: SITE };
  if (nc.status === 'fulfilled') out.wx = nc.value; else errors.push('nowcast:' + (nc.reason && nc.reason.message));
  if (ul.status === 'fulfilled') { out.wx = out.wx || {}; if (ul.value.sky != null) out.wx.sky = ul.value.sky; if (ul.value.lgt != null) out.wx.lgt = ul.value.lgt; }
  else errors.push('sky:' + (ul.reason && ul.reason.message));
  if (tide.status === 'fulfilled') out.tide = tide.value; else errors.push('tide:' + (tide.reason && tide.reason.message));
  // 보조 자료(파고·적설·미세먼지)는 없어도 화면은 돈다
  if (vil.status === 'fulfilled') out.sea = vil.value; else notes.push('sea:' + (vil.reason && vil.reason.message));
  if (air.status === 'fulfilled') out.air = air.value; else notes.push('air:' + (air.reason && air.reason.message));
  if (errors.length) out.errors = errors;
  if (notes.length) out.notes = notes;
  const anyData = !!(out.wx || out.tide);
  out.ok = anyData;
  return new Response(JSON.stringify(out), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': anyData && !errors.length
        ? 'public, max-age=0, s-maxage=600, stale-while-revalidate=300'
        : 'public, max-age=0, s-maxage=60',
    },
  });
}
