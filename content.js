'use strict';

(function () {
  var tools = globalThis.YTTools;
  if (!tools) return;

  var CARD = [
    'yt-lockup-view-model',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-playlist-panel-video-renderer',
    'ytd-reel-item-renderer'
  ].join(',');

  var COPY_PATH = 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z';
  var CHECK_PATH = 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z';
  var CAMERA_PATH = 'M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 13a4 4 0 1 1 4-4 4 4 0 0 1-4 4z';
  var DOWN_PATH = 'M19 20H5v-2h14v2zM11 4h2v8h3l-4 4-4-4h3V4z';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var MAX_RECORD_BYTES = 4 * 1024 * 1024 * 1024;
  var MAX_MEMORY_BYTES = 150 * 1024 * 1024;
  var MAX_FRAME = 7680;

  var watchHost = null;
  var ui = null;
  var toastNode = null;
  var toastTimer = 0;
  var scanTimer = 0;
  var record = {
    busy: false,
    recorder: null,
    chunks: [],
    detach: null,
    timer: 0,
    elapsed: 0,
    tickAt: 0
  };

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function icon(path) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('aria-hidden', 'true');
    var node = document.createElementNS(SVG_NS, 'path');
    node.setAttribute('fill', 'currentColor');
    node.setAttribute('d', path);
    svg.appendChild(node);
    return svg;
  }

  function addCss(shadow, text) {
    var style = document.createElement('style');
    style.textContent = text;
    shadow.appendChild(style);
  }

  function plainText(el) {
    if (!el) return '';
    var clone = el.cloneNode(true);
    var hosts = clone.querySelectorAll('.yt-tools-host, .yt-watch-tools, .yt-tools-toast');
    for (var i = 0; i < hosts.length; i++) hosts[i].remove();
    return tools.cleanTitle(clone.textContent || '');
  }

  function cardTitle(card) {
    if (!card) return '';
    var el = card.querySelector(
      'a.ytLockupMetadataViewModelTitle .ytAttributedStringHost, a.ytLockupMetadataViewModelTitle span, a#video-title yt-formatted-string, yt-formatted-string#video-title, a#video-title, a#video-title-link span'
    );
    return plainText(el);
  }

  function watchTitle() {
    var el = document.querySelector(
      'ytd-watch-metadata #title h1 yt-formatted-string, ytd-watch-metadata h1 yt-formatted-string, h1.ytd-watch-metadata yt-formatted-string'
    );
    var text = plainText(el);
    if (text) return text;
    return tools.cleanTitle(String(document.title || '').replace(/\s*-\s*YouTube\s*$/, ''));
  }

  function toast(message) {
    if (!toastNode || !toastNode.isConnected) {
      toastNode = document.createElement('div');
      toastNode.className = 'yt-tools-toast';
      toastNode.style.setProperty('position', 'fixed', 'important');
      toastNode.style.setProperty('left', '50%', 'important');
      toastNode.style.setProperty('bottom', '24px', 'important');
      toastNode.style.setProperty('transform', 'translateX(-50%)', 'important');
      toastNode.style.setProperty('z-index', '10000', 'important');
      toastNode.style.setProperty('pointer-events', 'none', 'important');
      var shadow = toastNode.attachShadow({ mode: 'open' });
      addCss(shadow, '.msg{padding:8px 12px;border-radius:8px;background:rgba(15,18,28,.92);color:#fff;font:13px/1.3 Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.28);}');
      var msg = document.createElement('div');
      msg.className = 'msg';
      shadow.appendChild(msg);
      toastNode._msg = msg;
      document.documentElement.appendChild(toastNode);
    }
    toastNode._msg.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (toastNode) toastNode.remove();
      toastNode = null;
    }, 1800);
  }

  function copyWithTextarea(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.documentElement.appendChild(area);
    area.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (error) {
      ok = false;
    }
    area.remove();
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }, function () {
        return copyWithTextarea(text);
      });
    }
    return Promise.resolve(copyWithTextarea(text));
  }

  function placeCopyButton(host, card) {
    if (getComputedStyle(card).position === 'static') {
      card.style.setProperty('position', 'relative', 'important');
    }
    var thumb = card.querySelector('a.ytLockupViewModelContentImage, ytd-thumbnail, a#thumbnail');
    var top = 8;
    var left = null;
    if (thumb) {
      var cardRect = card.getBoundingClientRect();
      var thumbRect = thumb.getBoundingClientRect();
      if (thumbRect.width > 40 && cardRect.width > 40) {
        top = Math.max(4, Math.round(thumbRect.top - cardRect.top + 8));
        left = Math.max(4, Math.round(thumbRect.right - cardRect.left - 40));
      }
    }
    host.style.setProperty('top', top + 'px', 'important');
    if (left == null) {
      host.style.setProperty('right', '8px', 'important');
      host.style.removeProperty('left');
    } else {
      host.style.setProperty('left', left + 'px', 'important');
      host.style.setProperty('right', 'auto', 'important');
    }
  }

  function cardVideoLink(card) {
    var preferred = card.querySelector('a.ytLockupMetadataViewModelTitle[href], a#video-title[href], a#video-title-link[href]');
    if (preferred && tools.videoIdFromUrl(preferred.href, location.origin)) return preferred;
    var links = card.querySelectorAll('a[href*="watch?v="], a[href*="/shorts/"]');
    for (var i = 0; i < links.length; i++) {
      if (tools.videoIdFromUrl(links[i].href, location.origin)) return links[i];
    }
    return null;
  }

  function mountCopyButton(card) {
    if (!cardVideoLink(card)) return;

    var host = null;
    var children = card.children;
    for (var i = 0; i < children.length; i++) {
      if (children[i].classList && children[i].classList.contains('yt-tools-host')) host = children[i];
    }
    if (host && host.shadowRoot && host.shadowRoot.querySelector('button')) {
      placeCopyButton(host, card);
      return;
    }
    if (host) host.remove();

    host = document.createElement('div');
    host.className = 'yt-tools-host';
    host.setAttribute('data-yt-tools', 'copy');
    host.style.setProperty('position', 'absolute', 'important');
    host.style.setProperty('z-index', '20', 'important');
    host.style.setProperty('width', '32px', 'important');
    host.style.setProperty('height', '32px', 'important');
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('pointer-events', 'auto', 'important');

    var shadow = host.attachShadow({ mode: 'open' });
    addCss(shadow, 'button{width:32px;height:32px;padding:0;border:0;border-radius:8px;display:grid;place-items:center;cursor:pointer;color:#fff;background:rgba(15,18,28,.78);box-shadow:0 1px 4px rgba(0,0,0,.35);}button:hover{background:rgba(15,18,28,.92);}button:focus-visible{outline:2px solid #e2b657;outline-offset:2px;}');
    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', '复制标题');
    var glyph = icon(COPY_PATH);
    button.appendChild(glyph);
    shadow.appendChild(button);

    button.addEventListener('pointerdown', stopEvent);
    button.addEventListener('pointerup', stopEvent);
    button.addEventListener('click', function (event) {
      stopEvent(event);
      var current = host.closest(CARD) || card;
      var title = cardTitle(current);
      if (!title) {
        toast('没有读到标题');
        return;
      }
      copyText(title).then(function (ok) {
        toast(ok ? '已复制标题' : '复制失败');
        if (!ok) return;
        var path = glyph.querySelector('path');
        path.setAttribute('d', CHECK_PATH);
        setTimeout(function () {
          path.setAttribute('d', COPY_PATH);
        }, 1200);
      });
    });

    card.appendChild(host);
    placeCopyButton(host, card);
  }

  function decorateCards() {
    var cards = document.querySelectorAll(CARD);
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].querySelector(CARD)) continue;
      try { mountCopyButton(cards[i]); } catch (error) {}
    }
  }

  function mainVideo() {
    var nodes = document.querySelectorAll('#movie_player video, video.html5-main-video, ytd-shorts video');
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < nodes.length; i++) {
      var video = nodes[i];
      var area = (video.videoWidth || 0) * (video.videoHeight || 0);
      if (area > bestArea && area < MAX_FRAME * MAX_FRAME) {
        best = video;
        bestArea = area;
      }
    }
    return best;
  }

  function isAd() {
    var player = document.getElementById('movie_player');
    return !!(player && player.classList.contains('ad-showing'));
  }

  function saveBlob(blob, filename) {
    if (!blob || !filename) return;
    var type = blob.type || '';
    if (type !== 'image/png' && type.indexOf('video/webm') !== 0) {
      toast('无法保存这个文件');
      return;
    }
    var link = document.createElement('a');
    var url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 20000);
  }

  function saveFrame() {
    var video = mainVideo();
    if (!video || video.videoWidth < 2 || video.videoHeight < 2) {
      toast('请先播放视频');
      return;
    }
    if (video.videoWidth > MAX_FRAME || video.videoHeight > MAX_FRAME) {
      toast('画面尺寸异常');
      return;
    }
    if (isAd()) {
      toast('请等广告结束后再操作');
      return;
    }
    try {
      var canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      canvas.toBlob(function (blob) {
        if (!blob) {
          toast('这一帧无法导出');
          return;
        }
        saveBlob(blob, tools.sanitizeFilename(watchTitle() || 'youtube-video', 'png'));
        toast('已保存截图');
      }, 'image/png');
    } catch (error) {
      toast('这一帧无法导出');
    }
  }

  function clock(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var seconds = total % 60;
    var minutes = Math.floor(total / 60) % 60;
    var hours = Math.floor(total / 3600);
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    if (hours > 0) return hours + ':' + pad(minutes) + ':' + pad(seconds);
    return pad(minutes) + ':' + pad(seconds);
  }

  function pickMime() {
    var types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    if (!window.MediaRecorder) return '';
    for (var i = 0; i < types.length; i++) {
      if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return '';
  }

  function createRecorder(stream, mime, height) {
    var options = {
      videoBitsPerSecond: height >= 1080 ? 6000000 : height >= 720 ? 4000000 : 2500000
    };
    if (mime) options.mimeType = mime;
    try {
      return new MediaRecorder(stream, options);
    } catch (error) {
      return new MediaRecorder(new MediaStream(stream.getVideoTracks()), options);
    }
  }

  function cleanupRecording() {
    if (record.detach) record.detach();
    clearInterval(record.timer);
    record.busy = false;
    record.recorder = null;
    record.chunks = [];
    record.detach = null;
    record.timer = 0;
    record.elapsed = 0;
    if (ui) {
      ui.idle.hidden = false;
      ui.active.hidden = true;
    }
  }

  function finishRecording() {
    var recorder = record.recorder;
    if (!recorder || recorder.state === 'inactive') return;
    try { recorder.requestData(); } catch (error) {}
    try { recorder.stop(); } catch (error) {}
  }

  function armRecorder(video, recorder, writable, filename) {
    record.recorder = recorder;
    record.chunks = [];
    record.elapsed = 0;
    record.tickAt = Date.now();
    var total = 0;
    var chain = Promise.resolve();
    var settled = false;
    var cap = writable ? MAX_RECORD_BYTES : MAX_MEMORY_BYTES;

    function done() {
      if (settled) return;
      settled = true;
      chain.then(function () {
        if (writable) return writable.close();
      }).then(function () {
        if (writable) {
          toast('已保存视频');
          return;
        }
        var blob = new Blob(record.chunks, { type: 'video/webm' });
        if (blob.size < 1000) {
          toast('没有录到内容');
          return;
        }
        saveBlob(blob, filename);
        toast('已保存视频');
      }).catch(function () {
        toast('保存失败');
      }).then(cleanupRecording);
    }

    recorder.ondataavailable = function (event) {
      var chunk = event.data;
      if (!chunk || !chunk.size) return;
      total += chunk.size;
      if (writable) chain = chain.then(function () { return writable.write(chunk); });
      else record.chunks.push(chunk);
      if (total >= cap) {
        toast('已达到大小上限，先保存这一段');
        finishRecording();
      }
    };
    recorder.onerror = function () {
      toast('录制中断');
      try { recorder.stop(); } catch (error) { done(); }
    };
    recorder.onstop = done;

    var armedAt = Date.now();
    function onPause() {
      if (Date.now() - armedAt < 800) return;
      if (recorder.state === 'recording') recorder.pause();
    }
    function onPlay() {
      if (recorder.state === 'paused') recorder.resume();
    }
    function onEnded() { finishRecording(); }
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    if (Number.isFinite(video.duration)) video.addEventListener('ended', onEnded);
    record.detach = function () {
      video.removeEventListener('pause', onPause);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('ended', onEnded);
    };

    try {
      recorder.start(1000);
    } catch (error) {
      settled = true;
      if (writable && writable.abort) writable.abort().catch(function () {});
      cleanupRecording();
      toast('无法开始录制');
      return;
    }
    if (ui) {
      ui.panel.hidden = false;
      ui.idle.hidden = true;
      ui.active.hidden = false;
      ui.status.textContent = '正在录制 00:00';
    }
    record.timer = setInterval(function () {
      if (recorder.state === 'recording') record.elapsed += Date.now() - record.tickAt;
      record.tickAt = Date.now();
      if (ui) ui.status.textContent = '正在录制 ' + clock(record.elapsed);
    }, 500);
  }

  function seekStart(video) {
    if (!Number.isFinite(video.duration) || video.currentTime < 0.25) return Promise.resolve();
    return new Promise(function (resolve) {
      var settled = false;
      function done() {
        if (settled) return;
        settled = true;
        video.removeEventListener('seeked', done);
        resolve();
      }
      video.addEventListener('seeked', done);
      try { video.currentTime = 0; } catch (error) { done(); }
      setTimeout(done, 1500);
    });
  }

  function startRecorder(video, fromStart, handle, filename) {
    var stream;
    try {
      stream = video.captureStream();
    } catch (error) {
      record.busy = false;
      toast('无法读取播放中的视频');
      return;
    }
    var mediaRecorder;
    try {
      mediaRecorder = createRecorder(stream, pickMime(), video.videoHeight || 0);
    } catch (error) {
      record.busy = false;
      toast('无法开始录制');
      return;
    }
    var writablePromise = handle ? handle.createWritable() : Promise.resolve(null);
    writablePromise.then(function (writable) {
      var prepare = fromStart ? seekStart(video) : Promise.resolve();
      return prepare.then(function () {
        return video.play();
      }).then(function () {
        armRecorder(video, mediaRecorder, writable, filename);
      }, function () {
        record.busy = false;
        if (writable && writable.abort) writable.abort().catch(function () {});
        toast('请先点一下播放器再保存');
      });
    }).catch(function () {
      record.busy = false;
      toast('无法创建保存文件');
    });
  }

  function beginRecording(fromStart) {
    if (record.recorder || record.busy) return;
    var video = mainVideo();
    if (!video) {
      toast('请先播放视频');
      return;
    }
    if (isAd()) {
      toast('请等广告结束后再操作');
      return;
    }
    record.busy = true;
    var suggested = tools.sanitizeFilename(watchTitle() || 'youtube-video', 'webm');
    var request;
    if (typeof showSaveFilePicker === 'function') {
      request = showSaveFilePicker({
        suggestedName: suggested,
        types: [{ description: 'WebM 视频', accept: { 'video/webm': ['.webm'] } }]
      });
    } else {
      request = Promise.resolve(null);
    }
    request.then(function (handle) {
      startRecorder(video, fromStart, handle, suggested);
    }).catch(function (error) {
      if (error && error.name === 'AbortError') {
        record.busy = false;
        return;
      }
      startRecorder(video, fromStart, null, suggested);
    });
  }

  function labeledButton(label, path) {
    var button = document.createElement('button');
    button.type = 'button';
    button.appendChild(icon(path));
    var span = document.createElement('span');
    span.textContent = label;
    button.appendChild(span);
    return button;
  }

  function buildWatchBar() {
    var host = document.createElement('div');
    host.className = 'yt-watch-tools';
    host.setAttribute('data-yt-tools', 'watch');
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('margin', '10px 0 6px', 'important');
    host.style.setProperty('pointer-events', 'auto', 'important');
    var shadow = host.attachShadow({ mode: 'open' });
    addCss(shadow, '.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}button{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:8px;padding:7px 12px;cursor:pointer;font:13px/1.2 Arial,sans-serif;color:var(--yt-spec-text-primary,#0f0f0f);background:var(--yt-spec-badge-chip-background,#e8e8e8);}button:hover{filter:brightness(1.08);}button:focus-visible{outline:2px solid #e2b657;outline-offset:2px;}.panel{margin-top:8px;padding:10px;border-radius:10px;max-width:540px;background:var(--yt-spec-badge-chip-background,rgba(0,0,0,.06));color:var(--yt-spec-text-primary,#0f0f0f);font:13px/1.45 Arial,sans-serif;}.hint{margin:0 0 8px;}.status{font-weight:700;margin:0 0 8px;}');

    var row = document.createElement('div');
    row.className = 'row';
    var copyButton = labeledButton('复制标题', COPY_PATH);
    var shotButton = labeledButton('截图', CAMERA_PATH);
    var saveButton = labeledButton('保存视频', DOWN_PATH);
    row.append(copyButton, shotButton, saveButton);

    var panel = document.createElement('div');
    panel.className = 'panel';
    panel.hidden = true;
    var hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '播放器没有公开的视频文件。这里会录制正在播放的画面和声音，保存成 WebM，画质与当前播放器一致，单次最多 4GB。';
    var idle = document.createElement('div');
    idle.className = 'row';
    var fromStart = labeledButton('从头录制', DOWN_PATH);
    var fromHere = labeledButton('从这里录制', DOWN_PATH);
    idle.append(fromStart, fromHere);
    var active = document.createElement('div');
    active.hidden = true;
    var status = document.createElement('p');
    status.className = 'status';
    status.textContent = '正在录制 00:00';
    var stopButton = labeledButton('停止并保存', CHECK_PATH);
    active.append(status, stopButton);
    panel.append(hint, idle, active);
    shadow.append(row, panel);

    copyButton.addEventListener('click', function (event) {
      stopEvent(event);
      var title = watchTitle();
      if (!title) {
        toast('没有读到标题');
        return;
      }
      copyText(title).then(function (ok) {
        toast(ok ? '已复制标题' : '复制失败');
      });
    });
    shotButton.addEventListener('click', function (event) {
      stopEvent(event);
      saveFrame();
    });
    saveButton.addEventListener('click', function (event) {
      stopEvent(event);
      panel.hidden = !panel.hidden;
    });
    fromStart.addEventListener('click', function (event) {
      stopEvent(event);
      beginRecording(true);
    });
    fromHere.addEventListener('click', function (event) {
      stopEvent(event);
      beginRecording(false);
    });
    stopButton.addEventListener('click', function (event) {
      stopEvent(event);
      finishRecording();
    });

    ui = { panel: panel, idle: idle, active: active, status: status };
    return host;
  }

  function ensureWatchTools() {
    if (!tools.isPlayerPath(location.pathname)) {
      if (record.recorder) finishRecording();
      if (watchHost) {
        watchHost.remove();
        watchHost = null;
        ui = null;
      }
      return;
    }
    if (watchHost && watchHost.isConnected) return;
    watchHost = buildWatchBar();
    var title = document.querySelector('ytd-watch-metadata #title');
    if (title) {
      title.insertAdjacentElement('afterend', watchHost);
      return;
    }
    watchHost.style.setProperty('position', 'fixed', 'important');
    watchHost.style.setProperty('top', '72px', 'important');
    watchHost.style.setProperty('right', '16px', 'important');
    watchHost.style.setProperty('z-index', '1000', 'important');
    watchHost.style.setProperty('background', 'rgba(15,18,28,.92)', 'important');
    watchHost.style.setProperty('padding', '8px', 'important');
    watchHost.style.setProperty('border-radius', '12px', 'important');
    document.documentElement.appendChild(watchHost);
  }

  function scan() {
    try {
      decorateCards();
      ensureWatchTools();
    } catch (error) {}
  }

  function schedule() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 400);
  }

  function boot() {
    scan();
    setTimeout(scan, 800);
    setTimeout(scan, 2200);
    var observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', function () {
      if (record.recorder) finishRecording();
      if (watchHost) {
        watchHost.remove();
        watchHost = null;
        ui = null;
      }
      setTimeout(scan, 300);
    });
    window.addEventListener('pagehide', function () {
      if (record.recorder) finishRecording();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
