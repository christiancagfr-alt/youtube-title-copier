# YouTube 视频标题复制器

在 YouTube 视频卡片上复制标题。打开播放页后，还可以截取当前画面，或把正在播放的视频保存到电脑。

## 安装

1. 打开 Chrome，进入 `chrome://extensions`。
2. 打开「开发者模式」。
3. 选择「加载已解压的扩展程序」，选中这个文件夹。

## 使用

- 视频卡片右上角的按钮只复制该视频的标题。
- 播放页标题下方有三个按钮：复制标题、截图、保存视频。
- 截图保存当前画面的 PNG，不包含播放器控件。
- 保存视频会录制正在播放的画面和声音，生成 WebM。画质与播放器当前画质一致。可先在播放器里调高画质，再选择「从头录制」或「从这里录制」。

YouTube 现在把正片放在 `application/vnd.yt-ump` 媒体流里，页面上没有可直接下载的 mp4 地址。这个扩展不会破解播放器签名，也不会把视频地址发到别的网站。

请只保存你有权保存的视频。

## 权限

扩展只在 `https://www.youtube.com/*` 注入脚本。

`clipboardWrite` 用来在点击「复制标题」时写入剪贴板。扩展不读取剪贴板，不申请全站权限，也不远程加载代码。

## 检查

```powershell
node --test tests/security.test.mjs
node --check shared.js
node --check content.js
```
