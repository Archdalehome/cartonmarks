# Carton Mark /api 契约 v1

后端 = Cloudflare Pages Functions（`functions/api/`），部署随仓库 push 自动进行。
存储 = Workers KV，绑定名 `CM_KV`（项目设置里加，API 加不了）。

## 通用约定

- 请求/响应一律 `application/json`（`/api/pay/notify` 除外，见该节）。
- 错误响应统一：`{ "error": "<code>", "message": "<中文提示>" }` + 对应 HTTP 状态码。
- 会话 Cookie：`cm_sess`，属性 `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`（30 天）。
- 需要登录的接口未登录：`401 { error: "unauthorized" }`。
- 未捕获异常：`500 { error: "internal" }`，日志里留 stack，不要透给前端。
- 邮箱统一 `trim().toLowerCase()` 后再当键；键里不要出现 `@` 以外的特殊字符问题（KV 键可含 `:`，用 `:` 分层）。

## 错误码表

| error | HTTP | 说明 |
| --- | --- | --- |
| `invalid_request` | 400 | 缺字段/类型错 |
| `invalid_email` | 400 | 邮箱格式不对 |
| `code_invalid` | 400 | 验证码不对，附 `attemptsLeft` |
| `code_expired` | 410 | 验证码过期或不存在 |
| `rate_limited` | 429 | 附 `retryAfter`（秒） |
| `email_taken` | 409 | 邮箱已注册 |
| `bad_credentials` | 401 | 密码错，附 `attemptsLeft` |
| `locked` | 423 | 登录锁定，附 `retryAfter` |
| `unauthorized` | 401 | 未登录 |
| `not_subscribed` | 403 | 未订阅或已过期 |
| `order_not_found` | 404 | 订单不存在或不属于本人 |
| `pay_unavailable` | 503 | Xorpay 返回非 ok，透出 `upstream` |
| `tpl_not_found` | 404 | 模板不存在 |
| `tpl_limit` | 409 | 模板数量上限（50） |
| `too_large` | 413 | 模板数据超过 512 KB |

## KV 键

| 键 | 值 | TTL |
| --- | --- | --- |
| `cm:code:{email}` | `{ code, tries, createdAt }` | 600s |
| `cm:code_rl:{email}` | `{ lastSentAt }` | 3600s |
| `cm:code_ip:{ip}:{YYYYMMDD}` | `{ count }` | 86400s |
| `cm:user:{email}` | `{ id, email, name, hash, salt, createdAt }` | 无 |
| `cm:uid2email:{uid}` | email 字符串 | 无 |
| `cm:sess:{token}` | `{ uid, createdAt }` | 2592000s |
| `cm:login_fail:{email}` | `{ count, lockedUntil }` | 900s |
| `cm:sub:{uid}` | `{ expiresAt }` | 无 |
| `cm:order:{orderId}` | `{ uid, aoid, amount, status, createdAt, credited }` | 无 |
| `cm:tpl:{uid}:{id}` | 模板 JSON | 无 |
| `cm:tpls:{uid}` | `[{ id, name, updatedAt }]` | 无 |

## 1. POST /api/auth/code

请求：`{ "email": "a@b.com" }`

响应 200：`{ "ok": true, "retryAfter": 60 }`

规则：
- 同邮箱 60 秒冷却 → 429 `rate_limited`，`retryAfter` = 剩余秒数。
- 同邮箱每天 10 次、同 IP 每天 20 次 → 429。
- 验证码 6 位数字，TTL 600 秒，最多试 5 次；重发覆盖旧的。
- 用 Resend 发送，HTML + 纯文本两版；发件人取 `RESEND_FROM`。
- 发送失败：502 `{ error: "mail_failed" }`，不要把上游错误原样返回。

## 2. POST /api/auth/register

请求：`{ "email": "...", "code": "123456", "password": "至少 8 位", "name": "可选" }`

响应 201：`{ "user": { "id": "u_xxx", "email": "a@b.com", "createdAt": "ISO" } }` + `Set-Cookie: cm_sess=...`

规则：
- 密码 8–72 位；邮箱已存在 → 409 `email_taken`。
- 验证码校验失败 `code_invalid`（附 `attemptsLeft`），过期 `code_expired`。
- 密码存 PBKDF2-SHA256，100000 轮，16 字节随机盐，`salt`/`hash` 都 base64。
- 注册成功即登录（写 `cm:sess:{token}`），并删掉验证码键。

## 3. POST /api/auth/login

请求：`{ "email": "...", "password": "..." }`

响应 200：`{ "user": { "id", "email" } }` + `Set-Cookie`

规则：
- 5 次失败锁 15 分钟 → 423 `locked`（附 `retryAfter`），成功后清零。
- 邮箱不存在与密码错都返回 `bad_credentials`，不泄露账号是否存在（附 `attemptsLeft`）。
- 密码比对必须恒定时间比较（先比较长度分支以外的东西，别用 `===` 直接比 base64）。

## 4. POST /api/auth/logout

响应 204，删除 KV 里的会话键并 `Set-Cookie: cm_sess=; Max-Age=0`。

## 5. GET /api/me

响应 200：

```json
{ "user": { "id": "u_xxx", "email": "a@b.com" }, "subExpiresAt": "2027-10-31T00:00:00.000Z" }
```

未登录：`{ "user": null, "subExpiresAt": null }`（**不要** 401，前端靠它渲染登录/订阅状态）。
`subExpiresAt` 只认服务端 KV 值，前端不得自行推断。

## 6. POST /api/pay/create

需登录。请求体可以为空。

响应 200：

```json
{ "orderId": "cm_20261031_ab12cd", "qr": "weixin://wxpay/bizpayurl?pr=xxxx", "expiresIn": 7200, "amount": 990 }
```

规则：
- **金额服务端固定 990（分）**，即 9.90 元/年，绝不读取请求里的价格。
- `order_id` 服务端生成：`cm_` + 时间戳 + 随机 6 位，保证唯一。
- 调 Xorpay `POST https://xorpay.com/api/pay/{XORPAY_AID}`，`pay_type=native`，
  签名 `MD5(name + pay_type + price + order_id + notify_url + secret)`（纯 value 拼接，无 `+`）。
  `notify_url` = `${PUBLIC_BASE_URL}/api/pay/notify`。
- 返回 `status != ok` → 503 `pay_unavailable`，附 `upstream` 状态字符串。
- 写 `cm:order:{orderId}` = `{ uid, aoid, amount: 990, status: "new", createdAt, credited: false }`。

## 7. GET /api/pay/status?orderId=xxx

需登录，只允许查本人订单（`cm:order.uid !== session.uid` 一律 `order_not_found`）。

响应 200：

```json
{ "status": "new", "subExpiresAt": null }
```

规则：
- 后端调 Xorpay `GET https://xorpay.com/api/query2/{XORPAY_AID}?order_id=&sign=MD5(order_id+secret)`。
- `status` 归一成 `new | payed | success | expire | not_exist`。
- 当结果为 `payed` 或 `success` 且订单 `credited === false`：
  - 读 `cm:sub:{uid}`，`expiresAt > now` 则在原到期日上 +365 天，否则 `now + 365 天`；
  - 写回 `cm:sub:{uid}`，订单置 `credited: true, status: "success"`。
  - **必须幂等**：重复查单不能重复加时（用 `credited` 标记 + 写前再读一次）。
- 前端每 3 秒轮询，最多 5 分钟；`expire` 时提示重新下单。

## 8. POST /api/pay/notify

Xorpay 回调，`application/x-www-form-urlencoded`。

字段：`aoid`、`order_id`、`pay_price`、`pay_time`、`more`、`detail`、`sign`。

规则：
- 验签：`MD5(aoid + order_id + pay_price + pay_time + secret)`，不匹配 → 400。
- 按 `order_id` 找回订单，校验 `pay_price` 与订单金额一致（不一致记日志但按已付处理并人工核对）。
- 入账逻辑与 `/api/pay/status` 完全共用同一个函数，幂等。
- 成功响应：HTTP 200，body 纯文本 `ok`。（Xorpay 非 200 会重试 6 次）

## 9. 模板接口

**权限分两档（2026-11-01 改）**：自己的模板要登录 + 订阅未过期；收到的分享只要登录。

自己的模板（未订阅 → 403 `not_subscribed`）：

- `GET /api/templates` → `{ "items": [{ "id", "name", "updatedAt" }] }`
- `POST /api/templates` `{ "name": "最多 40 字", "data": { ...项目 JSON... } }` → 201 `{ "id": "t_xxx" }`
  - 单用户上限 50 → 409 `tpl_limit`；`data` 序列化后 > 512 KB → 413 `too_large`。
- `GET /api/templates/{id}` → `{ "id", "name", "data", "updatedAt" }`
- `DELETE /api/templates/{id}` → 204

分享（发件人必须订阅；收件人只要登录）：

- `POST /api/templates/{id}/share` `{ "email" }` → 200 `{ "shareId", "toEmail" }`
  - 邮箱不是注册用户 → 404 `user_not_found`（不写任何 KV 键）；分享给自己 → 400 `user_is_self`；
    未订阅发件人 → 403 `not_subscribed`；每分钟第 11 次 → 429 `rate_limited`；同模板重复分享给同一人覆盖不新增。
- `GET /api/shared` → `{ "items": [{ "shareId", "fromEmail", "name", "shape", "sharedAt" }], "total", "limit", "notice" }`
- `GET /api/shared/{shareId}` → `{ "name", "shape", "data", "fromEmail" }`
  - 箱型权限在这里判定：`lshape` / `bevel` / `tiandi` 且当前用户未订阅 → 403 `shape_locked`（body 带 `shape`）；
    `rsc` 直接放行。快照语义：内容在分享那一刻落库，发件人之后改模板不影响已发出的。
- `DELETE /api/shared/{shareId}` → 204（收件人移除自己那份）
- `DELETE /api/templates/{id}/share/{shareId}` → 204（发件人撤销，连收件人那份一起删）

## 前端配合

- 启动时 `GET /api/me`，按 `user` / `subExpiresAt` 决定：游客（只有矩形箱）、注册（只有矩形箱 + 可打开「我的模板」看收到的分享）、订阅（L 形/斜形 + 模板保存）。
- 「我的模板」登录即可打开：自己的模板读不到（403）时只锁那一块并给「去订阅」，收到的分享照常列出、照常载入。
- 任何 401 → 打开登录弹层；载入订阅专属箱型的分享 → `403 shape_locked` → 关模板层 + 打开订阅弹层并点名箱型。
- 订阅状态每次进页面都从服务端取，**不信本地缓存**。

## 环境变量（Cloudflare Pages → Settings → Environment variables）

| 名称 | 说明 |
| --- | --- |
| `RESEND_API_KEY` | Resend 密钥，secret |
| `RESEND_FROM` | 如 `Carton Mark <admin@support.qafield.com>` |
| `XORPAY_AID` | Xorpay appid |
| `XORPAY_SECRET` | Xorpay app secret，secret |
| `PUBLIC_BASE_URL` | 如 `https://cartonmarks.pages.dev` |

绑定：`CM_KV` → KV 命名空间 `cartonmarks_kv`（生产 + 预览都加）。

## 待用户确认（未定前不得写死）

- L 形箱、斜形箱的尺寸参数（输入哪几个数、展开图怎么摆）
