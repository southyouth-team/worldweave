# 字体说明

官网使用三套 SIL Open Font License 1.1 字体，全部放在本目录，不请求 Google Fonts：

| 文件 | 字体 | 用途 |
| --- | --- | --- |
| `space-grotesk-var.woff2` | Space Grotesk Variable | 拉丁标题、界面小字 |
| `noto-sans-sc-var.woff2` | Noto Sans SC Variable | 中文正文 |
| `noto-serif-sc-var.woff2` | Noto Serif SC Variable | 中文标题 |

字体已经按当前官网文案做了子集化，体积控制在约 440KB。许可证原文在 `licenses/`。

## 文案增加新字符后重新生成

如果修改了 `index.html` / `main.js` 中的文案，先用新文案重新生成字符集，再重新子集化：

```bash
python - <<'PY'
from pathlib import Path
chars = set()
for name in ['website/index.html', 'website/main.js', 'website/styles.css']:
    chars.update(Path(name).read_text(encoding='utf-8'))
chars.update(chr(c) for c in range(0x20, 0x7f))
Path('website/assets/fonts/chars.txt').write_text(''.join(sorted(chars)), encoding='utf-8')
PY
```

然后从 Google Fonts 仓库获取原始可变字体（Noto Sans SC、Noto Serif SC、Space Grotesk），使用 `pyftsubset`：

```bash
pyftsubset NotoSansSC[wght].ttf \
  --text-file=website/assets/fonts/chars.txt \
  --flavor=woff2 --layout-features='*' --no-hinting \
  --output-file=website/assets/fonts/noto-sans-sc-var.woff2
```

Noto Serif SC 和 Space Grotesk 同理，分别输出到对应文件。字体源文件不需要提交到仓库，只需要提交子集后的 `.woff2`。
