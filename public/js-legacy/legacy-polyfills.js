(function (w, d) {
    'use strict';
    if (!w.globalThis)
        w.globalThis = w;
    if (!Date.now)
        Date.now = function () { return new Date().getTime(); };
    if (!Object.hasOwn)
        Object.hasOwn = function (o, p) { return Object.prototype.hasOwnProperty.call(Object(o), p); };
    if (!Object.keys)
        Object.keys = function (o) { var r = [], k; for (k in o)
            if (Object.prototype.hasOwnProperty.call(o, k))
                r.push(k); return r; };
    if (!Object.values)
        Object.values = function (o) { var k = Object.keys(o), r = [], i; for (i = 0; i < k.length; i++)
            r.push(o[k[i]]); return r; };
    if (!Object.entries)
        Object.entries = function (o) { var k = Object.keys(o), r = [], i; for (i = 0; i < k.length; i++)
            r.push([k[i], o[k[i]]]); return r; };
    if (!Object.fromEntries)
        Object.fromEntries = function (it) { var o = {}, i; for (i = 0; i < it.length; i++)
            o[it[i][0]] = it[i][1]; return o; };
    if (!String.prototype.trim)
        String.prototype.trim = function () { return this.replace(/^\s+|\s+$/g, ''); };
    if (!String.prototype.includes)
        String.prototype.includes = function (s, p) { return this.indexOf(s, p || 0) !== -1; };
    if (!String.prototype.startsWith)
        String.prototype.startsWith = function (s, p) { p = p || 0; return this.substr(p, s.length) === s; };
    if (!String.prototype.endsWith)
        String.prototype.endsWith = function (s, l) { l = l === undefined ? this.length : l; return this.substring(l - s.length, l) === s; };
    if (!Array.isArray)
        Array.isArray = function (a) { return Object.prototype.toString.call(a) === '[object Array]'; };
    if (!Array.prototype.forEach)
        Array.prototype.forEach = function (fn, t) { for (var i = 0; i < this.length; i++)
            if (i in this)
                fn.call(t, this[i], i, this); };
    if (!Array.prototype.map)
        Array.prototype.map = function (fn, t) { var r = []; for (var i = 0; i < this.length; i++)
            if (i in this)
                r[i] = fn.call(t, this[i], i, this); return r; };
    if (!Array.prototype.filter)
        Array.prototype.filter = function (fn, t) { var r = []; for (var i = 0; i < this.length; i++)
            if (i in this && fn.call(t, this[i], i, this))
                r.push(this[i]); return r; };
    if (!Array.prototype.find)
        Array.prototype.find = function (fn, t) { for (var i = 0; i < this.length; i++)
            if (fn.call(t, this[i], i, this))
                return this[i]; };
    if (!Array.prototype.findIndex)
        Array.prototype.findIndex = function (fn, t) { for (var i = 0; i < this.length; i++)
            if (fn.call(t, this[i], i, this))
                return i; return -1; };
    if (!Array.prototype.some)
        Array.prototype.some = function (fn, t) { for (var i = 0; i < this.length; i++)
            if (fn.call(t, this[i], i, this))
                return true; return false; };
    if (!Array.prototype.includes)
        Array.prototype.includes = function (v, p) { p = p || 0; for (var i = p; i < this.length; i++)
            if (this[i] === v || (v !== v && this[i] !== this[i]))
                return true; return false; };
    if (!Array.prototype.flat)
        Array.prototype.flat = function (depth) { depth = depth === undefined ? 1 : Number(depth) || 0; var out = []; function add(a, d) { for (var i = 0; i < a.length; i++) {
            var v = a[i];
            if (Array.isArray(v) && d > 0)
                add(v, d - 1);
            else
                out.push(v);
        } } add(this, depth); return out; };
    if (!Array.prototype.flatMap)
        Array.prototype.flatMap = function (fn, t) { return this.map(fn, t).flat(1); };
    if (w.NodeList && !NodeList.prototype.forEach)
        NodeList.prototype.forEach = Array.prototype.forEach;
    var EP = w.Element && Element.prototype;
    if (EP) {
        if (!EP.matches)
            EP.matches = EP.msMatchesSelector || EP.webkitMatchesSelector || function (s) { var n = (this.document || this.ownerDocument).querySelectorAll(s), i = 0; while (n[i] && n[i] !== this)
                i++; return !!n[i]; };
        if (!EP.closest)
            EP.closest = function (s) { var e = this; while (e && e.nodeType === 1) {
                if (e.matches(s))
                    return e;
                e = e.parentElement || e.parentNode;
            } return null; };
    }
    if (typeof w.CustomEvent !== 'function') {
        w.CustomEvent = function (e, p) { p = p || { bubbles: false, cancelable: false, detail: null }; var x = d.createEvent('CustomEvent'); x.initCustomEvent(e, p.bubbles, p.cancelable, p.detail); return x; };
        w.CustomEvent.prototype = w.Event ? w.Event.prototype : {};
    }
    if (!w.requestAnimationFrame)
        w.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); };
    if (!w.cancelAnimationFrame)
        w.cancelAnimationFrame = function (id) { clearTimeout(id); };
    if (!w.Map) {
        w.Map = function () { this._k = []; this._v = []; };
        Map.prototype.set = function (k, v) { var i = this._k.indexOf(k); if (i < 0) {
            this._k.push(k);
            this._v.push(v);
        }
        else
            this._v[i] = v; return this; };
        Map.prototype.get = function (k) { var i = this._k.indexOf(k); return i < 0 ? undefined : this._v[i]; };
        Map.prototype.has = function (k) { return this._k.indexOf(k) >= 0; };
        Map.prototype.delete = function (k) { var i = this._k.indexOf(k); if (i < 0)
            return false; this._k.splice(i, 1); this._v.splice(i, 1); return true; };
        Map.prototype.clear = function () { this._k = []; this._v = []; };
    }
    if (!w.Set) {
        w.Set = function (a) { this._v = []; if (a)
            for (var i = 0; i < a.length; i++)
                this.add(a[i]); };
        Set.prototype.add = function (v) { if (this._v.indexOf(v) < 0)
            this._v.push(v); return this; };
        Set.prototype.has = function (v) { return this._v.indexOf(v) >= 0; };
        Set.prototype.delete = function (v) { var i = this._v.indexOf(v); if (i < 0)
            return false; this._v.splice(i, 1); return true; };
        Set.prototype.clear = function () { this._v = []; };
    }
    if (!w.Promise) {
        var P = function (fn) { var self = this; self.s = 0; self.v = null; self.q = []; function done(s, v) { if (self.s)
            return; if (v && typeof v.then === 'function')
            return v.then(ok, no); self.s = s; self.v = v; setTimeout(run, 0); } function run() { var q = self.q.slice(); self.q = []; for (var i = 0; i < q.length; i++)
            handle(q[i]); } function handle(h) { if (!self.s) {
            self.q.push(h);
            return;
        } var cb = self.s === 1 ? h.ok : h.no; if (!cb) {
            (self.s === 1 ? h.res : h.rej)(self.v);
            return;
        } try {
            h.res(cb(self.v));
        }
        catch (e) {
            h.rej(e);
        } } function ok(v) { done(1, v); } function no(e) { done(2, e); } self.then = function (a, b) { return new P(function (r, j) { handle({ ok: a, no: b, res: r, rej: j }); }); }; self.catch = function (b) { return self.then(null, b); }; try {
            fn(ok, no);
        }
        catch (e) {
            no(e);
        } };
        P.resolve = function (v) { return new P(function (r) { r(v); }); };
        P.reject = function (e) { return new P(function (r, j) { j(e); }); };
        P.all = function (a) { return new P(function (r, j) { var o = [], n = a.length; if (!n)
            return r([]); for (var i = 0; i < a.length; i++)
            (function (i) { P.resolve(a[i]).then(function (v) { o[i] = v; if (!--n)
                r(o); }, j); })(i); }); };
        P.race = function (a) { return new P(function (r, j) { for (var i = 0; i < a.length; i++)
            P.resolve(a[i]).then(r, j); }); };
        w.Promise = P;
    }
    if (!Promise.prototype.finally)
        Promise.prototype.finally = function (cb) { var C = this.constructor || Promise; return this.then(function (v) { return C.resolve(cb()).then(function () { return v; }); }, function (e) { return C.resolve(cb()).then(function () { throw e; }); }); };
    if (!w.fetch) {
        w.fetch = function (url, opt) { opt = opt || {}; return new Promise(function (res, rej) { var x = new XMLHttpRequest(); x.open(opt.method || 'GET', url, true); var h = opt.headers || {}, k; for (k in h)
            if (Object.prototype.hasOwnProperty.call(h, k))
                x.setRequestHeader(k, h[k]); x.onload = function () { var hs = x.getAllResponseHeaders(), map = {}; hs.replace(/^(.*?):[ \t]*([^\r\n]*)$/mg, function (_, a, b) { map[a.toLowerCase()] = b; }); res({ ok: x.status >= 200 && x.status < 300, status: x.status, text: function () { return Promise.resolve(x.responseText); }, json: function () { return Promise.resolve(JSON.parse(x.responseText)); }, headers: { get: function (n) { return map[String(n).toLowerCase()] || null; } } }); }; x.onerror = function () { rej(new TypeError('Falha de rede')); }; x.send(opt.body || null); }); };
    }
    if (!w.AbortController) {
        w.AbortController = function () { this.signal = { aborted: false, addEventListener: function () { } }; this.abort = function () { this.signal.aborted = true; }; };
    }
})(window, document);
