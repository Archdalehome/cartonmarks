# vendor/ —— 本地化依赖

站点不使用 CDN，所有第三方依赖都放在这里，随仓库一起部署。

| 文件 | 版本 | 许可证 | 来源 |
| --- | --- | --- | --- |
| `jspdf.umd.min.js` | jsPDF 2.5.2 | MIT | https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js |
| `opentype.min.js` | opentype.js 1.3.4 | MIT | https://unpkg.com/opentype.js@1.3.4/dist/opentype.min.js |
| `fonts/carton-sans.ttf` | Noto Sans SC Regular 子集（7561 字符） | SIL OFL 1.1（见 `fonts/LICENSE.txt`） | 由 `tools/subset-font.py` 从 Google 的 Noto Sans SC 生成 |

## 字体说明

jsPDF 自带字体不含中文，直接写中文会乱码。这里的做法是：

1. 用 opentype.js 解析 `carton-sans.ttf`；
2. 导出时把文字转成矢量路径（`moveTo/curveTo`）写进 PDF；
3. PDF 里不嵌字体、不写字形文本，所以文件小、任何机器打开都不会缺字。

字体子集包含 GB2312 全部字符 + ASCII + 常用符号（× ÷ ° ± ® © ™ … 等）。
如果用户输入子集之外的生僻字，会画成空白方框 —— 需要扩字集时改 `tools/subset-font.py` 重新生成。

## 重新生成字体

```bash
# 依赖：Python 3 + fontTools（脚本会自动把 .tmp/py 加入 sys.path）
# 源字体：.tmp/package/400Regular/NotoSansSC_400Regular.ttf
python tools/subset-font.py
```
