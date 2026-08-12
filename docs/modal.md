# modal

web 前端右上角 “导入 MIDI” 修改为上传按钮，点击后有一个弹窗选择 音频 或者 midi，选择 midi 就直接跳转到studio预览（不需要上传到后端），选择audio并选择文件后：
web 前端上传一个 audio 文件到后端，后端上传给 modal，处理完返回压缩包文件，解压后格式为

```txt
歌名_专辑名/
├── 歌名_专辑名.mp3
├── 歌名_专辑名_beat.json
├── piano/
│   ├── 歌名_专辑名_piano.mp3
│   └── 歌名_专辑名_piano.mid
├── other/
│   ├── 歌名_专辑名_other.mp3
│   └── 歌名_专辑名_other.mid
├── vocals/
│   └── 歌名_专辑名_vocals.mp3
├── bass/
│   └── 歌名_专辑名_bass.mp3
├── drums/
│   └── 歌名_专辑名_drums.mp3
└── guitar/
    └── 歌名_专辑名_guitar.mp3
```

上传完后弹窗显示 正在处理（上面还有一个转圈圈的加载动效），大概需要 5min，处理完后可以在库里查看。此时可以叉叉弹窗，若不关闭，处理完后直接跳转到对应的 studio

## vps

vps 解压后覆盖性放到对应位置
docker 里面修改为
volumes:
      - ./backend/data:/app/backend/data/visual:ro

./backend/data/visual 为预置的文件不要动
./backend/data/modal 为 modal 处理后的文件，解压后覆盖性放到对应位置

## api

部署后，将 `process-audio` 的完整 HTTPS URL 配置为 Node.js 后端环境变量：

```env
MODAL_URL=https://YOUR_MODAL_ENDPOINT
```

下面的 Node.js 22+ 函数上传本地音频，并将返回的 ZIP 流式保存到指定路径：

```js
import { createWriteStream, openAsBlob } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function processAudio(inputPath, outputZipPath) {
  const form = new FormData();
  const audio = await openAsBlob(inputPath);
  form.set("file", audio, basename(inputPath));

  const headers = {};
  if (process.env.MODAL_KEY && process.env.MODAL_SECRET) {
    headers["Modal-Key"] = process.env.MODAL_KEY;
    headers["Modal-Secret"] = process.env.MODAL_SECRET;
  }

  const response = await fetch(process.env.MODAL_URL, {
    method: "POST",
    headers,
    body: form,
    redirect: "follow",
    signal: AbortSignal.timeout(60 * 60 * 1000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Modal 请求失败 (${response.status}): ${detail}`);
  }
  if (!response.body) {
    throw new Error("Modal 返回了空响应");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/zip")) {
    throw new Error(`Modal 返回的不是 ZIP: ${contentType || "unknown"}`);
  }

  await mkdir(dirname(outputZipPath), { recursive: true });
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(outputZipPath),
  );
  return outputZipPath;
}

await processAudio("./song.m4a", "./data/output/result.zip");
```

上传字段名必须为 `file`，不要手动设置 `Content-Type`，`FormData` 会自动生成
multipart boundary。接口支持 `.wav`、`.flac`、`.mp3`、`.ogg`、`.opus`、
`.m4a`、`.aiff`、`.ac3`，音频必须包含非空的 `title` 和 `album` 标签。

当前 Modal 端点启用了 Proxy Auth，需要配置 `MODAL_URL`。再配置 `MODAL_KEY` 和
`MODAL_SECRET`；代码会通过 `Modal-Key`、`Modal-Secret` Header 自动携带凭据。

相关参数已经配置到 .env 里面，然后docker也添加到了compose里面
MODAL_URL: "your-modal-url"
MODAL_KEY: "your-modal-key"
MODAL_SECRET: "your-modal-secret"
