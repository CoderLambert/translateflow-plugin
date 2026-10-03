# MDX/MDD 二进制、compact index 与 OPFS 内部

源码基线：main `86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d`，2026-10-03静态复核。本文完整解释29个运行时文件与6个测试文件；另列局部调用边界。所有运行测试、构建、安装、真实浏览器和实际词典核验均 **NOT_RUN**；未执行产品代码。本文无词典正文、下载地址或私人文件路径。

先读[导入与安全展示完整链](../features/local-dictionary-import.md)和[此前模块章](dictionary-import-render.md)，再读本篇[内部流程](../features/mdict-storage-internals.md)。本篇展开前章的partial-parser/partial-storage/partial-mdd-manager；UI/Worker/sanitizer已经完整解释的文件复用旧章，不重复计数。旧文本MDict→结构化投影、普通TFLex/StarDict索引并不因本篇完成而算全覆盖。

## 数据层次与身份

1. 用户File交Worker，parser只需要size/read；原始MDX/MDD保留，compact JSON只记header与块描述符，不展开所有entries/正文。
2. MDX key recordOffset指向“所有record块解压拼接后的逻辑流”，dataOffset指向“源文件中的压缩块”。这两个坐标不可混用；entry可横跨record块，多个MDX key可共用recordOffset。
3. header checksum是小端Adler32，key preamble与block checksum是大端Adler32；安装index另用SHA-256与snapshot关联。Adler32不是安全签名，index hash也不是整份source的密码学身份。
4. OPFS按root/pack/version存bytes；chrome.storage.local的tfRichMdictStateV1保存active/reservation。资源snapshot.packVersion指resourceVersion，外层active.packVersion指MDX版本。
5. service worker结束后内存cache/队列/取消map丢失；重新从state和OPFS读回。这里的restore是恢复已安装指针与按需读取，不是自动修复损坏文件，也不是任意私有词典兼容认证。

<a id="known-boundaries"></a>
## 必须保留的main现状与证据边界

- rich key codec目前将解码首末key规范化后与descriptor的原始首末字符串比较，源descriptor含会被case-fold/StripKey/NFKC改变的拼写时可能被误拒为边界不匹配。本文忠实记录这个不对称比较；独立未合入修正不能写成main能力。需要修正时同时核对raw边界与lookup边界，并加入独立合成回归；本文不修代码、不复用分支结果作main测试。
- MDX建索引/commit并不逐块解码全部record payload；MDD commit另做verifyMddRecordBlocks。MDX正文损坏可能直到查该record才暴露。
- MDX index cache是无显式总容量的Map；MDD才有按序列化字节32 MiB的LRU。二者都不是对原始文件每次重新计算hash的cache。
- MDD查询把signal传给codec；MDD建索引与提交全record验证当前主要靠range前后/阶段边界观察signal，相关decodeMdictBlock调用没有signal，不能承诺立即中断正在inflate的块。
- parser返回rawRecord不等于已安全渲染。媒体结构门不是完整媒体decoder，CSS分类不是CSS清洗。展示的安全边界仍在Content sanitizer/隔离viewer，词典脚本及远程资源仍不可执行/加载。

## 逐文件正文

每节链接固定到本轮commit并给出完整源blob；行号覆盖该文件，本节再点出关键函数。测试链接指现有静态断言，而非PASS结论。

<a id="file-mdict-contract"></a>
### importers/mdict-contract.js：二进制与错误基础合同

[源码 L1–187](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdict-contract.js#L1-L187) · blob `384fb9dde6bc4c61cd82ae7880dd971fba887069`

- 导出 MDICT_IMPORT_LIMITS、MDICT_IMPORT_ERROR、MDictImportError、MDictCursor 及字节/计数校验器，供两种 parser 和旧文本导入链共用。默认上限为源128 MiB、header256 KiB、key index16 MiB、块32 MiB、record流128 MiB、entry512 KiB、百万entry、65536块、headword1024字节；rich/MDD 会覆盖部分值，不能把默认32 MiB当它们的实际块上限。
- mdictBytes 接收 Uint8Array、ArrayBuffer 或视图，保留视图偏移和长度；cursor持有本次解析的 bytes/offset，read返回 subarray 并前移；uint16/32/64大端与header checksum的小端分开。64位值转 Number 后必须是 safe integer。越界/截断为 CORRUPT，超上限或整数不安全为 LIMIT；UNSUPPORTED 与 UNSAFE_CONTENT 不合并成“损坏”。
- adler32按4096字节周期取模，返回无符号32位；只作格式完整性检查，不是认证签名。requireMdictSafeSourceId/requireMdictText服务旧导入recipe输入，不能绕过rich pack/version校验。
- 无持久化或I/O；调用者持有字节生命周期。修改端序、视图处理、错误码或公共默认值会同时影响rich MDX、MDD和旧文本lane。回归入口：[MDX格式/安全](#tests-mdx)、[MDD格式/安全](#tests-mdd)，全部NOT_RUN。

<a id="file-mdict-metadata"></a>
### importers/mdict-metadata.js：共享header属性解析与旧文本lane约束

[源码 L1–346](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdict-metadata.js#L1-L346) · blob `7a454679a48d18442d57caf00f8cebd4feb2644f`

- parseDictionaryAttributes只接受单个自闭合 Dictionary 或 Library_Data，属性名为ASCII标识符、值须双引号；逐片段推进，重复属性拒绝，结果用无原型对象。XML命名/数值实体只做文本解码，不调用DOM、不执行DTD，也不把它当通用XML解析器。
- normalizeMdictEncoding只映射UTF-8和UTF-16LE系列别名；fatal decoder遇坏字节转CORRUPT。parseEncryptedFlag将空/No置0、Yes置1，只允许整数0…3；是否支持由上层决定。validateMdictHeadword拒绝空、危险控制和HTML样式标记，并要求lexical normalization非空。
- parseMdictHeader是旧文本路径：检查UTF-16LE header尺寸/Adler32、GeneratedByEngineVersion=2.0，只允许未加密，拒绝Compact/Compat=Yes和非空StyleSheet。它返回RequiredEngineVersion但这里不作rich式版本门控。sanitizeMdictRecord统一换行/trim、拒绝空、控制符、HTML及@@@LINK，限制UTF-8大小。不能用这些旧路径拒绝规则推断rich路径不支持HTML或key-info加密。
- 共享纯函数无持久状态；metadata清洗仅截断标题等，并非HTML sanitizer。修改属性语法、实体、encoding/headword规则会传到rich MDX/MDD建索引；修改旧header/sanitize主要影响旧文本投影，需另查旧core/semantic。测试连接[MDX](#tests-mdx)、[MDD](#tests-mdd)；旧文本完整流程仍待解释。

<a id="file-block-codec"></a>
### importers/mdict-block-codec.js：受限解压与key-info解密

[源码 L1–229](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdict-block-codec.js#L1-L229) · blob `cac7784ae5d3999458adfeca33e7fa2309529871`

- decodeMdictBlock输入完整压缩块、声明展开尺寸、limits、可选stream factory/AbortSignal，输出bytes与compression。块头前4字节为00/01/02 00 00 00标识，随后4字节大端Adler32。none直接取payload；01=LZO和未知标识是UNSUPPORTED；02经DecompressionStream('deflate')。解压前限制压缩/声明展开量，逐chunk限制实际量，最终要求精确尺寸与checksum。
- inflateBounded建立Blob→stream→reader；AbortSignal会reader.cancel，finally移除listener并releaseLock。无DecompressionStream为UNSUPPORTED，流解码失败为CORRUPT，超预算为LIMIT，AbortError原样保持取消语义。concatMdictBytes仅组合已验证chunk；它本身不另查总量。
- decryptMdictKeyInfoBlock只接受zlib头，从checksum字节加固定salt推导RIPEMD-128密钥；保留前8字节，对payload作半字节交换，再与前一密文字节、位置和循环key XOR。这是格式互操作算法，不是密码保护或record加密支持；结果仍要走解压和Adler32。
- 全部状态为本次调用，内存峰值包含chunk集合及最后合并buffer。改这里会影响所有块、查询取消及MDD提交全块核验；[MDX](#tests-mdx)、[MDD](#tests-mdd)覆盖部分格式/损坏，NOT_RUN。

<a id="file-ripemd"></a>
### importers/mdict-ripemd128.js：RIPEMD-128格式原语

[源码 L1–114](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdict-ripemd128.js#L1-L114) · blob `28ede7586d9d629b918ce6bf1eb4880651068d21`

- ripemd128经mdictBytes收字节，0x80填充后补至64字节边界，末8字节写小端bit长度。每块读取16个小端word，使用固定R/RR与S/SS调度、四轮左右常数与布尔函数，双路64步rotateLeft后合并四个32位状态；输出16字节小端digest。
- 仅被key-info解密用作格式key推导；不会访问WebCrypto、网络或持久库，也不承担安装index的SHA-256身份。内存为padding副本+word/state，输入大小由上游限制，本函数无独立业务限额。
- 修改round顺序、32位截断、padding或端序会令Encrypted=2全部不可读。[MDX格式测试](#test-rich-format)用空输入和abc的固定向量，但本轮NOT_RUN；向量通过也不代表整套词典密码解密支持。

<a id="file-rich-metadata"></a>
### importers/mdict-rich-metadata.js：rich MDX header与规范化

[源码 L1–169](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdict-rich-metadata.js#L1-L169) · blob `95289e4b94c6146717a9a3c7f65ebdb6e60eb39b`

- parseRichMdictHeader读取大端header长度、UTF-16LE字节、小端Adler32；长度至少4且偶数，先验checksum再fatal decode，移除尾NUL后交共享属性parser。GeneratedByEngineVersion必须精确2.0；RequiredEngineVersion空时默认2.0，否则须合法正数且≤2。Format仅HTML/Text；Encrypted仅0/2，1/3受保护record不支持。
- title等清理控制符、trim并限4096字符；encoding保留decoder供建索引。KeyCaseSensitive/StripKey只接Yes/No（缺省false）。StyleSheet最多64 KiB，按三行(id/begin/end)解为最多255条、ID唯一且1…255；这里只保留原始样式片段，实际安全展示由Content sanitizer负责。
- normalizeRichMdictLookupKey执行NFKC；非大小写敏感时lowercase；StripKey时移除Unicode标点/分隔/空白。它不做源header边界的自动修复，亦不同于先trim/合并空白的normalizeLexicalExactKey。Compact/Compat文本在后续index validator要求Yes/No。
- 无I/O或持久状态。更改normalization必须同步建索引、候选比较、旧index身份与回归；见[现有边界](#known-boundaries)。测试：[MDX](#tests-mdx)，NOT_RUN。

<a id="file-range-source"></a>
### importers/mdict-rich-source.js：统一range source与取消边界

[源码 L1–75](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdict-rich-source.js#L1-L75) · blob `4bfeeeed2b3c8184a08f65e96b4f0db7ce060063`

- source是{size, read(offset,length,signal)}，可来自Worker File或后台OPFS。validateMdictSource确认safe size/read和fileBytes上限；readSourceRange验证非负整数范围在size内，将结果统一为字节并要求精确长度，短读是CORRUPT。
- withMdictAbortSignal包装原source，在read前后检查给定signal并传给底层；readSourceRange另接受signal、检查前后。已有MDictImportError和AbortError保留，普通I/O异常包装成CORRUPT并携cause。
- 包装器只有引用/size，无文件handle缓存、网络、持久化或自动重试。它允许length=0而OPFS adapter拒绝0，实际parser读取的是非空布局片段；不能把两个层的输入合同等同。AbortSignal不能中断不观察它的同步解析代码。
- 修改范围/错误/取消传递需一起验证Worker、OPFS、MDX/MDD建索引和查询。[MDD取消测试](#test-mdd-security)、[OPFS测试](#test-opfs)为相关静态证据，NOT_RUN。

<a id="file-rich-key-codec"></a>
### importers/mdict-rich-key-codec.js：key与record描述符解码

[源码 L1–181](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdict-rich-key-codec.js#L1-L181) · blob `7ae5eebbf5d77b7f165fa8c478b389642efc3b7d`

- parseKeyBlockDescriptors读取每块entryCount、首末sized key（uint16长度×encoding单位+NUL）、压缩/展开尺寸，累加firstEntryIndex与dataOffset，要求计数及输入余量精确；首末字符串目前原样保留。parseRecordBlockDescriptors读取每块两个uint64尺寸，生成物理dataOffset和展开流uncompressedOffset；safeAdd拒绝超safe integer。
- parseKeyBlock逐条读uint64 recordOffset和有界NUL终止UTF-8/UTF-16LE headword，校验headword与非递减offset，允许多个key共享offset。每1024条及前后检查signal。null扫描最多约1024字节，缺terminator/多余数据/边界不符拒绝；record总范围由调用者再查。
- 当前边界比较是normalizeRichMdictLookupKey(decoded first/last)对descriptor原始firstKey/lastKey，二者不对称。这是main实际实现，不能写成两边都规范化；见[已知边界](#known-boundaries)。
- 不存全词典key表，只返回当前块数组；描述符由index持有。修改key终止、编码、offset单调或边界比较会影响建索引、查询、MDD共用record descriptor和旧index重建一致性。[MDX格式/安全](#tests-mdx)相关，NOT_RUN。

<a id="file-rich-index"></a>
### importers/mdict-rich-index.js：从MDX范围构建compact index

[源码 L1–399](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdict-rich-index.js#L1-L399) · blob `d400c48499759fb56b1f58978732f9e27b1b36d0`

- buildRichMdictIndex依次读取4字节长度→header+checksum→44字节key preamble；前40字节Adler32对最后4字节。preamble五个uint64是key块数、entry数、key-info展开/压缩尺寸和key块总尺寸。key-info可Encrypted=2解密，但解码后必须zlib；与MDD未加密key-info接受none的行为不同。
- 从key-info构造描述符，核对压缩总量；record section读32字节四字段header和每块16字节descriptor，检查entry数相等、index字节数=块数×16。总展开record受256 MiB上限；物理record结尾必须等于源size，尾部垃圾不接受。
- addKeyBlockLookupBounds逐块解码所有keys，不解码record payload；检查跨块record offset非递减、所有offset小于record流总量，计算实际规范化lookupMinKey/lookupMaxKey和first/lastRecordOffset。候选区间由所有keys的min/max构成，不能假设只看源首末词就有序。
- index存schema/format、可序列化header、entry数、section offsets、key与record描述符及压缩/加密标记，无全部正文/词条数组。序列化大小受keyIndexBytes限制，再validateRichMdictIndex；后台安装另有8 MiB index上限。assertRichMdictIndex结合source与schema检查；decodeRichKeyBlock按descriptor读/解压/校验，可计查询预算。lookupSortKey重导出统一规则。
- source/临时单块key数组按调用生存；index交Worker写JSON或后台缓存。信号贯穿读/解压/循环。修改布局或序列化字段会影响commit的JSON.stringify重建严格比较、旧安装restore及查询；[MDX](#tests-mdx)与既有存储测试相关，全部NOT_RUN。索引成功不证明所有record校验和已读。

<a id="file-rich-validation"></a>
### importers/mdict-rich-validation.js：MDX compact index的不变量

[源码 L1–230](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdict-rich-validation.js#L1-L230) · blob `5029aab06acae31f8f620d4ba73168c36400a473`

- schemaVersion=1、format=mdx-v2-rich。RICH_MDICT_IMPORT_LIMITS覆盖entryCount为400万、record流256 MiB、单压缩/展开块4 MiB，其余继承公共限制。validateRichMdictIndex输入JSON对象与可选sourceSize/limits，成功原对象返回，失败MDICT_CORRUPT或LIMIT。
- header必须2.0、受支持RequiredEngineVersion、UTF-8/UTF-16、HTML/TEXT、0/2加密、布尔key选项、Yes/No Compact/Compat；StyleSheet≤64 KiB、唯一规则≤255且begin/end各≤4096 UTF-8字节。section偏移必须连续关联；key descriptor要求连续物理offset和entry ordinal、record offset单调、非空安全首末key、合法min/max。
- record descriptor必须物理与展开offset连续，最终物理终点=sourceSize，压缩总量与声明相符，展开总量=totalRecordBytes。MDX validator不像MDD使用字段allowlist，也不像MDD在此重算JSON长度；构建/安装外围分别做大小检查。它校验结构而非重新读源，也不提供源内容hash认证。
- 无持久状态。更改schema、header/descriptor规则须考虑已存index重读；放松检查不能替代parser支持。[MDX格式](#test-rich-format)有负offset/跨块递减断言，NOT_RUN。

<a id="file-rich-budget"></a>
### importers/mdict-rich-query-budget.js：一次MDX查询共享预算

[源码 L1–142](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdict-rich-query-budget.js#L1-L142) · blob `2c8748f86984874c9252717fd9d40f3dba8fdad7`

- createRichMdictLookupBudget创建可变metrics和检查方法；同一次lookup的候选、边界补读、alias hops共享它，不能每hop重置。候选/解码key块各256；key压缩8 MiB、key展开32 MiB、record压缩/展开各32 MiB、总展开32 MiB、最多512次range/40 MiB源字节。recordBlockDecodes记指标但MDX此表没有单独块数限额。
- checkCandidatePlan在读取前预估候选总量；consumeKeyBlock/consumeRecordBlock核验再登记；meterRichMdictRangeSource在调用真实read前登记源读取，因此失败尝试也可计入。safe integer/非负/上限违反为LIMIT。report输出冻结副本，诊断回调异常吞掉，不改变查询结果。
- 指标无持久化，aliasHops由lookup循环赋hop+1，包含初始查询，不能直接当已走过重定向数。失败/无命中通过lookup finally报告；验证在预算创建前失败则没有报告。
- 调预算会同时改变大字典可查性和抗资源耗尽边界，需结合候选估计、跨块record及alias链验证。[MDX格式](#test-rich-format)只覆盖部分metrics；完整极限/取消回归见既有取消测试，NOT_RUN。

<a id="file-rich-lookup"></a>
### importers/mdict-rich-lookup.js：MDX exact lookup、record边界与alias

[源码 L1–370](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdict-rich-lookup.js#L1-L370) · blob `2d2bc011c5d1909730b755143508c760566d1c0c`

- lookupRichMdict先验证source/index，再对输入normalizeLexicalExactKey（NFKC、trim、合并空白），拒绝空/控制和超headwordBytes。每跳按header规则生成comparisonKey/lookupSortKey，线性扫描所有key descriptors挑min/max包含query的候选，先预算再解码。
- 块内比较folded key；优先保留normalizeLexicalExactKey意义上的精确拼写，否则首个folded命中。不是prefix搜索、全文搜索或上下文排名，也不是仅查第一个候选块。遍历entry每1024次查取消。
- recordEnd取当前块后续第一个严格更大offset；若多个别名key共用offset，跳过相等值。必要时跨后续key块：last≤start可跳，first>start直接作end，否则解码找更大值；最终用totalRecordBytes。边界补读同样耗预算。record读从二分定位展开块开始，只解压相交块，截取重叠片段并校验拼接长度，单entry≤512 KiB。
- rawRecord经文本decoder后若精确以@@@LINK=开头，验证target并继续；最多8次重定向、共享visited规范化集合，loop/missing target为CORRUPT，超链为LIMIT。初跳无命中返回found:false；成功输出requestedKey、最终displayForm/rawRecord/safeTextFallback及初始aliasTarget。
- 每次调用持有budget、visited、当前块/record临时字节，无解压块跨查询cache。AbortError在read/inflate/循环传递，finally报告metrics。改exact/folded选择、共享offset和alias规则要同时核对key normalization、边界fixture、内存/取消与Content安全渲染；[MDX](#tests-mdx)为相关测试，NOT_RUN。

<a id="file-rich-record-text"></a>
### importers/mdict-rich-record-text.js：record文本、alias target与惰性fallback

[源码 L1–184](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdict-rich-record-text.js#L1-L184) · blob `85e924715f492367ae13f3a500a62ac22d476cf2`

- decodeRichMdictRecordText按encoding单位移除尾NUL，拒绝空buffer，fatal UTF-8/UTF-16LE解码并拒绝危险控制符，限制转成UTF-8后的entry大小，最后trim。它返回原始标记文本，绝非可直接插入DOM的HTML。
- validateRichMdictAliasTarget额外拒绝空/全部控制字符，限制headword字节并复用headword校验。toSafeRichMdictPlainText只去已知StyleSheet ID的Compact标记，用线性scanner移除注释/标签；script/style/iframe/object/embed/form的active子树内容跳过，br及指定块级闭标签变换行。
- scanner遇未闭合或非法tag保留普通文本处理，不借DOM解析。最后才解命名/数字实体、清控制、压缩行内空白/去空行，截到公共entryBytes数量的字符；这个最后slice是字符限制，不是UTF-8字节限制。实体产生的角括号不会再作为tag解析，必须作为text消费。
- 无持久状态；fallback为可读降级，不等同于完整sanitizer或CSS支持。修改顺序可能把实体文本变成active内容，需[MDX安全](#test-rich-security)和既有Content sanitizer/viewer测试；NOT_RUN。

<a id="file-rich-facade"></a>
### importers/mdict-rich.js：rich parser公共出口

[源码 L1–19](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdict-rich.js#L1-L19) · blob `037bdb0b7e26eee660cdbd2b752745480f866efc`

- 纯re-export门面：index构建/assert/decode/range/lookupSortKey，lookup与预算常量，header/normalization，schema/format/limits/validation。后台manager与Worker从此组合入口依赖实际子模块。
- 没有I/O、状态、副作用、错误改写或自动兼容分流；异常/取消保留子模块语义。公共导出改名会影响Worker raw import closure、后台和测试，不能只调整单一调用方。[MDX格式](#test-rich-format)经门面import，NOT_RUN。

<a id="file-mdd-metadata"></a>
### importers/mdd-metadata.js：MDD Library_Data header

[源码 L1–78](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdd-metadata.js#L1-L78) · blob `f5a574be581c53ce82b22f429bccbd0c6ad2dc7a`

- parseMddHeader沿公共cursor读取大端长度、UTF-16LE header及小端Adler32，再限定Library_Data自闭合属性。GeneratedByEngineVersion精确2.0，RequiredEngineVersion缺省2.0且合法正数≤2；Format必须空字符串，Encrypted仅0/2，受保护record拒绝。
- MDD路径固定UTF-16LE在key codec解码；这里不按MDX Encoding选择二进制resource decoder。title清理控制并限制4096字符，返回attributes及格式摘要；没有渲染或I/O。
- 纯输入→header，畸形/校验不一致为CORRUPT，版本/密码能力为UNSUPPORTED。改变header语法、版本、加密支持必须同步MDD validator和key-info路径，[MDD格式/安全](#tests-mdd)相关，NOT_RUN。

<a id="file-resource-path"></a>
### importers/mdd-resource-path.js：虚拟资源路径与排序

[源码 L1–74](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdd-resource-path.js#L1-L74) · blob `253efd9c3d417f613e73e48e7298ba1459eca9c6`

- normalizeMddResourcePath保留拼写与大小写：先限制非空string≤4096字符，拒绝编码后的斜杠/反斜杠/控制，decodeURIComponent一次；随后拒绝控制、残余百分号、冒号、query/hash、URI/驱动器/双根UNC。允许移除一个前导虚拟根分隔符，再把反斜杠改成/；空段、.和..拒绝。
- 这是MDD内部虚拟路径，不映射用户文件系统路径、不联网、不lowercase、不作NFKC。compareMddResourcePaths按Unicode code point逐字符比较，显式处理代理对，不能换成localeCompare或UTF-16 code-unit排序而不破坏独立writer的顺序。
- 无状态，错误UNSAFE_CONTENT。codec、validator、lookup、resource contract共用此函数；后台请求另限制1024字符。修改percent或separator规则会改变规范key、碰撞判定、二分定位和Content资源引用，需要[MDD安全](#test-mdd-security)并核对Content resolver，NOT_RUN。

<a id="file-mdd-key-codec"></a>
### importers/mdd-key-codec.js：MDD key块及全局资源顺序

[源码 L1–184](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdd-key-codec.js#L1-L184) · blob `18251c81fa0810ae70d1fe43aa4b3a1c08a68bd6`

- parseMddKeyBlockDescriptors与MDX布局相似，但sized path长度×2、fatal UTF-16LE、经MDD路径规范化后保存。检查每entry至少12字节能容纳、单块压缩/展开量和100倍压缩比，累加entry ordinal及物理offset。
- parseMddKeyBlock读uint64资源offset+UTF-16LE NUL路径；规范路径必须严格递增，重复/乱序为UNSAFE_CONTENT，offset非递减且<record总量。输入余量及首末路径要精确匹配descriptor；相等offset可入索引，但query遇零长resource会拒绝。
- addMddKeyBlockBounds逐块解码、跨块核对路径严格递增/offset非递减，填first/lastRecordOffset及min/max，累计key展开量≤64 MiB。与MDX min/max任意块扫描不同，有序且不重叠的MDD范围支持二分查找。
- 临时entries仅在单块持有，compact descriptors留在index；同步路径解析没有独立signal检查，range层负责阶段取消。修改排序/规范化/边界需要同时改validator及lookup并验证独立writer fixture；[MDD](#tests-mdd)，NOT_RUN。

<a id="file-mdd-validation"></a>
### importers/mdd-validation.js：MDD index schema与大小限制

[源码 L1–226](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdd-validation.js#L1-L226) · blob `90b6dec6d702abdac1f5d4a646a9a2d5d2e19314`

- schema1/format mdd-v2，源128 MiB、百万keys、index16 MiB、块4 MiB、path4096字节、全部key展开64 MiB、record流128 MiB、单resource8 MiB、压缩比100。validateMddIndex校验source size、数量、header、compression none/zlib与加密标记，以及布局各偏移。
- 根对象/header/key/record descriptor均只允许列举字段；key路径必须已canonical，first/min、last/max一致，跨块严格code-point有序且不重叠，entry数可装进展开块，物理/ordinal/record offsets一致。record连续范围和最终源结尾/总字节必须闭合，所有块做压缩比限制。
- 缺省还JSON.stringify计算compact index大小；热query传checkSerializedSize:false避免重复序列化，但仍走结构验证。它不读取文件或验证每个媒体的真实格式；这些由index构建、record校验和resource policy分担。
- 无持久状态，失败CORRUPT/LIMIT。新增字段会被旧allowlist拒绝，改schema或排序须安排已存JSON兼容及restore策略；[MDD](#tests-mdd)，NOT_RUN。

<a id="file-mdd-index"></a>
### importers/mdd-index.js：MDD建索引和提交前逐record核验

[源码 L1–239](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdd-index.js#L1-L239) · blob `37d84ace16349871604a34e90ec709880d484df0`

- buildMddIndex读取header、44字节preamble及key-info，核对preamble Adler32/数量/上限/压缩比；Encrypted=2走共用key-info解密，未加密允许none或zlib。构造key descriptors，核对key总物理尺寸，读取32字节record header及16×块数描述符，要求entry数对应、record布局正好抵达source末尾。
- 校验record累计展开量和压缩比后逐个key块补canonical范围与record边界，输出schema/header/keyCount/totalKeyBlockBytes及物理/展开布局，不存资源数组或二进制payload。validateMddIndex最终查JSON大小及结构。
- decodeMddKeyBlock供query使用：先消耗预算、range读取与受限解压，再重新核对路径边界和first/lastRecordOffset。verifyMddRecordBlocks是独立步骤：提交前逐个完整record块解压/checksum，统计块数和物理读取量；索引构建自身不做这一遍。
- range wrapper观察signal；当前build与verify中的decodeMdictBlock调用未传signal，因此不可宣称“导入取消能立即打断正在inflate的块”。查询用decodeMddKeyBlock会传signal；提交在阶段结束后再检查。改此处需验证none/zlib、跨record边界、原子附件失败保旧、取消粒度；[MDD](#tests-mdd)，NOT_RUN。

<a id="file-mdd-budget"></a>
### importers/mdd-query-budget.js：跨companion共享的资源预算

[源码 L1–113](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdd-query-budget.js#L1-L113) · blob `494465374d89c1751ce7a2cf6280daec1899b149`

- createMddLookupBudget可用overrides叠加固定默认：16候选/key解码、key压缩8 MiB/展开32 MiB、record压缩40 MiB/展开32 MiB/512次解码、总展开32 MiB、512次range/48 MiB源字节、累计resource8 MiB。
- checkCandidatePlan先查候选声明总量；后续consume系列逐项计数，meter在实际read前登记；addResourceBytes在payload拼接前限制资源总量。一次manager lookup跨全部companion复用同budget，不因换文件重新获得限额。指标回调冻结副本且异常吞掉。
- 与MDX一次consume先全算后赋值不同，MDD各指标逐项add，后一步失败时早先指标可能已增加；不能将失败metrics视作已完成解码。addCandidateCount本身只累加，调用者必须先checkCandidatePlan。
- 临时query state无持久cache；改限额需测companion共享以及resource/压缩炸弹边界。[MDD格式](#test-mdd-format)明确有跨两个source共享预算断言，NOT_RUN。

<a id="file-mdd-lookup"></a>
### importers/mdd-lookup.js：按资源路径恢复二进制字节

[源码 L1–226](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdd-lookup.js#L1-L226) · blob `0bbc68a0b82e75ea891141da5fa641bd12bb133a`

- lookupMddResource验证source/index（跳过重复JSON大小计算）、规范path，创建或校验外部budget，再包装meter。利用全局有序min/max二分找到至多一个候选key块，解码后按code-point二分精确路径。无候选/无key返回found:false，不触发网络或AI。
- resource end取下一entry offset、下一key块firstRecordOffset或record流总量；不同于MDX，它不跳过多个相等offset，零长资源为UNSAFE_CONTENT。先限制resourceBytes并共享计账，二分record块，解压全部重叠块后精确切片/拼接，最终必须正好end-start字节。
- classifyMddResource在交付前核对扩展名/内容结构，输出found/path/mime/kind/bytes及可选dimensions。数据保持Uint8Array，不按文本解码；只有CSS分类器做UTF-8。signal传到range与codec；本地数组同步处理不保证实时抢占。
- 无跨调用块cache，finally报告预算；外部预算也可给本次onMetrics。改recordEnd、二分比较、预算传递或结果类型会影响manager的多文件歧义拒绝、base64响应及前端object URL。测试[MDD](#tests-mdd)，NOT_RUN。

<a id="file-resource-policy"></a>
### importers/mdd-resource-policy.js：资源类型与有限二进制结构门控

[源码 L1–344](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdd-resource-policy.js#L1-L344) · blob `552ad8bbf2b3e817aa0cf5e8b348590e7e7e0234`

- classifyMddResource先限制resourceBytes，按path扩展名分CSS、PNG/JPEG/GIF/WebP、MP3/OGG/WAV；其他类型UNSAFE_CONTENT，包括SVG/HTML/JS。扩展名与签名/结构需匹配；不能因为manager的宽MIME正则出现AAC/MP4/FLAC就声称此parser支持。
- CSS≤64 KiB、fatal UTF-8、拒危险控制，返回stylesheet分类；这里不清洗CSS语法，Content仍须有限编译。图片共同限制正整数尺寸、边≤16384、像素≤16777216；返回mime/kind/dimensions。
- PNG检查signature、首IHDR长度/位深颜色组合、唯一header、至少非空IDAT、精确IEND终止及chunk范围，拒APNG标记；不核PNG每chunk CRC或实际解码IDAT。JPEG遍历marker/segment，取唯一SOF尺寸，要求SOS和末尾EOI；不做完整熵解码。GIF检查屏幕尺寸/调色板/subblock边界、恰一帧/合法LZW最小码长/帧位于屏幕内，拒动画。WebP检查RIFF总长度、VP8X/VP8/VP8L签名及尺寸一致、恰一图像payload、padding终点，拒ANIM/ANMF或动画flag。
- WAV遍历RIFF chunk，须fmt（PCM/float/extensible及非零channels/rate/alignment）和非空data；MP3跳可选ID3并查首frame头有限字段；OGG查首page版本、lacing与payload长度。它们是有限格式/容量门，不是完整媒体解码器或对所有后续frame的认证。各循环有范围或chunk数量界限。
- 无I/O/cache；字节仍为不可信输入，交受隔离viewer，不执行脚本、不取远程资源。扩展类型必须同步manager MIME、Content sanitizer/resolver、媒体结构/炸弹测试及打包边界。[MDD安全](#test-mdd-security)只覆盖部分恶意payload和PNG尺寸，不能替代全部媒体真机播放；NOT_RUN。

<a id="file-mdd-facade"></a>
### importers/mdd.js：MDD公共出口

[源码 L1–14](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdd.js#L1-L14) · blob `7434ce9f90d14d738351d20a26734bc972d3f2a8`

- 门面重导出index构建/解码/全record核验、限制/schema/validator、range、lookup、路径规范化/比较、共享budget。Worker及后台resource manager用同一实现，避免导入与查询各造格式规则。
- 无状态、I/O、副作用或错误包装。移除/改名导出会影响Worker闭包及后台静态import；[MDD格式](#test-mdd-format)经过该入口，NOT_RUN。

<a id="file-opfs-store"></a>
### opfs-store.js：OPFS文件、范围与句柄生命周期

[源码 L1–290](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/opfs-store.js#L1-L290) · blob `91def0803b76a249bb5f97f1193a315ecbdc6649`

- createOpfsPackStore注入rootProvider，缺省navigator.storage.getDirectory，普通root为dictionaries；rich manager明确换root为rich-mdict-dictionaries。路径按root/packId/version/path分层，所有位置经shared pack ID/path校验；不会保留用户系统原始路径或file-system-access授权句柄。
- writeFile按需建目录/文件，createWritable→write→close才完成；失败尽力abort。readFile/getFileSize每次重新寻目录与handle.getFile；前者整文件arrayBuffer，后者只size。readFileRange要求正length、安全offset且不超file.size，用file.slice限定范围；无signal可arrayBuffer，有signal用stream reader逐chunk检查精确长度、abort/cancel并finally释放reader lock，缺stream fallback只能读完后检查取消。
- listPacks/listVersions仅返回安全目录名并英文locale排序；目录不存在返回空。removeVersion/removePack递归删除，NotFound返回false；cleanupPack保留指定versions并逐个删其余。它不自行决定active版本、reservation或事务回滚。
- 工厂只持配置函数，不缓存File/FileSystemFileHandle或同步access handle；reader/writable是单操作资源。storageError保留已有PACK_*错误，否则PACK_STORAGE并带missing标记，AbortError不吞。原生OPFS/extension origin负责持久字节，chrome.storage state负责指针，二者不是一个原子数据库事务。
- 更改root、目录规范、write close或range/cancel会影响rich MDX/MDD及普通词典所有store消费者；先验证[OPFS测试](#test-opfs)，再验证真实浏览器reload/删除失败/取消，不以memory mock代替。全部NOT_RUN。

<a id="file-pack-state"></a>
### state.js：chrome.storage状态与进程内更新串行化

[源码 L1–74](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/state.js#L1-L74) · blob `5d136cae2b973f4c64077f8b62129df6eca7b237`

- createPackStateStore缺省chrome.storage.local与PACK_MANAGER_STATE_KEY；rich manager传tfRichMdictStateV1。验证get/set和stateKey长度。read取单key后normalize；write normalize后set；update在共享队列中read→clone→await mutator→write，mutator出错不会写，catch后的队列仍可继续。
- queuesByStorageArea为模块WeakMap，按storageArea对象再按stateKey共享队列，所以同进程两个manager实例同key的update也串行。read/write本身不排队，这不是跨worker/浏览器进程锁，也不和OPFS文件写原子提交。
- normalizeState固定version1，浅拷贝catalogSequences/packs，存在时保留reservations/resourceReservations，忽略其他顶层字段；没有自动过期清理、内容schema深校验或文件恢复。clone优先structuredClone，否则JSON。state持久化生命周期来自chrome.storage，queue只在当前模块活着时存在。
- 改key/归一化字段会影响普通pack与rich资源指针的恢复，新增reservation字段须在normalize保留。测试与manager存储回归相连；本章未把整个通用pack manager状态机或测试族标为完整，运行NOT_RUN。

<a id="file-rich-contract"></a>
### rich-mdict-contract.js：安装snapshot、身份与外部摘要

[源码 L1–337](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/rich-mdict-contract.js#L1-L337) · blob `a4b57f642633f3624c9c866d3c0ee6dd6333eff5`

- 集中root/state/path常量、源128 MiB/index8 MiB/400万entries/record512 KiB/展示6000字符。validateCommit校验pack/version、metadata尺寸/entryCount/index SHA-256形状，清理标题等返回规范metadata。pack ID为rich-mdict-加36位hex/hyphen形状（并非完整UUID语义验证）；version为import-字母数字-8位hex。
- parseIndex做fatal UTF-8→JSON→rich validator并包装RICH_MDICT_CORRUPT；assertIndexMatchesMetadata比较sourceSize/entryCount。isValidSnapshot检查基本身份、正size/hash等，不是validateCommit的全部上限复核，且normalize可能抛错。makeRichMdictSnapshot以已验index填header/entryCount并加installedAt，cacheKey为packId@packVersion@indexSha256。
- curated provenance从扩展声明recipe推导并严格递归检查JSON shape/value，绑定固定catalog pack及importer；replacement只许声明recipe替换自身，可带expectedActiveVersion。此处记录来源元数据，不授予任何词典内容再分发权。publicRichDictionary投影标题/尺寸/资源计数/installedBytes/status及可用catalog迁移结果，不读OPFS。
- normalizeQuery限制trim后≤256字符且无控制；requestId≤160，rich查询ID固定前缀+32hex；debug metrics仅保留列举非负数。sha256用注入WebCrypto校验index；clampText去NUL并限字符，sanitizeHeaderSummary只保留列举scalar/样式条数，均非通用HTML清洗。
- 纯合同/crypto调用不存状态；来源recipe常量属于信任边界，不能接受前端伪造。改schema/身份/hash/路径会影响旧安装、两类manager、Worker及UI；相关[MDX](#tests-mdx)、既有rich storage测试，NOT_RUN。

<a id="file-rich-manager"></a>
### rich-mdict.js：MDX提交、恢复、cache和删除

[源码 L1–398](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/rich-mdict.js#L1-L398) · blob `5ece857da72a76e13ed9f3e59cda4326a52ac8e0`

- createRichMdictManager组合OPFS store、stateStore、preflight quota、lookup controller。模块级serializeRichMdictPack按packId链Promise，前次失败不会阻断后续，finally删除当前队列尾；MDD manager复用这把进程内队列。manager自有indexCache与operationsByRequest，均重启丢失。
- commit先validate metadata/catalog replacement/requestId并注册verify阶段AbortController，再排队：确认旧目标及reservation；assertStagedFiles检查source size/index size与SHA-256、JSON/metadata，从OPFS范围重建compact index并JSON.stringify严格相等。它校验所有keys/布局，但不像MDD commit逐块解码全部record payload。
- 验证完成后生成snapshot并按既有catalog规则保留资源，phase置commitpoint，再state.update重查目标和reservation，将active一次置healthy/fallback:null并删预留。取消verify会abort；commitpoint只返回cancelled:false。异常未提交时尽力释放reservation/清staging，先检查active指针避免删已激活版本；catalog成功后的旧版本清理属于另外helper，不能假装提交回滚。
- loadIndex每次先查index文件大小，再以pack/version/index hash查Map；cache miss整读index、hash、parse和metadata一致后缓存。MDX此Map没有总量LRU；cache hit不重新hash同尺寸index，源也仅每次检查size，实际读取块仍check Adler32。list会读size/loadIndex给ready/missing/corrupt；listMetadata仅检查state metadata不读OPFS，“ready”两者证据不同。
- reload后由持久active重新打开文件、验证并重建内存cache，不保留原File句柄，也不自动重新建index或修坏源。sourceReader绑定active版本和signal；lookup/lookupDictionary交已讲解controller，rawRecord≤512 KiB UTF-8、fallback≤6000字符，详见[划词章](selection.md#file-rich-lookup-controller)。
- uninstall按pack队列先删OPFS，成功后删state和resource reservations，再删当前index cache；OPFS删除失败留下可重试行，若随后state失败不承诺跨存储回滚。abortImport拒删正在active的version，否则删version并移除匹配reservations。普通本地替换和catalog replacement不混为一谈。
- 改事务顺序、cache身份、root或恢复逻辑需检验失败保旧、too-late cancel、同size伪index、重载和删除失败；现有rich storage测试见[局部测试边界](#partial-tests)，NOT_RUN。源持久化在Worker，manager不把整本字典重新载入内存。

<a id="file-mdd-contract"></a>
### rich-mdd-contract.js：附件集合与资源请求合同

[源码 L1–197](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/rich-mdd-contract.js#L1-L197) · blob `827bdac8ff978f63109641f0c834655839e713a6`

- validateMddCompanions按已装MDX basename匹配基础.mdd和连续.1…编号，大小写不敏感，基础文件必需、最多16、不允许重复/跳号/无关文件；排序输出。safeFileName禁止路径分隔/控制、空/. /..并限240字符。resourceFilePaths按序给resources/000.mdd和000.index.json等固定内部槽位。
- validateResourceSnapshot要求schema1、pack/version、sources非空≤16、槽位精确、size/hash/keyCount合法、文件名唯一且顺序与MDX匹配；每源≤128 MiB、总源≤512 MiB、每index≤16 MiB、总index≤32 MiB。makeResourceSnapshot加入installedAt，resource snapshot.packVersion是附件version，独立于外层MDX active.packVersion。
- normalizeResourceImportMetadata进一步核对前端上传metadata的顺序和路径并归一化数字/hash；parseMddIndex做fatal JSON+注入validator。validateResourceRequest验证dictionaryId与canonical path且≤1024字符；查询request ID固定selection-mdd-resource-32hex。isResourceSnapshotForDictionary还对MDX filename，summarizeResources汇总附件文件数/源字节。
- 这些对象都是metadata，不持有payload/File handles；库中没有自动下载或MDD目录扫描。改变槽位/filename规则、resource schema或version意义会破坏恢复与替换，需Worker/manager/Content一致验证。[MDD](#tests-mdd)、资源取消[测试](#test-mdd-cancel)相关，NOT_RUN。

<a id="file-mdd-cancellation"></a>
### rich-mdd-lookup-cancellation.js：资源查询归属与先取消后到达

[源码 L1–82](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/rich-mdd-lookup-cancellation.js#L1-L82) · blob `13baaba00204ab82fc07162a9ea11b3cae641cad`

- createRichMddLookupCancellation持有active map与cancelledRequests tombstone map；begin验证requestId/ownerKey并prune，消费同owner tombstone后抛AbortError，拒异owner或重复active，否则创建AbortController。finish只删除完全同一operation，避免旧finally清掉新请求。
- cancel若active且同owner则abort返回active；owner不同返回owner-mismatch。未开始则记pending tombstone，15秒TTL、最多128条、最旧先丢。prune在begin/cancel发生，无常驻timer；过期不意味着原请求完成。
- ownerKey由上层sender身份传入，本模块仅检查非空≤512和无控制，不自己认证Chrome sender。状态仅内存、重启不保留，与导入reservation/commitpoint状态机不同；assertRichMddLookupActive将aborted转统一AbortError。
- 修改TTL、ID/owner或finish语义要测跨content sender隔离、cancel-before-start和排队取消。[取消测试](#test-mdd-cancel)覆盖前三种核心情况，未单独覆盖TTL/128驱逐；NOT_RUN。

<a id="file-mdd-manager"></a>
### rich-mdd-resources.js：MDD原子附件集合、LRU与资源响应

[源码 L1–406](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/rich-mdd-resources.js#L1-L406) · blob `5d7794d75ab9ae4fedc51aa125864631d5b5028f`

- createRichMddResourceManager复用rich root/state和pack队列，维护导入operations、查询取消控制器与indexCache。preflight验证companion/单源总量，若estimate可用要求剩余≥源总量+32 MiB；队列内拒已存在version，state确认MDX snapshot/filename且无同包resource reservation，再记requestId→resourceVersion。这里不实现reservation TTL自动清理。
- commit验证reservation与当前MDX、规范metadata；逐源检查source/index size、index hash、JSON/keyCount、范围重建index严格相等，再verifyMddRecordBlocks核验全部record。所有源成功且未取消后置commitpoint，state.update再查MDX active版本/reservation，一次替换active.resources。old资源版本只在提交后尽力删除；验证失败/可接受取消清新staging，旧集合指针保持。abortImport保护已active的附件version；cancel同MDX分verify/commitpoint。
- lookupResource验证请求并可按owner启动取消operation，再按pack排队，检查healthy MDX/snapshot/filename。每个companion loadResourceIndex后调用lookup，共享一个budget；全部遍历后才交付，第二个同path命中为歧义错误而非优先首文件。无MDX/附件/命中返回found:false，坏snapshot或media结果抛错；finally注销取消operation。
- loadResourceIndex的key为pack@resourceVersion@indexHash。命中把Map项移到尾端，不重复stat/hash；miss先stat再带signal range读整个index、SHA-256+JSON校验。LRU按序列化index字节累计≤32 MiB，不等于JS对象堆真实内存上限；更换旧集合或forgetDictionary按前缀驱逐。sourceReader按请求重新读取资源range，不缓存媒体bytes，也不在此每次stat整源size。
- manager核bytes为Uint8Array≤8 MiB、kind/MIME及CSS≤64 KiB后，分0x6000块构建binary string并btoa，响应found/path/mime/kind/size/base64及图片width/height。base64/字符串副本有额外内存，资源bytes上限不等于消息实际字节上限；最终显示、CSS清洗与object URL回收在Content旧章。
- 排队等待、range、decode后、遍历和base64分块检查signal；冷index SHA-256等待本身不可Abort。修改队列、共享预算、snapshot原子替换、cache身份或媒体类型需测并发卸载/MDX替换、失败保旧、多companion歧义、旧响应关闭；[MDD](#tests-mdd)及[既有storage](#partial-tests)，NOT_RUN。

<a id="tests-mdx"></a>
## MDX格式与安全测试

<a id="test-rich-format"></a>
### tests/rich-mdict-format.test.mjs：MDX格式与纯文本回退

[源码 L1–139](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/rich-mdict-format.test.mjs#L1-L139) · blob `fc5b51b5b04e51182ac1c779a0d7ee7398269ef2`

Node test通过门面调用build/lookup，合成rich fixture与tracked range source记录每次offset/length；RIPEMD空/abc向量、Encrypted=2+Compact/Compat/StyleSheet、strip-key命中及可读fallback、key-info损坏、RequiredEngineVersion拒绝、负/跨块递减record offset、2万未配对角括号的线性fallback都有断言。metrics要求实际读取少于源和总展开≤32 MiB。这是合成数据+Node解压，不是所有真实MDX实现互操作或浏览器性能证据。状态仅test局部；修改fixture normalization要避免把writer与reader同一错误同步“修正”为通过。关联上面header/codec/index/lookup/record-text/RIPEMD。NOT_RUN。

<a id="test-rich-security"></a>
### tests/rich-mdict-security.test.mjs：MDX不可信内容与损坏

[源码 L1–94](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/rich-mdict-security.test.mjs#L1-L94) · blob `3ce61c95d5e1b7a93845a26e6569b96676b45391`

用makeRichMdx和trackedSource验证encrypted v2索引只做范围读取、rawRecord保留危险标记但safeTextFallback无script内容/远程引用；故意破坏preamble checksum及record payload分别在build/lookup拒绝；alias loop拒绝且不交部分record。没有真实浏览器执行HTML，也没有证明rawRecord本身安全。test局部Buffer可变，生产代码只静态导入；改fallback或alias错误需保持失败类型与不泄漏部分结果。NOT_RUN。

<a id="tests-mdd"></a>
## MDD、OPFS与取消测试

<a id="test-mdd-format"></a>
### tests/mdd-format.test.mjs：MDD独立fixture与精确字节

[源码 L1–199](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/mdd-format.test.mjs#L1-L199) · blob `44cb9e2d4c8594b9e38e424fb0b8224b8951ce38`

读取仓库中固定独立writer fixture及corpus lock，验证compact index不含resources/entries、JSON roundtrip、所有range在界内且不是整源读取、按lock比资源大小/SHA-256/MIME/dimensions、路径大小写不混同。再用合成makeMdd检查none/zlib的key-info/key/record组合和单resource跨三个record块的原字节一致。verifyMddRecordBlocks需恰好读完所有record descriptor并拒损坏payload；一个shared budget跨两个source超限、单resource限制及压缩炸弹构建前拒绝。测试helper计算物理record起点、trackedSource和SHA用于证据，无runtime状态或网络。修改布局须保持独立fixture固定身份，不仅修改同源writer；NOT_RUN，不代替真实词典或媒体播放认证。

<a id="test-mdd-security"></a>
### tests/mdd-security.test.mjs：路径、range、media与取消

[源码 L1–153](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/mdd-security.test.mjs#L1-L153) · blob `f0bee9eedf9cec4e706097bd7a97aee458f4c11f`

路径表覆盖单虚拟根、case/Unicode、一次percent解码，以及遍历、UNC/drive/URI、空段、双重编码、编码分隔、无效编码和NUL的UNSAFE_CONTENT。合成MDD测canonical重复/unsafe keys、下降/越界offset、超块尺寸、checksum损坏；拒SVG/HTML/未知/截断PNG和大尺寸PNG。取消测试注入一直等待signal的source，待read真正开始再abort并断言AbortError，没有用固定sleep。没有逐媒体覆盖所有畸形chunk，也不证明导入inflate即时取消。局部fixture/Buffer不落生产；修改路径规则要保留writer排序及Content引用一致；NOT_RUN。

<a id="test-opfs"></a>
### tests/opfs-pack-store.test.mjs：OPFS adapter的内存模型

[源码 L1–132](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/opfs-pack-store.test.mjs#L1-L132) · blob `4cecec74c557f69bac46a5bdf1168c4f4b0a6ba9`

注入MemoryDirectory/MemoryFile代替navigator OPFS：Map保存目录/文件，createWritable先存pending、close才拷贝生效，getFile给Blob；entries生成kind、remove支持递归/NotFound。两个测试核写入/size/子范围内容、超范围/负offset/零length/缺文件missing，以及unsafe pack/path拒绝。mock支持读写/枚举/删除，但此文件未逐一断言所有remove/cleanup/list或流取消分支；尤其Blob.slice不能证明真实磁盘峰值、原生权限和崩溃原子性。改adapter必须加相应真实浏览器验收，不扩mock断言含义。NOT_RUN。

<a id="test-mdd-cancel"></a>
### tests/rich-mdd-lookup-cancellation.test.mjs：资源取消归属

[源码 L1–54](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/rich-mdd-lookup-cancellation.test.mjs#L1-L54) · blob `22accfb4664af394cb2b9785f2193dffd065f8cf`

三个同步Node测试固定合法request ID与两个不同owner：异owner取消返回owner-mismatch且原signal未abort，同owneractive取消产生AbortError；先cancel后begin消费tombstone并终止；异owner无法认领tombstone。每测试独立factory，无文件/network/浏览器。未测TTL过期、128条驱逐、真实sender验证、manager排队或object URL回收。改owner/ID/operation生命周期以此为基础并联调router+Content；NOT_RUN。

<a id="partial-tests"></a>
## 仍为局部的上下游与验证

- [tests/rich-mdict-storage.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/rich-mdict-storage.test.mjs)：沿用[旧章测试说明](dictionary-import-render.md#test-boundaries)中的提交重建、防伪index、重载、取消串行、卸载失败、catalog替换保旧边界；本轮未逐项展开完整759行，不提升为已解释。
- [tests/rich-mdict-lookup-cancellation.test.mjs](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/tests/rich-mdict-lookup-cancellation.test.mjs)：本章只将预算/AbortSignal连接到[划词章已述边界](selection.md#test-boundaries)，不宣称补齐其全部fixture和极限断言。
- 浏览器MDD/rich viewer/import E2E仍复用[导入章](dictionary-import-render.md#test-boundaries)：Node mock不能代替File→Worker→OPFS→reload→Content的真实跨上下文验证。

<a id="partial-legacy"></a>
### 旧文本lane与共享调用方

[mdict-core.js](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/importers/mdict-core.js)及相邻mdict-key-section/record-section/local-adapter/semantic仍属于旧文本解析与显式结构化投影，本篇只借用它们共同的metadata/contract/codec；没有将旧lane整族升级覆盖。rich公共门面不会自动把旧lane转为rich。

[rich-mdict-lookup-controller.js](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/rich-mdict-lookup-controller.js)已在[划词章](selection.md#file-rich-lookup-controller)完整解释：manager注入loadIndex/sourceReader，controller检查target/healthy、收集每词典error，取消不能伪装no-hit；本轮不重复计数。

[rich-mdict-install-preflight.js](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/rich-mdict-install-preflight.js)与[rich-mdict-catalog-replacement.js](https://github.com/CoderLambert/translateflow-plugin/blob/86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d/src/background/packs/rich-mdict-catalog-replacement.js)复用[导入章](dictionary-import-render.md#file-install-preflight)和[替换局部边界](dictionary-import-render.md#partial-replacement)。本文没有因引用其quota/replacement回调就标它们整文件覆盖。

## 修改影响与验收选择

- 格式/端序/encoding：contract→metadata→block codec→MDX/MDD index与validator→commit重建→query一起核对，加入独立writer或合成fixture，避免“自家writer与reader共同错误”。
- normalization/排序：MDX raw首末边界、lookup min/max、exact/folded与alias visited是不同用途；MDD case-preserving code-point顺序和路径canonical必须一致。更改后不能沿用不相容旧index作为有效cache。
- 存储/恢复：路径、schema、pack/version/index hash、state归一化、commitpoint都影响已安装词典。保留旧数据、不靠清库掩盖迁移问题；测试中区分OPFS删除失败与state写失败。
- 性能/取消：评估峰值含解压chunk+输出、JSON对象+序列化字节、base64副本；range读取不等于零复制，32 MiB index预算不等于32 MiB heap。检查关闭/换词/排队取消与commitpoint拒取消各层不同合同。
- 媒体/富文本：新类型必须经过policy、MIME、Content sanitizer/resolver及受控渲染一起验收，不能添加远程fetch、执行脚本或放宽CSP。

本轮只做源码/文档静态核对。Node测试、npm run validate、构建、浏览器E2E、真实字典及重启/崩溃验收全部 **NOT_RUN**；源码/测试存在不代表这些操作已执行。

