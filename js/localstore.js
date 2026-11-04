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

  // 사진은 화면이 <img src>로 바로 쓰도록 data: 주소로 저장하고, 시작할 때 메모리에 올려 둔다.
  // 동영상은 커서(한 개 50MB까지) 문자열 대신 Blob으로 저장하고 화면에는 blob: 주소만 넘긴다.
  const PHOTOS = {};
  const VIDEO_TYPE = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
  const extOf = (path) => (String(path).match(/\.(\w+)$/) || [])[1]?.toLowerCase() || "";
  const toUrl = (v) => (v instanceof Blob ? URL.createObjectURL(v) : v);
  const dataUrlToBlob = async (u) => (await fetch(u)).blob();
  const blobToDataUrl = (b) => new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => no(fr.error); fr.readAsDataURL(b); });
  let ready = null;
  function init() {
    if (!ready) ready = (async () => {
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* 지원 안 함 */ }
      for (const k of await keys()) if (String(k).startsWith(PHOTO_DIR)) PHOTOS[k] = toUrl(await get(k));
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
    const vt = VIDEO_TYPE[extOf(path)];
    const val = vt ? await dataUrlToBlob(`data:${vt};base64,${b64}`) : "data:image/jpeg;base64," + b64;
    await put(path, val);
    PHOTOS[path] = toUrl(val);
    return [];
  }
  async function deleteFile(path) {
    await del(path);
    if (String(PHOTOS[path]).startsWith("blob:")) URL.revokeObjectURL(PHOTOS[path]);
    delete PHOTOS[path];
  }
  const rawUrl = (path) => PHOTOS[path] || "";

  // 백업 파일에는 동영상도 data: 주소로 넣는다(파일 하나로 옮길 수 있게)
  async function exportPhotos() {
    const out = {};
    for (const k of Object.keys(PHOTOS)) { const v = await get(k); out[k] = v instanceof Blob ? await blobToDataUrl(v) : v; }
    return out;
  }
  /* 백업: 기록·기준값·사진을 한 파일(JSON)로. 복원은 같은 파일을 읽어 통째로 바꾼다. */
  async function exportAll() {
    await init();
    return { app: "golf-lounge-hp", exportedAt: new Date().toISOString(), rounds: (await get(ROUNDS)) || [], settings: (await get(SETTINGS)) || null, photos: await exportPhotos() };
  }
  async function importAll(obj) {
    if (!obj || !Array.isArray(obj.rounds)) throw new Error("백업 파일 형식이 아닙니다(rounds 없음).");
    await init();
    for (const k of Object.keys(PHOTOS)) await deleteFile(k);
    await put(ROUNDS, obj.rounds);
    if (obj.settings) await put(SETTINGS, obj.settings);
    for (const [k, v] of Object.entries(obj.photos || {})) {
      if (!String(k).startsWith(PHOTO_DIR)) continue;
      const val = String(v).startsWith("data:image/") ? v : String(v).startsWith("data:video/") ? await dataUrlToBlob(v) : null;
      if (val) { await put(k, val); PHOTOS[k] = toUrl(val); }
    }
    return obj.rounds.length;
  }
  async function wipe() {
    await init();
    for (const k of await keys()) await del(k);
    for (const k of Object.keys(PHOTOS)) { if (PHOTOS[k].startsWith("blob:")) URL.revokeObjectURL(PHOTOS[k]); delete PHOTOS[k]; }
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
    exportAll, importAll, wipe, usage, history, init,
    PRIMARY, MIRRORS: [], IS_ORIGIN: false, ORIGIN: PRIMARY, ROUNDS, SETTINGS, DATA_DIR, LOCAL: true,
    // 웹판 github.js와 같은 저장 층 공통 이름(2026-11-04 서버판 준비로 정리) — app.js는 이것만 쓴다
    KIND: "local", COURSES: "data/courses.json", COURSE_REQS: "data/course-requests.json",
    mediaPath: (file) => PHOTO_DIR + file, mediaUrl: rawUrl,
    where: () => ({ isOwner: false, label: `${PRIMARY.owner}`, file: ROUNDS, siteUrl: "supok00.github.io/golf-lounge-hp", repos: [PRIMARY.repo], origin: "supok00/golf-lounge" }),
    hasMirrors: () => false, mirrorRepos: () => [PRIMARY.repo], resyncAll: async () => {},
  };
})();
