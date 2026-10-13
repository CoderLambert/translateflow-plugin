# Rich 词典本地 TTF 字体

依据 main cbf9e3b7498a3fa36e768ffcf48146996cd4786c，继续 #271 的字体切片。PR329 已交付真实 arch/go POS/radio/CSS 与资源计数修复，禁止重做。真实同包4个TTF faces，同一family：normal/italic ×400/700，display swap/fallback，每face单个本地url无local()/外网；总2,956,896 bytes，table目录23/24且bounds有效。私有数据不入库。

沿用 background css-tree AST sanitizer、MDD resource resolver、每record Shadow。仅支持有界sfnt TrueType TTF；font directory/table边界检查，浏览器字体decoder最终验证，失败正文使用fallback。@font-face只投影有限fontFaces manifest：canonicalpath、匿名familyToken、400/700、normal/italic、swap/fallback；普通font-family只引用已声明family匿名token或通用fallback。不注入原始face/src，不local()或任意URL，不执行JS，不改变CSP/权限。

保持image assetSlots旧DTO，新增optional fontFaces，images+faces累计8。保留CSS source/output64KiB、visited1024/accepted512/decl12，resource8MiB与active资源32MiB；FontFace字节也收费，不重复算image budget。每stylesheet/session随机alias，避免同名词典family互相影响；close/generation/uninstall失效删除所属FontFace，异步load旧结果不得重新添加。若Chrome Shadow @font-face不生效，使用受控ArrayBuffer FontFace并管理document.fonts，仅Shadow引用随机family；具体由原型证明，无CSP放宽。

不改变MDX/MDD/index/OPFS schema，不清用户数据，MDD原字体bytes保留。静态SVG、entry/history、Oxford adapter、六文件JS诊断/失败恢复和cache属于下一切片。本片不关闭#271/#274。

执行Agent仅owned字体policy/compiler/resource DTO/resolver受控helper与注册、相应Node/E2E；主Agent独占docs/task/state/兼容文档/GH。新增helper复用现有Content注册，不另建runtime。单一实现Agent，不派生。实现阶段targeted tests/check，不全量；主Agent最终exact candidate八验收及独立只读review/guarded merge/postmain。

验收覆盖valid四faces与genericfallback、case/family mapping、source恶意family/escape/URL/local()/mixed src/descriptor重复/错误字体signature/table超界重叠/数量累计限额、坏font正常fallback、samefamily跨dict隔离、load→close/selectiongeneration/packageversion陈旧不添加、重复渲染资源释放、style与音频/图片不回归。真实同Oxford包arch/go当前WXT实际字体load/应用（FontFace status与fontSet/matching computed alias及字宽/FontFace证据，不能仅computed family宣称loaded），全部POS/重启/provider0/http0。合成字体从可追溯生成fixture，禁止复制Oxford字体作为fixture或包asset。

原型及实现收口：Chromium153 Shadow @font-face不能加载；受控ArrayBuffer FontFace需document.fonts add，delete还原字形，另Shadow/页面字体不变。生产alias仅crypto.getRandomValues，无RNG诚实fallback；单字体失败明示显示降级而保留其它CSS。pending native load保留reservation+既有2读槽直到settle；原始TTF bytes8MiB、每view32MiB逻辑预算不当heap上限。生成752B原创矩形字形fixture真实Chrome解码、四variant/两dict隔离/close0/restart/坏font+radio测试，未复制商用字体。实际4字体新policy预验证4/4PASS仅dirty source；最终frozen候选仍须真实UI。

准确95762候选门禁8PASS后，独审真实复现全CSS token替换误改同名radio ID/class/content；已改声明级有界scanner，所有fallback路径保真，实际4state collision E2E回归保留。旧候选真实fonts0/4 FAIL（五文件installPASS）；实际4src均仅%20编码空格，blanket拒绝percent过滤四faces。只增加verified一次%20→space，其余encoded危险/双重/不认识percent继续reject，并以独立生成fonts/Test Font.ttf MDD命中测试固定。旧attempt保持绑定，不作新headPASS。
