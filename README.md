# Carton Mark · 箱唛设计工具

纯静态站点（HTML + CSS + 原生 JS，无构建步骤），Cloudflare Pages 直接发布仓库根目录。
线上地址：https://cartonmarks.pages.dev

## 当前进度

- **M1 骨架与图纸**（已完成）
  - 顶部：箱型选择（仅矩形箱 / RSC 可选）、单位切换（mm / cm）、长 L / 宽 W / 高 H 输入
  - 左侧：等轴测轮廓线稿，随尺寸实时变化
  - 右侧：RSC 展开图 12 个区域（4 箱身面 + 4 主摇盖 + 4 防尘摇盖）+ 中文标签 + 尺寸线
  - 可编辑面 = 4 箱身面 + 4 主摇盖 = 8 个；防尘摇盖只画轮廓、不可点击、不参与箱唛
  - 输入防呆：非数字 / 非正数 / 超范围给出提示，图纸保留上一次有效结果
  - 草稿自动保存到 localStorage
- **M2 编辑器**（进行中）
- **M3 PDF 导出**（待做）
- **M4 移动端适配 / 使用说明**（待做）

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
assets/js/project.js     数据模型（shape / dims / panels）、本地草稿
assets/js/geometry.js    RSC 展开图与等轴测的纯几何计算（无 DOM）
assets/js/svg.js         SVG 构造助手与尺寸线
assets/js/net-view.js    展开图绘制（12 区域，8 个可点击）
assets/js/iso-view.js    等轴测轮廓绘制
assets/js/app.js         页面装配与交互
tools/serve.mjs          本地静态服务器
tools/test-geometry.mjs  几何断言
tools/test-units.mjs     输入校验断言
tools/test-views.mjs     SVG 结构断言（DOM 垫片）
tools/uat.html           浏览器内自检（同源 iframe 真点击）
```

## 本地运行

```bash
node tools/serve.mjs 5173   # 打开 http://127.0.0.1:5173/
npm test                    # 三组离线断言
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

元素坐标、尺寸、字号一律存毫米，显示时按缩放换算；M3 导出 PDF 直接按 1:1 使用同一份数据。
防尘摇盖（topRight / topLeft / bottomRight / bottomLeft）只有几何，没有内容槽位。
