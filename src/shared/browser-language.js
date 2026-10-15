// FluentRead-inspired policy, independently implemented for TranslateFlow.
// Detection is evidence, not a page locale. No browser/storage/model side effects.
import { browserLanguage } from "./browser-translation.js";
export const MIN_LANGUAGE_CONFIDENCE = 0.4;
const MIN_CANDIDATE_MARGIN = 0.1;
const HANS = /[这们语译设为说从对还样书门车东发见长电现间题让气实图网边变进选级应标经简汉龙马鱼鸟刘吴赵陈张听读写学国体测试时钟话广关欢业专丛丝严个丰临丽举义乌乐乔习乡买乱争亚产亲亿仅价众优会伟传伤伦伪党兴养军农决况冻净凉减凤凭击创别则刚删剑办务动励劳势区医华单厂厅历压厌县双叠叶号启员园围圆圣场块声壳处备复够头夺奖妇妈婴孙宁宝宠审宽宾寻导将层岁岛币师帐帘带帮庆库庙废开异弃弯归录当忆怀态总恋恶惊惧惨愿戏户执扫扬护报担拟拥择挡挥损换据摄断旧显晓暂术机杀杂权条构树桥检楼没泪泽洁浅济浓润湾湿满灭灯灵炉点爱独狮猪献画盐监盖盘离种积称稳穷笔签类红纸练组细织终结给绝统继绩续绿编缘缩联胆胜脑脚脸艺节苏苹药莲获营蓝补装裤观规视览觉计订认记讲许论访证评识词诚详该误请诸诺谋谓谢谱贝财质贵费资赛赞转轮轻载较辅辆输辞辩达迁过运远违连迟适递逻遗邻郑释钱铁银链锁错镜闪闭问闻阅队阳阵阶际陆险随隐难雾静页顺须顾预领频额颜风飞饭饮馆骑骗鸡鸣鸭麦齐齿龟与]/u;
const HANT = /[這們語譯設為說從對還樣書門車東發見長電現間題讓氣實圖網邊變進選級應標經簡漢龍馬魚鳥劉吳趙陳張聽讀寫學國體測試時鐘話廣關歡業專叢絲嚴個豐臨麗舉義烏樂喬習鄉買亂爭亞產親億僅價眾優會偉傳傷倫偽黨興養軍農決況凍淨涼減鳳憑擊創別則剛刪劍辦務動勵勞勢區醫華單廠廳歷壓厭縣雙疊葉號啟員園圍圓聖場塊聲殼處備復夠頭奪獎婦媽嬰孫寧寶寵審寬賓尋導將層歲島幣師帳簾帶幫慶庫廟廢開異棄彎歸錄當憶懷態總戀惡驚懼慘願戲戶執掃揚護報擔擬擁擇擋揮損換據攝斷舊顯曉暫術機殺雜權條構樹橋檢樓沒淚澤潔淺濟濃潤灣濕滿滅燈靈爐點愛獨獅豬獻畫鹽監蓋盤離種積稱穩窮筆簽類紅紙練組細織終結給絕統繼績續綠編緣縮聯膽勝腦腳臉藝節蘇蘋藥蓮獲營藍補裝褲觀規視覽覺計訂認記講許論訪證評識詞誠詳該誤請諸諾謀謂謝譜貝財質貴費資賽贊轉輪輕載較輔輛輸辭辯達遷過運遠違連遲適遞邏遺鄰鄭釋錢鐵銀鏈鎖錯鏡閃閉問聞閱隊陽陣階際陸險隨隱難霧靜頁順須顧預領頻額顏風飛飯飲館騎騙雞鳴鴨麥齊齒龜與]/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;

export function scriptLanguage(text) {
  const kana = KANA.test(text), hangul = HANGUL.test(text);
  // Script-only fallback must not guess the language of mixed prose.
  if (kana && hangul || (String(text).match(/[A-Za-z]{2,}/g) || []).length > 3) return "";
  return kana ? "ja" : hangul ? "ko" : "";
}

export function refineChinese(text, rawLanguage) {
  const language = browserLanguage(rawLanguage);
  if (!language || language !== "zh" || /(?:hans|cn|sg)/i.test(rawLanguage)) return { language, scriptKnown: Boolean(language) };
  if (KANA.test(text) || HANGUL.test(text)) return { language: "", scriptKnown: false };
  // Only refine after the native detector has established Chinese; not a Han -> Chinese heuristic.
  const hans = HANS.test(text), hant = HANT.test(text);
  return { language: hant && !hans ? "zh-Hant" : "zh", scriptKnown: hans !== hant };
}

export function chooseDetectedLanguage(results, text) {
  const unknown = { language: "", source: "unknown", confidence: 0, scriptKnown: false };
  if (!Array.isArray(results) || !results.length) return unknown;
  const valid = results.filter(item => typeof item?.detectedLanguage === "string" &&
    typeof item.confidence === "number" && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1);
  if (!valid.length || valid.length !== results.length) return unknown;
  // Never promote a supported runner-up when the top language is unsupported.
  const ordered = [...valid].sort((a, b) => b.confidence - a.confidence);
  const top = ordered[0], language = browserLanguage(top.detectedLanguage);
  if (!language || top.confidence < MIN_LANGUAGE_CONFIDENCE) return unknown;
  const runner = ordered.find(item => browserLanguage(item.detectedLanguage) !== language);
  if (runner && top.confidence - runner.confidence < MIN_CANDIDATE_MARGIN) return unknown;
  const refined = refineChinese(text, top.detectedLanguage);
  return { ...refined, source: "detector", confidence: top.confidence };
}

export function explicitSource({ corrected, configured, trackLanguage, surface }) {
  for (const [value, source] of [[corrected, "manual"], [configured, "setting"], [surface === "subtitle" ? trackLanguage : "", "track"]]) {
    const language = browserLanguage(value);
    if (language) return { language, source, scriptKnown: true };
  }
  return null;
}

export function translationParts(text, protectedIds = []) {
  const protectedSet = new Set(protectedIds), opened = new Set(), stack = [], result = [];
  for (const part of String(text).split(/(⟦TF:\d+:[SE]⟧)/g)) {
    const marker = /^⟦TF:(\d+):([SE])⟧$/.exec(part);
    if (marker) {
      const id = Number(marker[1]);
      if (marker[2] === "S") {
        if (opened.has(id)) throw Object.assign(new Error("Invalid translation structure"), { code: "BROWSER_STRUCTURE" });
        opened.add(id); stack.push(id);
      } else if (stack.pop() !== id) throw Object.assign(new Error("Invalid translation structure"), { code: "BROWSER_STRUCTURE" });
      result.push({ text: part, protected: true, marker: true });
    } else {
      if (/⟦TF:/.test(part)) throw Object.assign(new Error("Invalid translation structure"), { code: "BROWSER_STRUCTURE" });
      result.push({ text: part, protected: stack.some(id => protectedSet.has(id)), marker: false });
    }
  }
  if (stack.length) throw Object.assign(new Error("Invalid translation structure"), { code: "BROWSER_STRUCTURE" });
  return result;
}

export function detectionSample(text, protectedIds = []) {
  return translationParts(text, protectedIds).filter(part => !part.protected).map(part => part.text).join(" ")
    .replace(/https?:\/\/\S+|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/giu, " ").replace(/\s+/gu, " ").trim().slice(0, 4000);
}
