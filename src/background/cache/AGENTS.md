# 独立缓存模块边界

本目录落实用户明确授权的缓存模块解耦；其它仓库安全规则继续生效。

- `storage-indexeddb.js` 是通用缓存 IndexedDB 的唯一直接 owner，替代根 AGENTS.md 旧路径 `src/background/cache-db.js` 的存储实现职责。`scripts/source-boundaries.mjs` 只为此精确文件授权，不放宽到目录。
- `src/background/cache-db.js` 仅为已有 UI/后台提供稳定 facade；`application.js` 是业务适配层，`service.js` 与 storage drivers 不得引入 Provider、DOM、Reading repository 或外部网络。
- ReadingRecord 的原 owner 与数据库不变，词典 OPFS 和凭据不清理。
- 本模块只支持当前 generic envelope，旧普通译文丢弃，不维护两套记录解析器。独立解释结果仅在数据库版本升级事务中一次性封装搬运。
- 任何宣称数据库验收通过的记录必须有真实 IndexedDB/编译扩展证据；Node 内存后端通过不能替代。
