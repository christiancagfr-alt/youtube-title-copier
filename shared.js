'use strict';

(function (root) {
  var MAX_TITLE = 300;
  var MAX_NAME = 80;
  var RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  function cleanTitle(raw) {
    if (typeof raw !== 'string') return '';
    var text = raw
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || text.length > MAX_TITLE) return '';
    return text;
  }

  function sanitizeFilename(name, extension) {
    if (extension !== 'png' && extension !== 'webm') return '';
    var base = String(name || '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/[<>:"/\\|?*]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[\s.]+/, '')
      .replace(/[\s.]+$/, '')
      .trim();
    if (base.length > MAX_NAME) base = base.slice(0, MAX_NAME).trim();
    if (!base || RESERVED.test(base)) base = 'youtube-video';
    return base + '.' + extension;
  }

  function videoIdFromUrl(href, base) {
    var url;
    try {
      url = new URL(href, base || 'https://www.youtube.com');
    } catch (error) {
      return '';
    }
    if (url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    var host = url.hostname.replace(/^www\./, '');
    if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com' && host !== 'youtu.be') {
      return '';
    }
    var id = '';
    if (host === 'youtu.be') {
      id = url.pathname.split('/').filter(Boolean)[0] || '';
    } else if (url.pathname === '/watch') {
      id = url.searchParams.get('v') || '';
    } else {
      var match = url.pathname.match(/^\/shorts\/([^/]+)/);
      if (match) id = match[1];
    }
    if (!/^[A-Za-z0-9_-]{6,16}$/.test(id)) return '';
    return id;
  }

  function isPlayerPath(pathname) {
    return pathname === '/watch' || pathname.indexOf('/shorts/') === 0;
  }

  root.YTTools = Object.freeze({
    cleanTitle: cleanTitle,
    sanitizeFilename: sanitizeFilename,
    videoIdFromUrl: videoIdFromUrl,
    isPlayerPath: isPlayerPath
  });
})(globalThis);
