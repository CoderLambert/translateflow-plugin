# 242 主 Agent 自查

候选 `01cb14a17fdbddca054f78cd3b89b73bf9d24891`，基线 `origin/main=3f7c0cde71096acdc438f65213d38b799806b5b7`。PASS。

后台冻结 understand/analyze/usage 问题；follow-up 必须有 parent 且历史最多 6 个有界完成 turn；regenerate 仅允许 root、parent=null、新 turn/branch。只有 complete 返回严格 `completionStatus:completed` turn，partial/cancel/fail 无 turn，因而不能误存完整 artifact。prompt 只含 resolver 收窄的 selection/context/candidate facts 与有限历史，不含 URL/全文。

正式证据：`npm run validate` PASS（1060 Node、15 Vitest、strict typecheck、默认 WXT）；显式 WXT 158 files / 1,815,625 bytes，platform 1,568,236 ≤ 1,576,595，fingerprint `54d86fbbd8d276a58b9858a26df5937b1134e551a37517369fa48643ada6710d`；Chromium E2E 1/1 PASS，complete 返回 grounded turn，Stop 无 completed turn。243/244 与其它浏览器/发布未验证。
