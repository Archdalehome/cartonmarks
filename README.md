# Carton Mark · 箱唛设计工具

纯静态站点（HTML + CSS + 原生 JS，无构建步骤），Cloudflare Pages 直接发布仓库根目录。
线上地址：https://cartonmarks.pages.dev

## 当前进度

- **M1 骨架与图纸**（已完成）
  - 箱型选择（仅矩形箱 / RSC）、单位切换（mm / cm）、长 L / 宽 W / 高 H 输入
  - 左侧等轴测轮廓线稿；右侧 RSC 展开图 12 个区域 + 中文标签 + 尺寸线
  - 可编辑面 = 4 箱身面 + 4 主摇盖 = 8 个；防尘摇盖只画轮廓、不可点击、不参与箱唛
  - 输入防呆：非数字 / 非正数 / 超范围给出提示，图纸保留上一次有效结果
- **M2 编辑器**（已完成）
  - 点可编辑面 → 下方放大编辑器 + 右侧属性面板
  - 点面板空白处 / 「+ 文字」/「+ 图片」新建元素：文字（内容、字号 mm、加粗、对齐）、图片（本机压缩后存 dataURL）
  - 元素拖动、四角缩放（图片等比）、方向键微调（Shift ×10）、Delete 删除、对齐辅助线
  - 元素一律夹在面板边界内；坐标、尺寸、字号都存毫米
  - 「复制到」另一面：覆盖 / 追加，深拷贝（改副本不影响原件）
  - 撤销 / 重做 60 步（Ctrl+Z / Ctrl+Shift+Z）
  - 草稿自动保存：localStorage，写满自动落 IndexedDB
- **M3 PDF 导出**（已完成）
  - 页面尺寸 = 展开图真实毫米 (2L+2W)×(H+W)，1:1；超出 PDF 单页上限 5080 mm 时等比缩并提示
  - 中文用 Noto Sans SC 子集 + opentype.js 转成矢量路径，PDF 不嵌字体、不会缺字
  - 只导出箱唛内容 + 裁切/开槽/折叠线；尺寸线、辅助线、高亮框不导出
  - 图片按元素框 1:1 放置（不重新采样），导出前提示低于 150 dpi 的图片
  - 两种模式：整张展开图一页（默认）/ 每个有内容的面各一页；文件名带尺寸和日期
- **M4 收尾适配**（已完成）
  - 超大箱 A3/A4 拼版：1:1 切块，每块带裁切角标、「第 i/N 块」和「接边：左/右/上/下」，A3 横放 420×297、A4 竖放 210×297，四周 8 mm 留白
  - 页面里写明打印要选「实际大小 / 100%」，不要选「适合页面」
  - 窄屏显示「精确定位请用桌面端」提示
  - 面板列表完全由几何生成（`geometry.registerShapeGeometry`），测试里有假 L 形箱证明扩展点可用
  - robots.txt、404.html、og/meta、PDF 元信息（ASCII Title/Subject 带尺寸）
  - 中文字体 2.1 MB 只在导出时加载，不进首屏

## 尺寸口径（一切以真实毫米为准）

箱体 长 L × 宽 W × 高 H：

| 部位 | 尺寸 | 可编辑 |
| --- | --- | --- |
| 前面板 / 后面板 | L × H | ✅ |
| 右侧面板 / 左侧面板 | W × H | ✅ |
| 主摇盖（前顶 / 后顶 / 前底 / 后底） | L × W/2 | ✅ |
| 防尘摇盖（右顶 / 左顶 / 右底 / 左底） | W × W/2 | ❌ 仅轮廓 |
| 展开图总尺寸 | (2L + 2W) × (H + W) | — |

示例 600 × 400 × 300 → 展开图 2000 × 700 mm，主摇盖 600 × 200，防尘摇盖 400 × 200。
主摇盖两片对开拼成顶面；防尘摇盖先折入再压主摇盖，属于结构件，不印箱唛。

## 目录结构

```
index.html               页面骨架
assets/css/main.css      全局样式
assets/js/units.js       单位换算与尺寸校验
assets/js/project.js     数据模型（shape / dims / panels）、草稿序列化
assets/js/geometry.js    RSC 展开图与等轴测的纯几何计算（无 DOM）
assets/js/svg.js         SVG 构造助手与尺寸线
assets/js/net-view.js    展开图绘制（12 区域，8 个可点击）
assets/js/iso-view.js    等轴测轮廓绘制
assets/js/elements.js    元素工厂、边界夹取、深拷贝
assets/js/history.js     撤销 / 重做（60 步，连续操作合并）
assets/js/storage.js     草稿存储（localStorage → IndexedDB 兜底）、图片压缩
assets/js/editor.js      编辑器画布（拖动、四角缩放、辅助线）
assets/js/properties.js  右侧属性面板
assets/js/pdf-plan.js      PDF 页计划（纯计算，可离线断言）
assets/js/pdf-export.js    PDF 生成（jsPDF + opentype 矢量文字）
assets/js/app.js         页面装配与交互
tools/serve.mjs          本地静态服务器
tools/test-geometry.mjs  几何断言
tools/test-units.mjs     输入校验断言
tools/test-views.mjs     SVG 结构断言（DOM 垫片）
tools/uat.html           浏览器内自检（同源 iframe 真点击 / 真拖动 / 真缩放）
tools/demo.html          演示数据（填一份草稿并跳到编辑器，用来看效果）
tools/mobile-preview.html 390px 真视口预览
tools/fetch-url.mjs      走 SOCKS5 抓线上页面（部署校验）
README.md / robots.txt / 404.html  站点文案与搜索引擎文件
```

## 本地运行

```bash
node tools/serve.mjs 5173   # 打开 http://127.0.0.1:5173/
npm test                    # 三组离线断言
# 浏览器自检：http://127.0.0.1:5173/tools/uat.html
# 直接看效果：http://127.0.0.1:5173/tools/demo.html
```

## 数据结构（为后续箱型预留）

```js
project = {
  shape: 'rsc',                       // 未来：'lshape'、'bevel'
  dims: { L, W, H },                  // 毫米
  panels: {                           // 只含 8 个可编辑面
    front:  { label: '前箱唛', elements: [] },
    right:  { label: '右侧箱唛', elements: [] },
    back:   { label: '后箱唛', elements: [] },
    left:   { label: '左侧箱唛', elements: [] },
    topFront:    { label: '前顶箱唛', elements: [] },
    topBack:     { label: '后顶箱唛', elements: [] },
    bottomFront: { label: '前底箱唛', elements: [] },
    bottomBack:  { label: '后底箱唛', elements: [] },
  }
}

element = { id, type: 'text'|'image', x, y, w, h, rotation,
            text?, fontSize?, bold?, align?, src? }
```

元素坐标、尺寸、字号一律存毫米，显示时按缩放换算；PDF 导出直接按 1:1 使用同一份数据。
防尘摇盖（topRight / topLeft / bottomRight / bottomLeft）只有几何，没有内容槽位。

新增箱型只需要：在 `geometry.js` 里 `registerShapeGeometry('lshape', compute)`，
返回 `{ width, height, panels: { key: { label, kind, editable, x, y, w, h } }, outline, folds, cuts, dims }`。
页面、编辑器、拼版导出都会自动跟着新面板走，不用改 UI。
