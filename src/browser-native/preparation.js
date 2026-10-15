import { browserLanguage } from "../shared/browser-translation.js";
// Synthetic self-check sentences, not a glossary or a translation-quality benchmark.
export const NATIVE_CHECK_SAMPLES = Object.freeze({
  ar: "أقرأ كتابًا جديدًا في المكتبة كل صباح.", bg: "Всяка сутрин чета интересна книга в библиотеката.",
  bn: "আমি প্রতিদিন সকালে গ্রন্থাগারে একটি নতুন বই পড়ি।", cs: "Každé ráno čtu v knihovně novou a zajímavou knihu.",
  da: "Jeg læser en ny og spændende bog på biblioteket hver morgen.", de: "Ich lese jeden Morgen ein neues und interessantes Buch in der Bibliothek.",
  el: "Διαβάζω ένα καινούργιο βιβλίο στη βιβλιοθήκη κάθε πρωί.", en: "I read a new and interesting book in the library every morning.",
  es: "Cada mañana leo un libro nuevo e interesante en la biblioteca.", fi: "Luen joka aamu uuden ja kiinnostavan kirjan kirjastossa.",
  fr: "Chaque matin, je lis un nouveau livre intéressant à la bibliothèque.", he: "אני קורא ספר חדש ומעניין בספרייה בכל בוקר.",
  hi: "मैं हर सुबह पुस्तकालय में एक नई और दिलचस्प किताब पढ़ता हूँ।", hr: "Svako jutro čitam novu i zanimljivu knjigu u knjižnici.",
  hu: "Minden reggel egy új és érdekes könyvet olvasok a könyvtárban.", id: "Setiap pagi saya membaca buku baru yang menarik di perpustakaan.",
  it: "Ogni mattina leggo un libro nuovo e interessante in biblioteca.",
  ja: "私は毎朝、図書館で新しくて面白い本を読んでいます。", kn: "ನಾನು ಪ್ರತಿದಿನ ಬೆಳಿಗ್ಗೆ ಗ್ರಂಥಾಲಯದಲ್ಲಿ ಹೊಸ ಪುಸ್ತಕವನ್ನು ಓದುತ್ತೇನೆ.",
  ko: "저는 매일 아침 도서관에서 새롭고 재미있는 책을 읽습니다.", lt: "Kiekvieną rytą bibliotekoje skaitau naują ir įdomią knygą.",
  mr: "मी दररोज सकाळी वाचनालयात एक नवीन आणि मनोरंजक पुस्तक वाचतो.", nl: "Iedere ochtend lees ik een nieuw en interessant boek in de bibliotheek.",
  no: "Jeg leser en ny og interessant bok på biblioteket hver morgen.", pl: "Każdego ranka czytam w bibliotece nową i interesującą książkę.",
  pt: "Todas as manhãs leio um livro novo e interessante na biblioteca.", ro: "În fiecare dimineață citesc o carte nouă și interesantă la bibliotecă.",
  ru: "Каждое утро я читаю новую интересную книгу в библиотеке.", sk: "Každé ráno čítam v knižnici novú a zaujímavú knihu.",
  sl: "Vsako jutro v knjižnici berem novo in zanimivo knjigo.", sv: "Jag läser en ny och intressant bok på biblioteket varje morgon.",
  ta: "நான் ஒவ்வொரு காலையிலும் நூலகத்தில் ஒரு புதிய புத்தகத்தைப் படிக்கிறேன்.", te: "నేను ప్రతి ఉదయం గ్రంథాలయంలో ఒక కొత్త పుస్తకం చదువుతాను.",
  th: "ฉันอ่านหนังสือเล่มใหม่ที่น่าสนใจในห้องสมุดทุกเช้า", tr: "Her sabah kütüphanede yeni ve ilginç bir kitap okuyorum.",
  uk: "Щоранку я читаю нову цікаву книжку в бібліотеці.", vi: "Mỗi buổi sáng tôi đọc một cuốn sách mới và thú vị trong thư viện.",
  zh: "我每天早晨都会在图书馆阅读一本新的书，学习更多知识。", "zh-Hant": "我每天早晨都會在圖書館閱讀一本新的書，學習更多知識。"
});
export function resolvePreparationPair(source, target) {
  const targetLanguage = browserLanguage(target);
  let sourceLanguage = browserLanguage(source);
  if ((!sourceLanguage && source && source !== "auto") || !targetLanguage) throw Object.assign(new Error("BROWSER_LANGUAGE"), { code: "BROWSER_LANGUAGE" });
  if (!sourceLanguage || sourceLanguage === targetLanguage) sourceLanguage = targetLanguage === "en" ? "fr" : "en";
  const sampleText = NATIVE_CHECK_SAMPLES[sourceLanguage];
  if (!sampleText) throw Object.assign(new Error("BROWSER_LANGUAGE"), { code: "BROWSER_LANGUAGE" });
  return { sourceLanguage, targetLanguage, sampleText };
}
/** @typedef {{ request: (message: object, options?: { signal?: AbortSignal }) => Promise<unknown>, dispose: () => void }} PreparationClient */
/** @param {unknown} engine @param {{ onChange?: (state: any) => void, client?: PreparationClient | null, now?: () => number }} [options] */
export function createPreparationController(engine, { onChange = (_state) => {}, client = null, now = Date.now } = {}) {
  let current = 0, controller = null, closed = false;
  let state = { phase: "idle", busy: false, models: {}, result: null, errorCode: "", warning: "", pending: [] };
  const publish = patch => { if (!closed) { state = { ...state, ...patch }; onChange(state); } };
  function cancel() { current++; controller?.abort(); controller = null; if (state.busy) publish({ phase: "cancelled", busy: false }); }
  function start(source, target) {
    cancel(); const revision = ++current; controller = new AbortController();
    const signal = controller.signal;
    let pair;
    try { pair = resolvePreparationPair(source, target); }
    catch (cause) { publish({ phase: "failed", busy: false, errorCode: cause.code }); return Promise.reject(cause); }
    publish({ phase: "preparing", busy: true, result: null, errorCode: "", warning: "", models: { detector: { phase: "initializing" }, translator: { phase: "initializing" } } });
    let work;
    try {
      // Start immediately: never await storage/IPC before the model create calls.
      work = engine.prepareBundle(pair, pair.sampleText, { signal, onStatus(status) {
        if (closed || signal.aborted || revision !== current) return;
        publish({ models: { ...state.models, [status.model]: status } });
      } });
    } catch (cause) { work = Promise.reject(cause); }
    return Promise.resolve(work).then(async result => {
      if (closed || signal.aborted || revision !== current) return null;
      publish({ phase: "ready", busy: false, result: { ...result, sampleText: pair.sampleText, checkedAt: now() } });
      if (client) {
        try { await client.request({ kind: "pending-verified", pair }); }
        catch { if (!closed && revision === current) publish({ warning: "BROWSER_STATUS_SAVE" }); }
      }
      return result;
    }, cause => {
      if (!closed && revision === current) publish({ phase: signal.aborted ? "cancelled" : "failed", busy: false, errorCode: engine.normalizeError(cause).code });
      throw cause;
    });
  }
  async function refresh() {
    if (!client) return;
    try { const pending = await client.request({ kind: "pending-list" }); if (!closed) publish({ pending: Array.isArray(pending) ? pending : [] }); }
    catch { if (!closed) publish({ warning: "BROWSER_STATUS_READ" }); }
  }
  return { start, cancel, refresh, state: () => state, dispose() { closed = true; cancel(); client?.dispose(); engine.dispose(); } };
}
