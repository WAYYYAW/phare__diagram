(function() {
    var STORAGE_KEY = '_xu_analytics_v1';
    var ENDPOINT = 'http://111.228.48.127:25410/analytics';

    var last = localStorage.getItem(STORAGE_KEY);
    if (last && Date.now() - parseInt(last, 10) < 3600000) return;
    localStorage.setItem(STORAGE_KEY, String(Date.now()));

    var data = {
        resolution: screen.width + 'x' + screen.height,
        viewport: window.innerWidth + 'x' + window.innerHeight,
        pixelRatio: window.devicePixelRatio || 1,
        platform: navigator.platform,
        language: navigator.language,
        userAgent: navigator.userAgent,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        cores: navigator.hardwareConcurrency || 'unknown',
        cookieEnabled: navigator.cookieEnabled,
        referrer: document.referrer || 'direct',
        url: location.href,
    };

    var params = [];
    for (var key in data) {
        if (data.hasOwnProperty(key)) {
            params.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(data[key])));
        }
    }
    var img = new Image();
    img.src = ENDPOINT + '?' + params.join('&');
})();
