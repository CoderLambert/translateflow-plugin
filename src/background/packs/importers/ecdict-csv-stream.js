export async function* responseByteChunks(
  response,
  { signal } = {}
) {
  if (!response?.ok) {
    throw new Error(
      `ECDICT download failed with HTTP ${response?.status || "error"}.`
    );
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error(
      "ECDICT download does not expose a readable byte stream."
    );
  }

  try {
    while (true) {
      assertActive(signal);
      const { done, value } = await reader.read();
      if (done) return;
      if (!(value instanceof Uint8Array)) {
        throw new Error(
          "ECDICT download produced a non-byte chunk."
        );
      }
      if (value.byteLength) yield value;
    }
  } finally {
    reader.releaseLock?.();
  }
}

export async function parseCsvChunks(
  chunks,
  {
    signal,
    onChunk = () => {},
    onRow = () => {}
  } = {}
) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const state = {
    field: "",
    row: [],
    inQuotes: false,
    quotePending: false,
    csvRowNumber: 1
  };

  for await (const bytes of chunks) {
    assertActive(signal);
    if (!(bytes instanceof Uint8Array)) {
      throw new Error(
        "ECDICT CSV stream must yield Uint8Array chunks."
      );
    }
    onChunk(bytes);
    consumeCsvText(
      decoder.decode(bytes, { stream: true }),
      state,
      onRow
    );
  }

  const tail = decoder.decode();
  if (tail) consumeCsvText(tail, state, onRow);
  finishCsv(state, onRow);
}

function consumeCsvText(text, state, onRow) {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (state.inQuotes) {
      if (state.quotePending) {
        if (char === '"') {
          state.field += '"';
          state.quotePending = false;
          continue;
        }
        state.quotePending = false;
        state.inQuotes = false;
      } else if (char === '"') {
        state.quotePending = true;
        continue;
      } else {
        state.field += char;
        continue;
      }
    }

    if (char === ",") {
      pushField(state);
      continue;
    }
    if (char === "\n") {
      pushField(state);
      pushRow(state, onRow);
      continue;
    }
    if (char === "\r") {
      continue;
    }
    if (char === '"' && state.field.length === 0) {
      state.inQuotes = true;
      continue;
    }
    state.field += char;
  }
}

function finishCsv(state, onRow) {
  if (state.inQuotes && !state.quotePending) {
    throw new Error(
      "ECDICT CSV ended inside a quoted field."
    );
  }
  if (state.quotePending) {
    state.quotePending = false;
    state.inQuotes = false;
  }
  if (state.field.length || state.row.length) {
    pushField(state);
    pushRow(state, onRow);
  }
}

function pushField(state) {
  state.row.push(state.field);
  state.field = "";
}

function pushRow(state, onRow) {
  if (state.row.length === 1 && state.row[0] === "") {
    state.row = [];
    state.csvRowNumber += 1;
    return;
  }
  onRow(state.row, state.csvRowNumber);
  state.row = [];
  state.csvRowNumber += 1;
}

function assertActive(signal) {
  if (!signal?.aborted) return;
  throw new DOMException(
    "ECDICT curated dictionary install cancelled.",
    "AbortError"
  );
}
