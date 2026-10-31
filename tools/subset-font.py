"""
tools/subset-font.py —— 把完整的 Noto Sans SC 子集化成箱唛够用的中文字体（开发期一次性操作）

输出：vendor/fonts/carton-sans.ttf
字符集：GB2312 全角区 + ASCII + 常用符号（× ÷ ° ± ® © ™ … ² ³ 等）

用法（需要 fontTools，脚本会自动把 .tmp/py 加进 sys.path）：
    python tools/subset-font.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, ".tmp", "py"))

from fontTools.subset import main as subset_main  # noqa: E402

SRC = os.path.join(ROOT, ".tmp", "package", "400Regular", "NotoSansSC_400Regular.ttf")
OUT_DIR = os.path.join(ROOT, "vendor", "fonts")
OUT = os.path.join(OUT_DIR, "carton-sans.ttf")
CHARS_TXT = os.path.join(ROOT, ".tmp", "chars.txt")


def gb2312_chars():
    chars = set()
    for hi in range(0xA1, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                chars.add(bytes([hi, lo]).decode("gb2312"))
            except Exception:
                continue
    return chars


def main():
    chars = set()

    # ASCII 可打印
    chars.update(chr(c) for c in range(0x20, 0x7F))
    # GB2312（含全角标点与 6763 个汉字）
    chars.update(gb2312_chars())
    # 箱唛常用额外符号
    chars.update("×÷±°°′″‰℃℉№㎡㎏㎜㎝㎞®©™·—–…“”‘’「」『』《》〈〉【】〔〕￥€£¥§¶†‡•→←↑↓↔√≈≠≤≥∞µΩ")

    chars.discard("\n")
    chars.discard("\r")

    with open(CHARS_TXT, "w", encoding="utf-8") as f:
        f.write("".join(sorted(chars)))

    os.makedirs(OUT_DIR, exist_ok=True)

    if not os.path.exists(SRC):
        raise SystemExit(f"缺少源字体：{SRC}")

    subset_main([
        SRC,
        f"--text-file={CHARS_TXT}",
        f"--output-file={OUT}",
        "--layout-features=",
        "--no-hinting",
        "--drop-tables+=DSIG",
        "--name-IDs=*",
        "--recalc-bounds",
    ])

    size = os.path.getsize(OUT)
    print(f"字符数 {len(chars)}，输出 {OUT}，{size / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
