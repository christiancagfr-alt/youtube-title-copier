# YouTube 视频标题复制器

在 YouTube 视频卡片上复制标题。打开播放页后，可以截取当前画面，或用本机的 yt-dlp 把视频下载成可播放的 mp4。

## 安装

1. 打开 Chrome，进入 `chrome://extensions`。
2. 打开「开发者模式」。
3. 选择「加载已解压的扩展程序」，选中这个文件夹。
4. 在这个文件夹里运行一次 `install-host.ps1`。它会检查 Python 里的 yt-dlp、Node.js 和 ffmpeg，并注册本机下载组件。
5. 回到 `chrome://extensions`，重新加载这个扩展。

下载组件只登记在当前 Windows 用户下。如果把文件夹挪到别的位置，再运行一次 `install-host.ps1`。

## 使用

- 视频卡片右上角的按钮只复制该视频的标题。
- 播放页标题下方有「复制标题」「截图」「下载视频」「保存位置」。
- 截图保存当前画面的 PNG，不包含播放器控件。
- 「下载视频」把这一条视频交给本机 yt-dlp，合成一个 mp4。默认保存到「下载」文件夹。
- 点工具栏图标，或播放页的「保存位置」，可以选择别的文件夹。这个路径只保存在本机，页面不能指定保存位置。
- 状态行会显示保存到的完整路径。
- 需要登录或有年龄限制的视频不会去读浏览器的登录状态。

请只下载你有权保存的视频。

## 权限

扩展只在 `https://www.youtube.com/*` 注入脚本。

`clipboardWrite` 用来在点击「复制标题」时写入剪贴板。扩展不读取剪贴板。

`nativeMessaging` 用来把视频编号发给本机的 yt-dlp。扩展不申请全站权限，不把视频地址发到别的网站，也不在扩展里执行 YouTube 的播放器脚本。

## 检查

```powershell
node --test tests/security.test.mjs
node --check shared.js
node --check content.js
node --check background.js
node --check options.js
py -3 tests/host_logic_test.py
```
