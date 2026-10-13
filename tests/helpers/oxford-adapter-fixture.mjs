// Synthetic structural corpus. Contains no copied dictionary content or assets.
export function makeOxfordAdapterRecord({ posCount = 3, pronunciationIndices = Array.from({ length: posCount }, (_, index) => index), headIndices = pronunciationIndices,
  hints = true, illustration = true } = {}) {
  const indices = Array.from({ length: posCount }, (_, index) => index);
  const word = '<div class="o-word-line">SYNTHETIC WORD' + headIndices.map((index) => `<span class="o-head-symbol-set o-active" data-head-symbols-for="${index}">HEAD ${index}</span>`).join('') + '</div>';
  const pronunciation = pronunciationIndices.map((index) => `<div class="o-pronunciation-set o-active" data-pronunciation-for="${index}">PRON ${index}<a href="sound://audio/pron-${index}.wav">AUDIO ${index}</a></div>`).join('');
  const radios = indices.map((index) => `<input type="radio" id="pos-${index}" name="pos" class="o-pos-radio-${index}" data-pos-index="${index}" ${index === 0 ? 'checked' : ''}>`).join('');
  const labels = indices.map((index) => `<label for="pos-${index}" class="o-for-pos-${index}">POS ${index}</label>`).join('');
  const panels = indices.map((index) => `<section class="o-pos o-pos-panel decoration-a decoration-b o-for-pos-${index}"><p id="panel.${index}">PANEL ${index} SENTINEL</p><details class="o-unbox-panel"><summary class="o-unbox-tile"><span class="o-unbox-tile-title">UNBOX ${index}</span>${illustration ? '<span class="o-unbox-tile-illustration"><img src="images/diagram.svg" alt="Synthetic diagram"></span>' : ''}</summary><p id="panel.${index}.deep">DEEP ${index} SENTINEL</p></details></section>`).join('');
  const tip = hints ? '<span class="o-symbol-wrap">SYMBOL<span class="o-symbol-tip"><b>SYNTHETIC TIP</b> BODY</span></span>' : '';
  return word + pronunciation + tip + `<div class="o-pos-switch">${radios}<nav class="o-pos-tabs">${labels}</nav><div class="o-pos-panels">${panels}</div></div>`;
}
export const ADAPTER_DIAGRAM = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M0 0L24 0L0 24Z" fill="#123456"/></svg>';
