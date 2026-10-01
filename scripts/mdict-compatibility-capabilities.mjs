/**
 * Stable, inspector-owned capability vocabulary for sanitized MDX/MDD reports.
 * These identifiers describe observed format/record features. They do not
 * claim that the product imports or renders every observed feature.
 */
export const MDICT_COMPATIBILITY_CAPABILITIES = Object.freeze({
  mdx: Object.freeze({
    engineV2: "mdx.engine.v2",
    requiredEngineVersion: "mdx.required-engine-version",
    encodingUtf8: "mdx.encoding.utf8",
    encodingUtf16le: "mdx.encoding.utf16le",
    encodingGbk: "mdx.encoding.gbk",
    encodingBig5: "mdx.encoding.big5",
    encodingGb18030: "mdx.encoding.gb18030",
    encodingOther: "mdx.encoding.other",
    keyInfoEncryptionV2: "mdx.encryption.key-info-v2",
    keyInfoCompressionZlib: "mdx.key-info.compression-zlib",
    passwordProtected: "mdx.encryption.password-protected",
    recordEncryption: "mdx.encryption.record",
    compressionNone: "mdx.compression.none",
    compressionZlib: "mdx.compression.zlib",
    compressionLzo: "mdx.compression.lzo",
    compressionUnknown: "mdx.compression.unknown",
    recordHtml: "mdx.record.html",
    recordText: "mdx.record.text",
    recordFormatOther: "mdx.record-format.other",
    styleSheet: "mdx.style-sheet",
    compactRecords: "mdx.compact-records",
    aliasLink: "mdx.alias-link"
  }),
  mdd: Object.freeze({
    engineV2: "mdd.engine.v2",
    requiredEngineVersion: "mdd.required-engine-version",
    encodingUtf8: "mdd.encoding.utf8",
    encodingUtf16le: "mdd.encoding.utf16le",
    encodingGbk: "mdd.encoding.gbk",
    encodingBig5: "mdd.encoding.big5",
    encodingGb18030: "mdd.encoding.gb18030",
    encodingOther: "mdd.encoding.other",
    encryptionKeyInfoV2: "mdd.encryption.key-info-v2",
    passwordProtected: "mdd.encryption.password-protected",
    recordEncryption: "mdd.encryption.record",
    compressionNone: "mdd.compression.none",
    compressionZlib: "mdd.compression.zlib",
    compressionLzo: "mdd.compression.lzo",
    compressionUnknown: "mdd.compression.unknown",
    resourcePathNormalization: "mdd.resource.path-normalization",
    resourceFormatOther: "mdd.resource.format-other"
  }),
  rich: Object.freeze({
    htmlStructure: "rich.html-structure",
    inlineStyle: "rich.inline-style",
    styleSheetReference: "rich.style-sheet-reference",
    compactStyleMarker: "rich.compact-style-marker",
    imageReference: "rich.image-reference",
    audioReference: "rich.audio-reference",
    localAnchor: "rich.local-anchor",
    entryReference: "rich.entry-reference",
    soundReference: "rich.sound-reference",
    relativeResourcePath: "rich.relative-resource-path",
    otherUriScheme: "rich.other-uri-scheme",
    remoteUrl: "rich.remote-url",
    unusualResourceExtension: "rich.unusual-resource-extension"
  })
});

export const MDICT_COMPATIBILITY_RESULT = Object.freeze({
  SUPPORTED: "supported",
  PARTIALLY_SUPPORTED: "partially_supported",
  UNSUPPORTED: "unsupported"
});

export const MDICT_COMPATIBILITY_MATRIX_STATUS = Object.freeze({
  PASS: "PASS",
  PASS_WITH_LIMITATIONS: "PASS_WITH_LIMITATIONS",
  BLOCKED_BY_CAPABILITY: "BLOCKED_BY_CAPABILITY",
  UNSUPPORTED_BY_POLICY: "UNSUPPORTED_BY_POLICY",
  NOT_TESTED: "NOT_TESTED"
});
