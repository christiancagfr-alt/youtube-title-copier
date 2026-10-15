'use strict';

importScripts('shared.js');

var HOST = 'com.youtubetitles.downloader';
var active = null;

function clip(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 500);
}

function sanitizeHostMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.type === 'progress') {
    var out = { type: 'progress', message: clip(msg.message) };
    var percent = Number(msg.percent);
    if (isFinite(percent)) out.percent = Math.max(0, Math.min(100, Math.round(percent)));
    return out;
  }
  if (msg.type === 'done') {
    return { type: 'done', message: clip(msg.message), path: clip(msg.path) };
  }
  if (msg.type === 'error') {
    return { type: 'error', message: clip(msg.message) || '下载失败' };
  }
  return null;
}

function hostError(message) {
  var text = String(message || '');
  if (/not found|forbidden|access to the specified native/i.test(text)) {
    return '还没有安装本机下载组件。请在扩展目录运行 install-host.ps1，然后重新加载扩展。';
  }
  return '下载组件已断开。如果这是第一次使用，请先运行 install-host.ps1。';
}

function fail(port, message) {
  try { port.postMessage({ type: 'error', message: message }); } catch (error) {}
  try { port.disconnect(); } catch (error) {}
}

chrome.runtime.onConnect.addListener(function (port) {
  if (!port || port.name !== 'yt-download') return;
  var page = port.sender && port.sender.url || '';
  if (!port.sender || !port.sender.tab || page.indexOf('https://www.youtube.com/') !== 0) {
    fail(port, '只能从 YouTube 页面下载');
    return;
  }

  port.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== 'download') return;
    if (active) {
      fail(port, '已经有一个视频在下载');
      return;
    }
    var tools = globalThis.YTTools;
    var id = tools.videoIdFromUrl('https://www.youtube.com/watch?v=' + String(msg.videoId || ''));
    if (!id) {
      fail(port, '视频编号无效');
      return;
    }
    var native;
    try {
      native = chrome.runtime.connectNative(HOST);
    } catch (error) {
      fail(port, '还没有安装本机下载组件。请在扩展目录运行 install-host.ps1，然后重新加载扩展。');
      return;
    }
    active = native;
    var settled = false;
    native.onMessage.addListener(function (fromHost) {
      var safe = sanitizeHostMessage(fromHost);
      if (!safe) return;
      if (safe.type === 'done' || safe.type === 'error') settled = true;
      try { port.postMessage(safe); } catch (error) {}
    });
    native.onDisconnect.addListener(function () {
      if (active === native) active = null;
      if (!settled) {
        var message = chrome.runtime.lastError && chrome.runtime.lastError.message;
        try { port.postMessage({ type: 'error', message: hostError(message) }); } catch (error) {}
      }
      try { port.disconnect(); } catch (error) {}
    });
    port.onDisconnect.addListener(function () {
      if (active === native) {
        active = null;
        try { native.disconnect(); } catch (error) {}
      }
    });
    native.postMessage({
      type: 'download',
      videoId: id,
      title: tools.cleanTitle(typeof msg.title === 'string' ? msg.title : '')
    });
  });
});
