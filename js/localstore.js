/* 휴대폰 저장소: 기록·기준값·사진을 이 휴대폰의 앱 저장공간(IndexedDB)에 둔다. GitHub은 쓰지 않는다.
 * 화면 코드(app.js)가 예전 GitHub 저장소와 같은 방식으로 부르도록 이름과 함수 모양(GitHubStore.load/update…)을 그대로 맞췄다.
 * - 앱을 지우거나 Chrome의 「사이트 데이터 삭제」를 하면 기록도 지워진다 → 설정 → 데이터에서 백업 파일을 내려받아 둔다.
 * - 저장공간을 「영구」로 요청해 휴대폰 공간이 부족해도 브라우저가 임의로 지우지 않게 한다.
 */
const GitHubStore = (() => {
  const DB_NAME = "golf-lounge-hp", STORE = "kv";
  const DATA_DIR = "data";
  const ROUNDS = `${DATA_DIR}/rounds.json`;
  const SETTINGS = `${DATA_DIR}/settings.json`;
  const PHOTO_DIR = `${DATA_DIR}/photos/`;
  // 처음 실행할 때 기존 기록을 가져올 곳(공개 웹 주소에서 읽기만 한다)
  const LOUNGE = "https://supok00.github.io/golf-lounge/";
  const PRIMARY = { owner: "이 휴대폰", repo: "golf-lounge-hp", branch: "local" };

  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((ok, no) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(new Error("휴대폰 저장공간을 열 수 없습니다(시크릿 모드이거나 저장공간이 막혀 있음)."));
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((ok, no) => {
      const t = d.transaction(STORE, mode), st = t.objectStore(STORE);
      const req = fn(st);
      t.oncomplete = () => ok(req && "result" in req ? req.result : undefined);
      t.onerror = () => no(t.error || new Error("저장 실패"));
    });
  }
  const get = (k) => tx("readonly", (s) => s.get(k));
  const put = (k, v) => tx("readwrite", (s) => s.put(v, k));
  const del = (k) => tx("readwrite", (s) => s.delete(k));
  const keys = () => tx("readonly", (s) => s.getAllKeys());

  // 사진은 화면이 <img src>로 바로 쓰도록 data: 주소로 저장하고, 시작할 때 메모리에 올려 둔다
  const PHOTOS = {};
  let ready = null;
  function init() {
    if (!ready) ready = (async () => {
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* 지원 안 함 */ }
      for (const k of await keys()) if (String(k).startsWith(PHOTO_DIR)) PHOTOS[k] = await get(k);
    })();
    return ready;
  }

  async function load(path) {
    await init();
    const p = path || ROUNDS;
    const data = await get(p);
    return { data: data ?? null, sha: null, source: "local", missing: data === undefined };
  }
  // 변경 적용: 최신 값에 mutate를 적용해 저장. 변경 이력(최근 100개)도 남긴다.
  async function update(mutate, message, path) {
    await init();
    const p = path || ROUNDS;
    const next = mutate((await get(p)) ?? null);
    await put(p, next);
    const log = (await get("log")) || [];
    log.unshift({ at: new Date().toISOString(), message, path: p });
    await put("log", log.slice(0, 100));
    return { data: next, mirrorErrors: [] };
  }
  async function putFile(path, b64) {
    const url = "data:image/jpeg;base64," + b64;
    await put(path, url);
    PHOTOS[path] = url;
    return [];
  }
  async function deleteFile(path) { await del(path); delete PHOTOS[path]; }
  const rawUrl = (path) => PHOTOS[path] || "";

  /* 백업: 기록·기준값·사진을 한 파일(JSON)로. 복원은 같은 파일을 읽어 통째로 바꾼다. */
  async function exportAll() {
    await init();
    return { app: "golf-lounge-hp", exportedAt: new Date().toISOString(), rounds: (await get(ROUNDS)) || [], settings: (await get(SETTINGS)) || null, photos: { ...PHOTOS } };
  }
  async function importAll(obj) {
    if (!obj || !Array.isArray(obj.rounds)) throw new Error("백업 파일 형식이 아닙니다(rounds 없음).");
    await init();
    for (const k of Object.keys(PHOTOS)) await deleteFile(k);
    await put(ROUNDS, obj.rounds);
    if (obj.settings) await put(SETTINGS, obj.settings);
    for (const [k, v] of Object.entries(obj.photos || {})) if (String(k).startsWith(PHOTO_DIR) && String(v).startsWith("data:image/")) { await put(k, v); PHOTOS[k] = v; }
    return obj.rounds.length;
  }
  /* golf-lounge 웹의 기록을 이 휴대폰으로 가져온다(공개 주소에서 읽기만, 한 번). 사진도 받아 휴대폰에 저장. */
  async function importFromLounge(onProgress = () => {}) {
    await init();
    const j = async (f) => { const r = await fetch(`${LOUNGE}${f}?t=${Date.now()}`, { cache: "no-store" }); if (!r.ok) throw new Error(`golf-lounge에서 ${f}을(를) 읽지 못했습니다(${r.status}).`); return r.json(); };
    const rounds = await j(ROUNDS), settings = await j(SETTINGS).catch(() => null);
    const photos = {};
    const paths = [...new Set(rounds.flatMap((r) => r.photos || []))];
    for (const [i, p] of paths.entries()) {
      onProgress(`사진 ${i + 1}/${paths.length}`);
      try {
        const res = await fetch(`https://raw.githubusercontent.com/supok00/golf-lounge/main/${p}`);
        if (!res.ok) continue;
        const blob = await res.blob();
        photos[p] = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
      } catch { /* 못 받은 사진은 건너뜀 */ }
    }
    return importAll({ rounds, settings, photos });
  }
  async function wipe() {
    await init();
    for (const k of await keys()) await del(k);
    for (const k of Object.keys(PHOTOS)) delete PHOTOS[k];
  }
  async function usage() {
    const out = { persisted: null, used: null, quota: null };
    try { if (navigator.storage) { out.persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null; const e = navigator.storage.estimate ? await navigator.storage.estimate() : {}; out.used = e.usage ?? null; out.quota = e.quota ?? null; } } catch { /* 무시 */ }
    return out;
  }
  const history = async () => (await get("log")) || [];

  // 예전 GitHub 저장소와 같은 이름(화면 코드가 그대로 쓰도록). 휴대폰 저장이라 토큰·동기화는 없다.
  const cfg = () => ({ ...PRIMARY, path: ROUNDS, token: "", mirrors: [] });
  return {
    cfg, setCfg: () => true, canWrite: () => true, load, update, putFile, deleteFile, rawUrl,
    syncStatus: async () => [], resync: async () => {}, pending: () => false, testToken: async () => ({ ok: true, msg: "휴대폰에 저장합니다(연결 필요 없음)." }),
    exportAll, importAll, importFromLounge, wipe, usage, history, init,
    PRIMARY, MIRRORS: [], IS_ORIGIN: false, ORIGIN: PRIMARY, ROUNDS, SETTINGS, DATA_DIR, LOCAL: true,
  };
})();
