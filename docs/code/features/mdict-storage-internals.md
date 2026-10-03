# 从MDX/MDD二进制到重载后按需查词

源码固定于main `86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d`（2026-10-03）。本篇是[本地词典导入与安全展示](local-dictionary-import.md)的内部延伸；UI入口、Worker协议、sanitizer、viewer与关闭流程继续复用原章。逐文件实现见[MDict存储内部](../modules/mdict-storage-internals.md)。全部运行验证 **NOT_RUN**，下文是静态源码事实，不是商业词典兼容性认证。

## 用户看到的结果与实际参与者

用户在Options选择本地MDX/MDD，先完成文件组preflight和明确导入，得到已安装词典；划词时可在本地按需恢复释义、图片/音频和受限CSS。原始文件保留在扩展origin的OPFS，Compact JSON只描述如何找块。导入成功、索引成功、某条记录可读和完整安全展示是不同阶段。

阅读顺序：

1. [已有导入链](local-dictionary-import.md)和[Worker/控制器](../modules/dictionary-import-render.md)。
2. [header/规范化](../modules/mdict-storage-internals.md#file-rich-metadata) → [块解压](../modules/mdict-storage-internals.md#file-block-codec) → [MDX index](../modules/mdict-storage-internals.md#file-rich-index)。
3. [OPFS](../modules/mdict-storage-internals.md#file-opfs-store) → [state](../modules/mdict-storage-internals.md#file-pack-state) → [MDX manager](../modules/mdict-storage-internals.md#file-rich-manager)。
4. [MDX范围查询/alias](../modules/mdict-storage-internals.md#file-rich-lookup) → [MDD资源查询](../modules/mdict-storage-internals.md#file-mdd-lookup) → [MDD manager](../modules/mdict-storage-internals.md#file-mdd-manager)。
5. [已有Content安全展示链](../modules/dictionary-import-render.md)，最终回到[划词流程](selection-and-dictionary.md)。

## 正常MDX链：File → 范围解析 → staging → active

1. Options控制器取得reservation后把用户File直接交rich Worker；Worker的source只暴露size/read，parser不用知道用户原始路径，也不联网。
2. parser读取UTF-16LE header并检查长度/Adler32，要求MDX v2.0、HTML/Text、UTF-8/UTF-16、Encrypted=0/2。key-info可使用RIPEMD-128派生的格式解密，但record加密1/3不支持；LZO/未知压缩仍拒绝。
3. 44字节key preamble声明块数/entry数/key-info和key块长度，key-info给每块首末key和尺寸。parser逐块解码keys验证record offsets并生成实际lookup min/max；record section的描述符给“源物理offset”和“展开后逻辑offset”。它不将所有record正文载入内存，也不在MDX建索引时核验每个record payload。
4. Worker写source.mdx与index.json到独立version目录，并给后台metadata，包括source/index大小、index SHA-256、entry数。OPFS write成功只表示字节已写，不等于词典已active。
5. 后台rich manager按pack串行，重查reservation和目标，重新从OPFS范围构建index，与staged JSON严格比较；大小/hash/结构错误都不能激活。验证后进入commitpoint，再以state.update一次写healthy active并删除reservation。
6. 状态响应回Options形成安装结果；后续查词使用active版本。原File对象可随Worker任务结束释放，重载无需用户再选源文件，前提是原扩展origin和持久存储仍在。

参与逐文件：[shared二进制合同](../modules/mdict-storage-internals.md#file-mdict-contract)、[key codec](../modules/mdict-storage-internals.md#file-rich-key-codec)、[index校验](../modules/mdict-storage-internals.md#file-rich-validation)、[snapshot合同](../modules/mdict-storage-internals.md#file-rich-contract)。

## 正常查询链：active → 小范围解压 → rawRecord/fallback → UI

1. Content划词通过既有路由调用rich lookup controller，按dictionaryId或遍历healthy词典，验证snapshot/源size并loadIndex。
2. 后台index cache身份为packId+MDX version+index SHA-256。cache miss读JSON、校验hash/结构；命中仍检查index size，但不重新hash。此Map没有MDD式总量LRU。sourceReader每次按已绑定版本打开OPFS范围，File handles不长期缓存。
3. query先NFKC/trim/合并空白，再按header case/StripKey规范化；扫描descriptor区间挑候选，预算允许后逐key块解码，优先精确拼写，否则folded首命中。MDX不是在假设所有规范key已全局有序的数组上简单二分。
4. 命中key的recordOffset是逻辑展开流坐标；end找下一个严格更大offset，跨key块寻找，允许多个key共享同条record。二分record descriptor定位起点，解压相交压缩块、拼接需要的字节，校验长度与checksum。
5. 文本以@@@LINK=开头则本地追target，共享预算/visited，最多8次重定向。初次无命中是found:false；alias缺失/循环、损坏、超预算为错误，不返回半条记录。
6. 返回rawRecord与safeTextFallback，经controller限制消息大小，再由Content tokenizer/sanitizer生成受控AST。fallback作为文本使用；rawRecord永远不能直接可信innerHTML。MDD相对资源需要再走下一条链，词典中远程地址不因此获得请求权限。

参与逐文件：[范围source](../modules/mdict-storage-internals.md#file-range-source)、[预算](../modules/mdict-storage-internals.md#file-rich-budget)、[record文本](../modules/mdict-storage-internals.md#file-rich-record-text)；Content实现复用[旧模块章](../modules/dictionary-import-render.md)。

## MDD附件链：全集合验证 → 独立resourceVersion → 受限媒体

1. companion合同将MDX basename对应的基础.mdd和连续编号伴随文件排序，最多16个；每文件128 MiB、总源512 MiB、每index16 MiB、总index32 MiB。内部使用resources/编号槽位，不把文件名当任意OPFS路径。
2. MDD parser接受Library_Data v2 header，keys固定UTF-16LE，资源路径保留case、一次percent decode、去一个虚拟根/统一分隔符；拒绝URI/drive/UNC/遍历/双重编码。规范path按Unicode code point严格递增，允许二分查candidate。
3. Worker写资源源文件与compact index后，后台重查matching MDX/reservation，按源重建JSON并比较；与MDX不同，MDD在commit前额外逐record块解压/checksum。全部companion成功才一次替换active.resources，snapshot内version指resourceVersion。
4. Content resolver请求某path，后台查所有companion，每文件至多一个candidate key块，恢复精确二进制range；所有companion共用一次预算，两个文件都命中同path则拒绝歧义，不悄悄选第一个。
5. policy按扩展名+有限结构查CSS/PNG/JPEG/GIF/WebP/MP3/OGG/WAV；单资源≤8 MiB，图片有边长/总像素限额，动画格式拒绝，CSS≤64 KiB且UTF-8。SVG/HTML/JS与未知类型不交付。有限header/chunk检查不等于完整媒体解码认证。
6. manager把bytes转base64+MIME/kind/size及可选尺寸，Content再次检查并生成受控resource/object URL或有限CSS规则。关闭/换词后的URL回收和旧结果抑制属于原展示链。

MDD index cache按pack/resourceVersion/indexHash建立32 MiB序列化字节LRU，cache hit不重新stat/hash；真正JS对象占用与base64副本另有开销。源码：[MDD header/index/key](../modules/mdict-storage-internals.md#file-mdd-index)、[路径](../modules/mdict-storage-internals.md#file-resource-path)、[policy](../modules/mdict-storage-internals.md#file-resource-policy)、[附件合同](../modules/mdict-storage-internals.md#file-mdd-contract)。

## 失败、取消与恢复不是同一个状态

- 解析失败：UNSUPPORTED是能力边界，CORRUPT是布局/checksum错误，LIMIT是预算，UNSAFE_CONTENT是路径/内容策略。UI文案可映射，但底层原因不能混为“没有释义”。
- 提交前取消：verify阶段的AbortController和Worker终止/abort清staging；旧active不变。进入commitpoint后返回cancelled:false，UI不能因为发过cancel消息就显示“已取消”。MDX与MDD都需重查reservation，不能以先前preflight当最终状态。
- 查询取消：requestId绑定content ownerKey；先取消后查询由15秒、最多128条tombstone拦截；异owner不能取消别人。scope内的range/解压会观察signal，finally移除运行operation。MDD导入build/verify尚不能立即取消已经开始且未传signal的inflate块，必须保留该粒度限制。
- 数据损坏：重载后用原active恢复读取；missing/corrupt可显示为错误，不会自动下载、重新选择源、清库或重建所有正文。MDX坏record可能直到被查才发现，不能把list ready当全record认证。
- 卸载失败：先OPFS删除后state删除，前者失败保留可重试行；跨两套存储没有全局事务。如果状态落盘失败，也不能宣称旧文件自动恢复。
- MDD换附件失败：全部新源验证成功前不换active.resources；失败保旧集合，成功后尽力清旧version。MDX curated替换是否保资源取决于既有来源/filename匹配规则，不扩展为所有本地词典覆盖同包。

## 兼容性与验证状态

main当前的rich key边界比较仍存在原始descriptor与规范化decoded key不对称，详见[现状说明](../modules/mdict-storage-internals.md#known-boundaries)；没有把未合入parser修正或未来Oxford能力写成已实现。

本轮完整静态阅读的6个测试文件和各自证据限制见[MDX测试](../modules/mdict-storage-internals.md#tests-mdx)、[MDD/OPFS/取消测试](../modules/mdict-storage-internals.md#tests-mdd)。其中独立MDD fixture检验精确二进制、跨record块及共享预算，memory OPFS只检验adapter逻辑；真实MV3/File/Worker/OPFS、媒体播放、崩溃恢复与私有词典仍需授权后的适当运行验证。

本轮Node测试、npm run validate、构建、浏览器E2E、真实词典检查全部 **NOT_RUN**。无新增业务代码、权限、格式支持或下载行为。

