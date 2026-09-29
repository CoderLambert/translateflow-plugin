import {
  STARDICT_IMPORT_ERROR
} from "../background/packs/importers/stardict-contract.js";
import {
  parseStarDictIfo
} from "../background/packs/importers/stardict-core.js";
import {
  createStarDictImportController
} from "./stardict-import-controller.js";

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const SUPPORTED_EXTENSIONS = Object.freeze([
  ".ifo", ".idx", ".dict", ".dict.dz", ".syn"
]);

export function collectStarDictFileSet(files) {
  const selected = Array.from(files || []);
  if (!selected.length) {
    throw uiError("missing-files", "请选择同一套 StarDict 文件。");
  }

  const groups = new Map();
  for (const file of selected) {
    const parsed = parseFileName(file?.name);
    if (!parsed) {
      throw uiError(
        "unsupported",
        "请选择 .ifo、.idx、.dict / .dict.dz，以及可选 .syn 文件。"
      );
    }
    const key = parsed.base.toLocaleLowerCase("en-US");
    const group = groups.get(key) || {
      base: parsed.base,
      files: new Map()
    };
    if (group.files.has(parsed.extension)) {
      throw uiError(
        "duplicate-files",
        `检测到重复的 ${parsed.extension} 文件，请只选择同一套词典的一份文件。`
      );
    }
    group.files.set(parsed.extension, file);
    groups.set(key, group);
  }

  if (groups.size !== 1) {
    throw uiError(
      "ambiguous-files",
      "检测到多套 StarDict 文件。请一次只选择一套同名词典文件。"
    );
  }

  const group = [...groups.values()][0];
  const ifoFile = group.files.get(".ifo");
  const idxFile = group.files.get(".idx");
  const plain = group.files.get(".dict");
  const zipped = group.files.get(".dict.dz");
  const synFile = group.files.get(".syn");

  if (!ifoFile || !idxFile || (!plain && !zipped)) {
    throw uiError(
      "missing-files",
      "文件不完整：至少需要同名的 .ifo、.idx 和 .dict 或 .dict.dz。"
    );
  }
  if (plain && zipped) {
    throw uiError(
      "ambiguous-files",
      "同时选择了 .dict 和 .dict.dz。请只保留一种正文文件。"
    );
  }

  return {
    baseName: group.base,
    format: zipped ? "dictzip" : "plain",
    ifoFile,
    idxFile,
    dictFile: zipped || plain,
    ...(synFile ? { synFile } : {})
  };
}

export async function inspectStarDictFiles(files) {
  const fileSet = collectStarDictFileSet(files);
  let ifoText;
  try {
    ifoText = UTF8.decode(
      new Uint8Array(await fileSet.ifoFile.arrayBuffer())
    );
  } catch {
    throw uiError(
      "corrupt",
      ".ifo 不是有效的 UTF-8 StarDict 元数据。"
    );
  }

  let dictionary;
  try {
    dictionary = parseStarDictIfo(ifoText);
  } catch (error) {
    throw normalizeInspectionError(error);
  }

  if (dictionary.idxfilesize !== fileSet.idxFile.size) {
    throw uiError(
      "corrupt",
      ".ifo 中记录的索引大小与所选 .idx 文件不一致。"
    );
  }
  if (dictionary.synwordcount > 0 && !fileSet.synFile) {
    throw uiError(
      "missing-files",
      "该词典声明了同义词索引，请同时选择对应的 .syn 文件。"
    );
  }
  if (dictionary.synwordcount === 0 && fileSet.synFile) {
    throw uiError(
      "corrupt",
      "选择了 .syn 文件，但 .ifo 没有声明同义词索引。"
    );
  }

  return {
    ...fileSet,
    dictionary,
    compatible: true,
    hasSynonyms: Boolean(fileSet.synFile)
  };
}

export function createStarDictProductRecipe(
  inspection,
  {
    cryptoProvider = globalThis.crypto,
    now = Date.now
  } = {}
) {
  const id = String(cryptoProvider?.randomUUID?.() || "")
    .toLowerCase();
  if (!/^[a-f0-9-]{36}$/.test(id)) {
    throw uiError(
      "activation",
      "浏览器无法生成安全的本地词典标识。"
    );
  }
  const timestamp = Number(now());
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw uiError("activation", "无法生成本地词典导入标识。");
  }

  const sourceId = "stardict-" + id;
  const packVersion =
    "import-" + timestamp.toString(36) + "-" + id.slice(0, 8);

  return {
    schemaVersion: 1,
    semanticProfile: "en-zh-plain-text-translation-v1",
    packId: "local-" + sourceId,
    packVersion,
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    dictionary: {
      bookname: inspection.dictionary.bookname,
      sourceId,
      sourceVersion: packVersion
    },
    assertions: {
      plainTextRepresentsTargetTranslation: true,
      localUseOnly: true
    }
  };
}

export function userMessageForStarDictError(error) {
  if (error?.name === "AbortError") {
    return "已取消本地词典导入。已完成的旧词典不会受到影响。";
  }
  if (error?.userMessage) return error.userMessage;

  const code = String(error?.code || "");
  if (
    code === STARDICT_IMPORT_ERROR.LIMIT ||
    code === "STARDICT_IMPORT_LIMIT" ||
    code === "PACK_QUOTA"
  ) {
    return "词典超过当前安全大小限制，未导入任何内容。";
  }
  if (code === STARDICT_IMPORT_ERROR.UNSUPPORTED) {
    return "该 StarDict 使用当前版本不支持的格式或字段。";
  }
  if (code === STARDICT_IMPORT_ERROR.UNSAFE_CONTENT) {
    return "词典包含当前安全策略禁止的可执行、富文本或不安全内容。";
  }
  if (
    code === STARDICT_IMPORT_ERROR.CORRUPT ||
    code === "PACK_CORRUPT" ||
    code === "PACK_HASH"
  ) {
    return "词典文件损坏、缺失或彼此不匹配，未保存任何内容。";
  }
  if (/semantic|recipe|bookname/i.test(String(error?.message || ""))) {
    return "词典语义与当前“英文词头 → 简体中文纯文本释义”导入模式不匹配。";
  }
  return "词典在验证或保存时失败。现有词典保持不变，可以检查文件后重试。";
}

export function initializeStarDictImportUi({
  runtime = globalThis.chrome?.runtime,
  WorkerCtor = globalThis.Worker,
  cryptoProvider = globalThis.crypto,
  setStatus = setPageStatus
} = {}) {
  const fileInput = document.getElementById("stardictFiles");
  const inspectionBox = document.getElementById("stardictInspection");
  const metadata = document.getElementById("stardictInspectionMeta");
  const confirmation = document.getElementById("stardictSemanticConfirmation");
  const importButton = document.getElementById("stardictImportButton");
  const cancelButton = document.getElementById("stardictCancelButton");
  const progress = document.getElementById("stardictImportProgress");
  if (
    !fileInput ||
    !inspectionBox ||
    !metadata ||
    !confirmation ||
    !importButton ||
    !cancelButton ||
    !progress
  ) {
    return null;
  }

  let inspection = null;
  let busy = false;
  const controller = createStarDictImportController({
    runtime,
    WorkerCtor,
    cryptoProvider,
    onProgress(event) {
      progress.textContent = progressLabel(event.phase);
    }
  });

  fileInput.addEventListener("change", async () => {
    inspection = null;
    confirmation.checked = false;
    confirmation.disabled = true;
    importButton.disabled = true;
    inspectionBox.hidden = false;
    metadata.textContent = "正在检测 StarDict 文件…";
    progress.textContent = "";

    try {
      inspection = await inspectStarDictFiles(fileInput.files);
      metadata.replaceChildren(
        metaLine("词典名称", inspection.dictionary.bookname),
        metaLine("StarDict 版本", inspection.dictionary.version),
        metaLine(
          "正文格式",
          inspection.format === "dictzip"
            ? "dictzip (.dict.dz)"
            : "纯文本容器 (.dict)"
        ),
        metaLine(
          "同义词索引",
          inspection.hasSynonyms ? "包含 .syn" : "无"
        ),
        metaLine("兼容性", "支持导入")
      );
      confirmation.disabled = false;
      setStatus(
        "文件检测通过。导入前请确认该词典的语义方向。"
      );
    } catch (error) {
      metadata.textContent = userMessageForStarDictError(error);
      setStatus(userMessageForStarDictError(error), true);
    }
  });

  confirmation.addEventListener("change", () => {
    importButton.disabled =
      busy || !inspection || !confirmation.checked;
  });

  importButton.addEventListener("click", async () => {
    if (!inspection || !confirmation.checked || busy) return;
    busy = true;
    importButton.disabled = true;
    fileInput.disabled = true;
    confirmation.disabled = true;
    cancelButton.hidden = false;
    progress.textContent = "读取文件";
    setStatus("正在导入本地 StarDict 词典…");

    try {
      const recipe = createStarDictProductRecipe(
        inspection,
        { cryptoProvider }
      );
      await controller.importDictionary({
        format: inspection.format,
        ifoFile: inspection.ifoFile,
        idxFile: inspection.idxFile,
        dictFile: inspection.dictFile,
        synFile: inspection.synFile,
        recipe,
        displayMetadata: {
          name: inspection.dictionary.bookname,
          format: "stardict"
        }
      });
      progress.textContent = "完成";
      setStatus(
        `${inspection.dictionary.bookname} 已安装，可立即用于网页划词查询。`
      );
      document.dispatchEvent(
        new CustomEvent("translateflow:dictionary-state-changed")
      );
    } catch (error) {
      const message = userMessageForStarDictError(error);
      progress.textContent =
        error?.name === "AbortError" ? "已取消" : "导入失败";
      setStatus(message, error?.name !== "AbortError");
    } finally {
      busy = false;
      fileInput.disabled = false;
      confirmation.disabled = !inspection;
      importButton.disabled =
        !inspection || !confirmation.checked;
      cancelButton.hidden = true;
    }
  });

  cancelButton.addEventListener("click", async () => {
    cancelButton.disabled = true;
    try {
      await controller.cancel({ hard: false });
      progress.textContent = "正在取消…";
    } finally {
      cancelButton.disabled = false;
    }
  });

  window.addEventListener("pagehide", () => controller.dispose(), {
    once: true
  });
  return controller;
}

function parseFileName(name) {
  const text = String(name || "");
  const lower = text.toLocaleLowerCase("en-US");
  const extension = SUPPORTED_EXTENSIONS.find(
    (item) => lower.endsWith(item)
  );
  if (!extension) return null;
  const base = text.slice(0, -extension.length);
  if (!base || /[\\/]/u.test(base)) return null;
  return { base, extension };
}

function normalizeInspectionError(error) {
  if (error?.code === STARDICT_IMPORT_ERROR.UNSUPPORTED) {
    return uiError(
      "unsupported",
      "该词典不是当前支持的 StarDict 2.4.2 / 3.0.0、UTF-8、sametypesequence=m 纯文本格式。"
    );
  }
  if (error?.code === STARDICT_IMPORT_ERROR.LIMIT) {
    return uiError(
      "size-limit",
      "词典元数据超过当前安全限制。"
    );
  }
  return uiError(
    "corrupt",
    "无法读取 .ifo 元数据；文件可能损坏或格式不完整。"
  );
}

function progressLabel(phase) {
  if (phase === "read") return "读取文件";
  if (phase === "worker" || phase === "convert" || phase === "stage") {
    return "转换词典";
  }
  if (phase === "commit") return "验证并保存";
  if (phase === "done") return "完成";
  return "处理中…";
}

function metaLine(label, value) {
  const line = document.createElement("div");
  const term = document.createElement("strong");
  term.textContent = label + "：";
  const text = document.createElement("span");
  text.textContent = String(value || "");
  line.append(term, text);
  return line;
}

function uiError(code, userMessage) {
  const error = new Error(userMessage);
  error.code = code;
  error.userMessage = userMessage;
  return error;
}

function setPageStatus(message, isError = false) {
  const target = document.getElementById("status");
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("error", Boolean(isError));
}

if (typeof document !== "undefined") {
  initializeStarDictImportUi();
}
