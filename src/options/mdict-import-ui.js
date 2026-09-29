import {
  MDICT_IMPORT_ERROR,
  MDICT_IMPORT_LIMITS
} from "../background/packs/importers/mdict-contract.js";
import {
  parseMdictHeader
} from "../background/packs/importers/mdict-metadata.js";
import {
  createMdictImportController
} from "./mdict-import-controller.js";

export async function inspectMdictFile(file) {
  if (
    !file ||
    !/\.mdx$/iu.test(String(file.name || "")) ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0
  ) {
    throw uiError(
      "unsupported",
      "请选择一个 .mdx MDict 词典文件。"
    );
  }
  if (file.size > MDICT_IMPORT_LIMITS.fileBytes) {
    throw uiError(
      "size-limit",
      "MDX 文件超过当前 128 MiB 安全上限。"
    );
  }

  const prefix = new Uint8Array(
    await file
      .slice(
        0,
        Math.min(
          file.size,
          MDICT_IMPORT_LIMITS.headerBytes + 8
        )
      )
      .arrayBuffer()
  );
  let header;
  try {
    header = parseMdictHeader(prefix);
  } catch (error) {
    throw normalizeInspectionError(error);
  }
  if (header.format && header.format !== "Text") {
    throw uiError(
      "unsupported",
      "当前只支持 MDict Text 格式，不渲染富文本内容。"
    );
  }
  return {
    file,
    header,
    compatible: true
  };
}

export function createMdictProductRecipe(
  inspection,
  {
    cryptoProvider = globalThis.crypto,
    now = Date.now
  } = {}
) {
  const id = String(
    cryptoProvider?.randomUUID?.() || ""
  ).toLowerCase();
  if (!/^[a-f0-9-]{36}$/u.test(id)) {
    throw uiError(
      "activation",
      "浏览器无法生成安全的本地词典标识。"
    );
  }
  const timestamp = Number(now());
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw uiError(
      "activation",
      "无法生成本地词典导入标识。"
    );
  }

  const sourceId = "mdict-" + id;
  const packVersion =
    "import-" +
    timestamp.toString(36) +
    "-" +
    id.slice(0, 8);
  return {
    schemaVersion: 1,
    semanticProfile:
      "en-zh-plain-text-translation-v1",
    packId: "local-" + sourceId,
    packVersion,
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    dictionary: {
      title:
        inspection.header.title ||
        inspection.file.name.replace(/\.mdx$/iu, ""),
      sourceId,
      sourceVersion: packVersion
    },
    assertions: {
      plainTextRepresentsTargetTranslation: true,
      localUseOnly: true
    }
  };
}

export function userMessageForMdictError(error) {
  if (error?.name === "AbortError") {
    return "已取消 MDict 导入。现有词典保持不变。";
  }
  if (error?.userMessage) return error.userMessage;
  const code = String(error?.code || "");
  if (
    code === MDICT_IMPORT_ERROR.LIMIT ||
    code === "MDICT_IMPORT_LIMIT" ||
    code === "PACK_QUOTA"
  ) {
    return "词典超过当前安全大小或解压限制，未导入任何内容。";
  }
  if (code === MDICT_IMPORT_ERROR.UNSUPPORTED) {
    return "该 MDX 使用当前不支持的版本、加密、压缩或展示功能。";
  }
  if (code === MDICT_IMPORT_ERROR.UNSAFE_CONTENT) {
    return "词典包含 HTML、跳转、控制字符或其它禁止内容，已拒绝导入。";
  }
  if (
    code === MDICT_IMPORT_ERROR.CORRUPT ||
    code === "PACK_CORRUPT" ||
    code === "PACK_HASH"
  ) {
    return "MDX 文件损坏或索引/校验不一致，未保存任何内容。";
  }
  return "词典在验证或保存时失败。现有词典保持不变。";
}

export function initializeMdictImportUi({
  runtime = globalThis.chrome?.runtime,
  WorkerCtor = globalThis.Worker,
  cryptoProvider = globalThis.crypto,
  setStatus = setPageStatus
} = {}) {
  const fileInput = document.getElementById("mdictFile");
  const box = document.getElementById("mdictInspection");
  const metadata = document.getElementById("mdictInspectionMeta");
  const confirmation =
    document.getElementById("mdictSemanticConfirmation");
  const importButton =
    document.getElementById("mdictImportButton");
  const cancelButton =
    document.getElementById("mdictCancelButton");
  const progress =
    document.getElementById("mdictImportProgress");
  if (
    !fileInput ||
    !box ||
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
  const controller = createMdictImportController({
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
    box.hidden = false;
    metadata.textContent = "正在检测 MDX 元数据…";
    progress.textContent = "";
    try {
      inspection = await inspectMdictFile(
        fileInput.files?.[0]
      );
      metadata.replaceChildren(
        metaLine("词典名称", inspection.header.title || "未命名"),
        metaLine(
          "MDX 引擎",
          inspection.header.generatedByEngineVersion
        ),
        metaLine("编码", inspection.header.encoding.name),
        metaLine("内容模式", "纯文本数据；不渲染 HTML/CSS/JS"),
        metaLine("兼容性", "头部通过；导入时完整校验")
      );
      confirmation.disabled = false;
      setStatus(
        "文件头检测通过。导入前请确认语义方向。"
      );
    } catch (error) {
      const message = userMessageForMdictError(error);
      metadata.textContent = message;
      setStatus(message, true);
    }
  });

  confirmation.addEventListener("change", () => {
    importButton.disabled =
      busy || !inspection || !confirmation.checked;
  });

  importButton.addEventListener("click", async () => {
    if (!inspection || !confirmation.checked || busy) return;
    busy = true;
    fileInput.disabled = true;
    confirmation.disabled = true;
    importButton.disabled = true;
    cancelButton.hidden = false;
    progress.textContent = "读取文件";
    try {
      const recipe = createMdictProductRecipe(
        inspection,
        { cryptoProvider }
      );
      const result = await controller.importDictionary({
        mdxFile: inspection.file,
        recipe,
        displayMetadata: {
          name: recipe.dictionary.title,
          format: "mdict"
        }
      });
      progress.textContent =
        "完成 · " +
        formatBytes(result.ready.metrics.outputBytes);
      setStatus(
        recipe.dictionary.title +
          " 已安装，可立即用于网页划词查询。"
      );
      document.dispatchEvent(
        new CustomEvent(
          "translateflow:dictionary-state-changed"
        )
      );
    } catch (error) {
      const message = userMessageForMdictError(error);
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

  window.addEventListener(
    "pagehide",
    () => controller.dispose(),
    { once: true }
  );
  return controller;
}

function normalizeInspectionError(error) {
  if (error?.code === MDICT_IMPORT_ERROR.UNSUPPORTED) {
    return uiError(
      "unsupported",
      "仅支持未加密的 MDX 2.0、UTF-8/UTF-16、Text 数据；不支持 LZO、Compact/StyleSheet、MDD。"
    );
  }
  if (error?.code === MDICT_IMPORT_ERROR.LIMIT) {
    return uiError(
      "size-limit",
      "MDX 元数据超过当前安全限制。"
    );
  }
  return uiError(
    "corrupt",
    "无法读取 MDX 元数据；文件可能损坏或格式不完整。"
  );
}

function progressLabel(phase) {
  if (phase === "read") return "读取文件";
  if (["worker", "convert", "stage"].includes(phase)) {
    return "验证并转换词典";
  }
  if (phase === "commit") return "后台复核并保存";
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

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1) + " MiB";
  }
  return Math.ceil(bytes / 1024) + " KiB";
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
  initializeMdictImportUi();
}
