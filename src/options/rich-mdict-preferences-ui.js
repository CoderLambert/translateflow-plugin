import { BACKGROUND_MESSAGES } from "../shared/constants.js";

export function appendRichMdictPreferencesControls({
  actions,
  dictionary,
  dictionaries,
  index,
  runtime,
  setStatus,
  refresh
} = {}) {
  const preferred = dictionary.preferred === true;
  const preferredLabel = preferred ? document.createElement("span") : null;
  const promoteButton = preferred ? null : document.createElement("button");
  if (preferredLabel) {
    preferredLabel.className = "rich-mdict-personal-preference";
    preferredLabel.dataset.role = "personal-preference";
    preferredLabel.setAttribute("role", "status");
    preferredLabel.textContent = "你的个人首选";
    actions.appendChild(preferredLabel);
  } else {
    promoteButton.type = "button";
    promoteButton.dataset.action = "promote-preferred";
    promoteButton.textContent = dictionary.enabled === false ? "启用并设为首选" : "设为首选";
    promoteButton.setAttribute("aria-label", `${promoteButton.textContent}：${dictionary.title || "富文本词典"}`);
    promoteButton.addEventListener("click", () => void promote());
    actions.appendChild(promoteButton);
  }
  const enabled = addToggle(actions, "enabled", "在划词结果显示", dictionary.enabled !== false, (checked) =>
    savePreferences({ enabled: checked }, "划词显示偏好已保存。"));
  const expanded = addToggle(actions, "expanded-by-default", "默认展开释义（首选自动展开）", dictionary.expandedByDefault === true, (checked) =>
    savePreferences({ expandedByDefault: checked }, "Rich card 展开偏好已保存。"));
  const moveUp = addMoveButton(actions, "move-up", "上移", index === 0, -1);
  const moveDown = addMoveButton(actions, "move-down", "下移", index === dictionaries.length - 1, 1);

  function addMoveButton(parent, action, label, disabled, delta) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.action = action;
    button.disabled = disabled;
    button.addEventListener("click", () => void move(delta));
    parent.appendChild(button);
    return button;
  }

  function addToggle(parent, action, label, checked, onChange) {
    const wrapper = document.createElement("label");
    wrapper.className = "checkbox-label";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.dataset.action = action;
    input.addEventListener("change", () => onChange(input.checked));
    wrapper.append(input, document.createTextNode(label));
    parent.appendChild(wrapper);
    return input;
  }

  async function savePreferences(preferences, successMessage) {
    setBusy(true);
    try {
      await sendUpdate(dictionary.id, preferences, "词典显示偏好保存失败。");
      setStatus(successMessage);
    } catch (error) {
      setStatus(error?.message || String(error), true);
    } finally {
      await refresh();
    }
  }

  async function move(delta) {
    if (index + delta < 0 || index + delta >= dictionaries.length) return;
    const reordered = [...dictionaries];
    const [selected] = reordered.splice(index, 1);
    reordered.splice(index + delta, 0, selected);
    moveUp.disabled = true;
    moveDown.disabled = true;
    try {
      const response = await runtime.sendMessage({
        type: BACKGROUND_MESSAGES.RICH_MDICT_PREFERENCES_REORDER,
        dictionaryIds: reordered.map((item) => item.id)
      });
      if (!response?.ok) throw new Error(response?.error || "词典排序保存失败。");
      setStatus("富文本词典顺序已保存。");
    } catch (error) {
      setStatus(error?.message || String(error), true);
    } finally {
      await refresh();
    }
  }

  async function promote() {
    setBusy(true);
    try {
      const response = await runtime.sendMessage({
        type: BACKGROUND_MESSAGES.RICH_MDICT_PREFERENCES_PROMOTE,
        dictionaryId: dictionary.id
      });
      if (!response?.ok) throw new Error(response?.error || "设置个人首选失败。");
      setStatus("已将这本词典设为个人首选；划词时会优先展开。 ");
    } catch (error) {
      setStatus(error?.message || String(error), true);
    } finally {
      await refresh();
    }
  }

  async function sendUpdate(dictionaryId, preferences, fallback) {
    const response = await runtime.sendMessage({
      type: BACKGROUND_MESSAGES.RICH_MDICT_PREFERENCES_UPDATE,
      dictionaryId,
      preferences
    });
    if (!response?.ok) throw new Error(response?.error || fallback);
  }

  function setBusy(disabled) {
    if (promoteButton) promoteButton.disabled = disabled;
    enabled.disabled = disabled;
    expanded.disabled = disabled;
    moveUp.disabled = disabled;
    moveDown.disabled = disabled;
  }
}
