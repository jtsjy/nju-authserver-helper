(function(d) {
    var b = function(f, e) {
        this.$element = d(f);
        this.options = d.extend({}, b.DEFAULTS, e);
        this.$element.css({
            position: "relative",
            width: this.options.width + "px",
            margin: "0 auto"
        });
        this.init()
    };
    b.VERSION = "2.0";
    b.Author = "XX@XX.com";
    var AUTO_BUILD = "silent-2026-11-20.11";
    window.__sliderCaptchaAuto = AUTO_BUILD;
    window.__sliderCaptchaReport = function() {
        var inst = d("#sliderDiv").data("lgb.SliderCaptcha");
        var domBg = d("#slider-img1")[0];
        var domPiece = d("#slider-img2")[0];
        return {
            url: window.location.href,
            version: AUTO_BUILD,
            hasInstance: !!inst,
            isOurPlugin: !!(inst && typeof inst.autoVerify === "function"),
            moveDebug: inst && inst._moveDebug,
            lastE: window.__lastSliderE,
            lastResponse: window.__lastSliderResponse,
            lastSecret: window.__lastSliderSecret,
            domMatchesLastImages: !!(window.__lastSliderImages && domBg && domPiece &&
                window.__lastSliderImages.background === domBg.src &&
                window.__lastSliderImages.piece === domPiece.src),
            imageLengths: window.__lastSliderImages ? {
                background: window.__lastSliderImages.background.length,
                piece: window.__lastSliderImages.piece.length
            } : null
        }
    };
    console.log("[sliderCaptcha-auto] 已加载 " + AUTO_BUILD + "（静默自动验证版本）");

    // ===== 白线检测：拼图底边白线长度固定为 66~67px，先用 #slider-img2 定位所在行，再到 #slider-img1 找同长度窗口 =====
    var WHITE_LINE_LENGTH = 67;

    // 在图片原始分辨率下取像素，跨域/未加载时返回 null
    var loadPixels = function(image) {
        var width = image.naturalWidth || image.width;
        var height = image.naturalHeight || image.height;
        if (!width || !height) {
            return null
        }
        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        try {
            return {
                width: width,
                height: height,
                data: ctx.getImageData(0, 0, width, height).data
            }
        } catch (err) {
            console.warn("sliderCaptcha: 无法读取图片像素（可能跨域）", err);
            return null
        }
    };

    // #slider-img2：拼图最底部有足够不透明像素的一行，就是底边白线所在行
    var findPieceBottomRow = function(image) {
        var pixels = loadPixels(image);
        if (!pixels) {
            return null
        }
        var width = pixels.width;
        var height = pixels.height;
        var data = pixels.data;
        var rowBytes = width * 4;
        for (var y = height - 1; y >= 0; y--) {
            var count = 0;
            for (var x = 0; x < width; x++) {
                if (data[y * rowBytes + x * 4 + 3] > 10) {
                    count++
                }
            }
            if (count >= 20) {
                return {
                    y: y
                }
            }
        }
        return null
    };

    // 用左侧边界跃变修正滑窗起点：本行变亮 + 上一行变暗
    var refineLineStart = function(pixels, y, x0) {
        var width = pixels.width;
        var data = pixels.data;
        var rowBytes = width * 4;
        var lo = Math.max(1, x0 - 10);
        var hi = Math.min(width - 2, x0 + 12);
        var best = null;
        for (var x = lo; x <= hi; x++) {
            var i = y * rowBytes + x * 4;
            var ip = i - 4;
            var ia = i - rowBytes;
            var iap = ia - 4;
            var lineCurrent = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            var linePrev = 0.299 * data[ip] + 0.587 * data[ip + 1] + 0.114 * data[ip + 2];
            var aboveCurrent = 0.299 * data[ia] + 0.587 * data[ia + 1] + 0.114 * data[ia + 2];
            var abovePrev = 0.299 * data[iap] + 0.587 * data[iap + 1] + 0.114 * data[iap + 2];
            var edge = (lineCurrent - linePrev) + (abovePrev - aboveCurrent);
            if (lineCurrent >= 220 && (!best || edge > best.edge)) {
                best = {
                    x: x,
                    edge: edge
                }
            }
        }
        return best ? best.x : null
    };

    // #slider-img1：在白线所在行滑动固定长度窗口，取“本行足够亮、上一行更暗”的窗口
    var findBackgroundLine = function(image, line) {
        var pixels = loadPixels(image);
        if (!pixels) {
            return null
        }
        var width = pixels.width;
        var height = pixels.height;
        var data = pixels.data;
        var rowBytes = width * 4;
        var length = WHITE_LINE_LENGTH;
        var y = line.y;
        if (y < 1 || y >= height) {
            return null
        }
        var best = null;
        for (var x = 0; x + length <= width; x++) {
            var lineR = 0;
            var lineG = 0;
            var lineB = 0;
            var aboveR = 0;
            var aboveG = 0;
            var aboveB = 0;
            for (var k = 0; k < length; k++) {
                var current = y * rowBytes + (x + k) * 4;
                var above = current - rowBytes;
                lineR += data[current];
                lineG += data[current + 1];
                lineB += data[current + 2];
                aboveR += data[above];
                aboveG += data[above + 1];
                aboveB += data[above + 2]
            }
            var lineLum = (0.299 * lineR + 0.587 * lineG + 0.114 * lineB) / length;
            var aboveLum = (0.299 * aboveR + 0.587 * aboveG + 0.114 * aboveB) / length;
            var score = lineLum - aboveLum;
            if (lineLum >= 220 && score >= 30 && (!best || score > best.score)) {
                best = {
                    x: x,
                    y: y,
                    score: score
                }
            }
        }
        if (best) {
            var refined = refineLineStart(pixels, y, best.x);
            // 只有偏差明显时才用边界跃变修正，避免正常样本被挪动 1px
            if (refined !== null && Math.abs(refined - best.x) > 2) {
                best.x = refined
            }
        }
        return best
    };

    // 15 点轨迹；c 间隔随机化，总和由调用方指定（约 800~900ms）
    var randomInt = function(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min
    };
    // 按真实手动轨迹的形状构造：整数 a/b、非匀速、末端过冲回拉、最后有 350~550ms 的松手停顿。
    // 真实样本：18~28 个点，a/b 全为整数，最后两个 c 通常很大（288~607ms）。
    var buildTracks = function(moveLength, cSum) {
        var target = Math.max(0, Math.round(Number(moveLength) || 0));
        var count = Math.round(target / 5) + 12;
        if (count < 14) count = 14;
        if (count > 26) count = 26;
        var steps = count - 1;

        // a：慢起、中段快、末端慢，带随机抖动
        var weights = [];
        var wsum = 0;
        for (var i = 1; i <= steps; i++) {
            var p = i / steps;
            var bell = Math.sin(Math.PI * p);
            var w = (0.35 + 0.9 * bell) * (0.65 + Math.random() * 0.7);
            weights.push(w);
            wsum += w
        }
        var aVals = [0];
        var acc = 0;
        for (var i = 0; i < steps; i++) {
            acc += weights[i];
            var v = Math.round(target * acc / wsum);
            if (v < aVals[aVals.length - 1]) {
                v = aVals[aVals.length - 1]
            }
            aVals.push(v)
        }
        aVals[aVals.length - 1] = target;

        // 末端过冲 2~6px，再回到 moveLength（真实样本里很常见）
        if (steps >= 8 && Math.random() < 0.7) {
            var oi = aVals.length - 2 - randomInt(0, 2);
            var over = target + randomInt(2, 6);
            if (aVals[oi] < over) {
                aVals[oi] = over
            }
            for (var j = oi + 1; j < aVals.length - 1; j++) {
                if (aVals[j] < aVals[oi]) {
                    aVals[j] = aVals[oi]
                }
            }
            aVals[aVals.length - 1] = target
        }

        // b：整体小幅上漂，叠加 ±1 抖动；最后回到一个小负值
        var drift = -randomInt(8, 22);
        var bVals = [0];
        for (var i = 1; i < count; i++) {
            var bv;
            if (i === count - 1) {
                bv = drift
            } else {
                bv = Math.round(drift * (aVals[i] / (target || 1))) + randomInt(-1, 1)
            }
            if (bv > 3) bv = 3;
            if (bv < -30) bv = -30;
            bVals.push(bv)
        }

        // c：最后一个间隔是松手停顿，放 350~550ms；倒数第二个 150~300ms
        var lastC = randomInt(350, 550);
        var preC = randomInt(150, 300);
        var earlyCount = Math.max(0, count - 3);
        var total = Math.round(cSum || 1400);
        var available = total - lastC - preC;
        // 原版按 20ms 采样，真实样本最小 c 约 23ms；不要造出 18ms 这种不可能被采到的间隔
        var minEarly = 22;
        if (available < earlyCount * minEarly) {
            total = earlyCount * minEarly + preC + lastC + 40;
            available = total - lastC - preC
        }
        var early = [];
        for (var i = 0; i < earlyCount; i++) {
            early.push(minEarly)
        }
        var left = available - earlyCount * minEarly;
        while (left > 0) {
            var idx = randomInt(0, earlyCount - 1);
            var add = Math.min(left, randomInt(1, 45));
            early[idx] += add;
            left -= add
        }
        var intervals = [0].concat(early, [preC, lastC]);
        var tracks = [];
        for (var i = 0; i < count; i++) {
            tracks.push({
                a: aVals[i],
                b: bVals[i],
                c: intervals[i] || 0
            })
        }
        return tracks
    };

    b.DEFAULTS = {
        width: 280,
        height: 155,
        PI: Math.PI,
        sliderL: 42,
        sliderR: 9,
        offset: 5,
        loadingText: "向右滑动填充拼图",
        failedText: "再试一次",
        barText: "向右滑动填充拼图",
        repeatIcon: "fa fa-repeat",
        closeIcon: "fa fa-close",
        maxLoadCount: 3,
        isRemoveUrl: 1,
        removeUrl: "",
        localImages: function() {
            return "images/Pic" + Math.round(Math.random() * 4) + ".jpg"
        },
        verify: function(j, i, f) {
            // secret 以“当前这张 smallImage 解码出的最后 16 个字符”为准：
            // 站点 openSliderCaptcha 是先换图、再 reset、最后才更新 safeSecure.value，
            // 刷新时存在读不到新 secret 的时序窗口；图片派生值和站点算法完全一致。
            var h = "";
            var secretSource = "";
            var secretFromImage = false;
            var derivedSecret = "";
            if (this._smallImageSrc) {
                try {
                    var smallBase64 = this._smallImageSrc.split(",")[1];
                    derivedSecret = window.atob(smallBase64).slice(-16);
                    if (derivedSecret) {
                        h = derivedSecret;
                        secretSource = "image";
                        secretFromImage = true
                    }
                } catch (err) {
                    console.warn("[sliderCaptcha-auto] 无法从 smallImage 推导 secret", err)
                }
            }
            if (!h && this.safeSecure && this.safeSecure.value) {
                h = this.safeSecure.value;
                secretSource = "options"
            }
            if (!h && typeof window.safeSecure !== "undefined" && window.safeSecure && window.safeSecure.value) {
                h = window.safeSecure.value;
                secretSource = "window"
            }
            if (!h) {
                console.warn("[sliderCaptcha-auto] safeSecure 为空，跳过 verify");
                return false
            }
            var secretInfo = {
                source: secretSource,
                sameAsOptions: !!(this.safeSecure && this.safeSecure.value && h === this.safeSecure.value),
                sameAsWindow: !!(typeof window.safeSecure !== "undefined" && window.safeSecure && window.safeSecure.value && h === window.safeSecure.value)
            };
            window.__lastSliderSecret = secretInfo;
            var g = false;
            var e = {
                canvasLength: j,
                moveLength: i,
                tracks: this._tracks || buildTracks(i)
            };
            var cSum = 0;
            for (var ti = 0; ti < e.tracks.length; ti++) {
                cSum += e.tracks[ti].c || 0
            }
            window.__lastSliderE = e;
            console.log("[sliderCaptcha-auto] 提交验证", {
                canvasLength: j,
                moveLength: i,
                trackCount: e.tracks.length,
                cSum: cSum,
                secretSource: secretInfo.source,
                sameAsOptions: secretInfo.sameAsOptions,
                sameAsWindow: secretInfo.sameAsWindow
            });
            console.log("[capture] sliderCaptcha submit " + JSON.stringify({
                canvasLength: j,
                moveLength: i,
                trackCount: e.tracks.length,
                cSum: cSum,
                secretSource: secretInfo.source,
                sameAsOptions: secretInfo.sameAsOptions,
                sameAsWindow: secretInfo.sameAsWindow
            }));
            d.ajax(contextPath + "/common/verifySliderCaptcha.htl", {
                data: {
                    sign: encryptPassword(JSON.stringify(e), h)
                },
                cache: false,
                dataType: "json",
                type: "POST",
                async: false,
                success: function(k) {
                    window.__lastSliderResponse = k;
                    if (k.errorCode == 1) {
                        g = true;
                        console.log("[sliderCaptcha-auto] verify 通过 errorCode=1", {
                            canvasLength: j,
                            moveLength: i
                        });
                        console.log("[capture] sliderCaptcha result " + JSON.stringify(k));
                        setTimeout(function() {
                            d("#bjGray").hide();
                            d("#captcha-id").hide()
                        }, 1500)
                    } else {
                        console.warn("[sliderCaptcha-auto] verify 未通过", {
                            canvasLength: j,
                            moveLength: i,
                            errorCode: k && k.errorCode,
                            errorMsg: k && k.errorMsg,
                            safeLen: h ? h.length : 0,
                            secretSource: secretInfo.source,
                            sameAsOptions: secretInfo.sameAsOptions,
                            sameAsWindow: secretInfo.sameAsWindow,
                            tracks: e.tracks
                        });
                        console.log("[capture] sliderCaptcha fail " + JSON.stringify({
                            response: k,
                            secret: secretInfo,
                            e: e
                        }))
                    }
                },
                error: function(k, l) {
                    console.warn("sliderCaptcha: verify 请求失败", l, (k.responseText || "").slice(0, 200));
                    console.log("[capture] sliderCaptcha error " + l + " " + (k.responseText || "").slice(0, 200))
                }
            });
            return g
        }
    };

    // 把页面上已经存在的“原版实例”替换成本版本：
    // 直接粘贴脚本时，原版 instance 早已创建，只改 $.fn 不会让它变成自动验证。
    function recreate(f, source) {
        var opts = d.extend({}, source.options);
        // 原版 options.verify 不会使用 _tracks，必须删掉，换回本文件的 DEFAULTS.verify
        delete opts.verify;
        delete opts._tracks;
        delete opts._submitDelay;
        delete opts._smallImageSrc;
        if (f && typeof f === "object") {
            d.extend(opts, f)
        }
        var h = d(source.$element);
        h.removeData("lgb.SliderCaptcha");
        h.empty();
        var g = new b(source.$element, opts);
        h.data("lgb.SliderCaptcha", g);
        console.log("[sliderCaptcha-auto] 已接管原版实例，静默自动验证生效");
        return g
    }
    function c(e) {
        return this.each(function() {
            var h = d(this);
            var g = h.data("lgb.SliderCaptcha");
            var f = typeof e === "object" && e;
            if (g && typeof g.autoVerify !== "function") {
                g = recreate(f, g);
                if (typeof e === "string") {
                    g[e]()
                }
                return
            }
            if (g && !/reset/.test(e)) {
                // 站点每次 openSliderCaptcha 都会重新传入 safeSecure/onSuccess，
                // 已有实例也要同步，否则会一直用第一次的 secret 签名
                if (f) {
                    d.extend(g.options, f)
                }
                return
            }
            if (!g) {
                h.data("lgb.SliderCaptcha", g = new b(this, f))
            }
            if (typeof e === "string") {
                g[e]()
            }
        })
    }
    d.fn.sliderCaptcha = c;
    d.fn.sliderCaptcha.Constructor = b;
    // 脚本是在验证码已经弹出之后才加载的（例如控制台粘贴）：立即接管已有实例
    d(function() {
        d("#sliderDiv").each(function() {
            var h = d(this);
            var g = h.data("lgb.SliderCaptcha");
            if (g && typeof g.autoVerify !== "function") {
                recreate(null, g)
            }
        })
    });
    var a = b.prototype;
    a.init = function() {
        this.initDOM();
        this.hideCaptcha();
        this.initImg();
        this.bindEvents()
    };
    a.hideCaptcha = function() {
        // 用 visibility 隐藏，保留布局和 #sliderDiv.width()；display:none 会让宽度变成 0
        d("#bjGray").css({
            visibility: "hidden",
            pointerEvents: "none"
        });
        d("#captcha-id").css({
            visibility: "hidden",
            pointerEvents: "none"
        });
        // 注意：不要启用 #password。站点在打开滑块前已把它禁用，
        // 启用会让表单多提交一个明文 passwordText，只保留站点写入的加密 password。
    };
    a.initDOM = function() {
        var i = function(r, s) {
            var t = document.createElement(r);
            t.className = s;
            return t
        };
        var n = function(t, r) {
            var s = document.createElement("canvas");
            s.width = t;
            s.height = r;
            return s
        };
        var h = n(this.options.width - 2, this.options.height);
        var k = h.cloneNode(true);
        var o = i("div", "sliderContainer");
        var l = i("i", "refreshIcon " + this.options.repeatIcon);
        var g = i("i", "closeIcon " + this.options.closeIcon);
        var p = i("div", "sliderMask");
        var j = i("div", "sliderbg");
        var e = i("div", "slider");
        var m = i("i", "fa fa-arrow-right sliderIcon");
        var q = i("span", "sliderText text_ellipsis");
        k.className = "block";
        q.innerHTML = this.options.barText;
        var f = this.$element;
        f.append(d(h));
        f.append(d(l));
        f.append(d(g));
        f.append(d(k));
        e.appendChild(m);
        p.appendChild(e);
        o.appendChild(j);
        o.appendChild(p);
        o.appendChild(q);
        f.append(d(o));
        if (typeof Object.assign != "function") {
            Object.assign = function(u) {
                if (u == null) {
                    throw new TypeError("Cannot convert undefined or null to object")
                }
                u = Object(u);
                for (var r = 1; r < arguments.length; r++) {
                    var t = arguments[r];
                    if (t != null) {
                        for (var s in t) {
                            if (Object.prototype.hasOwnProperty.call(t, s)) {
                                u[s] = t[s]
                            }
                        }
                    }
                }
                return u
            }
        }
        Object.assign(this, {
            canvas: h,
            block: k,
            sliderContainer: d(o),
            refreshIcon: l,
            closeIcon: g,
            slider: e,
            sliderMask: p,
            sliderIcon: m,
            text: d(q),
            canvasCtx: h.getContext("2d"),
            blockCtx: k.getContext("2d")
        })
    };
    a.initImg = function() {
        var i = this;
        var f = new Image();
        var k = new Image();
        f.crossOrigin = "Anonymous";
        k.crossOrigin = "Anonymous";
        var h = 0;
        var loaded = {
            background: false,
            piece: false
        };
        var drawBlock = function() {
            if (!f.naturalWidth || !k.naturalWidth) {
                return
            }
            var m = i.options.width / f.naturalWidth;
            var l = k.naturalWidth * m;
            i.blockCtx.clearRect(0, 0, i.options.width, i.options.height);
            i.blockCtx.drawImage(k, 0, 0, l - 2, i.options.height)
        };
        var tryAutoVerify = function() {
            if (!loaded.background || !loaded.piece) {
                return
            }
            // 同一对图片 + 同一个 safeSecure 只验证一次
            var secure = i.options.safeSecure && i.options.safeSecure.value ? i.options.safeSecure.value : "";
            var signature = f.src + "|" + k.src + "|" + secure;
            if (i.solvedSignature === signature) {
                return
            }
            i.solvedSignature = signature;
            // 两张图都加载完成后，用拼图白线定位背景中的同一条线并提交
            i.autoVerify(f, k)
        };
        f.onload = function() {
            loaded.background = true;
            i.canvasCtx.drawImage(f, 0, 0, i.options.width - 2, i.options.height);
            drawBlock();
            i.text.text(i.text.attr("data-text"));
            tryAutoVerify()
        };
        f.onerror = function() {
            h++;
            if (window.location.protocol === "file:") {
                h = i.options.maxLoadCount;
                console.error("can't load pic resource file from File protocal. Please try http or https")
            }
            if (h >= i.options.maxLoadCount) {
                i.text.text("加载失败").addClass("text-danger");
                return
            }
            f.src = i.options.localImages()
        };
        f.setSrc = function() {
            var m = d("#slider-img1")[0].src;
            var l = d("#slider-img2")[0].src;
            h = 0;
            loaded.background = false;
            loaded.piece = false;
            i.text.removeClass("text-danger");
            f.src = m;
            k.src = l
        };
        k.onload = function() {
            loaded.piece = true;
            drawBlock();
            tryAutoVerify()
        };
        k.onerror = function() {
            i.fail()
        };
        f.setSrc();
        this.text.attr("data-text", this.options.barText);
        this.text.text(this.options.loadingText);
        this.img = f
    };
    a.autoVerify = function(background, piece) {
        var i = this;
        this.verifyToken = (this.verifyToken || 0) + 1;
        var token = this.verifyToken;
        this.hideCaptcha();
        var border = findPieceBottomRow(piece);
        if (!border) {
            console.warn("sliderCaptcha: 未找到 #slider-img2 的拼图底边白线行");
            this.fail();
            return
        }
        var best = findBackgroundLine(background, border);
        if (!best) {
            console.warn("sliderCaptcha: #slider-img1 中未找到对应的白线");
            this.fail();
            return
        }
        // 与原始 release 一致：canvasLength = $("#sliderDiv").width()
        var canvasLength = d("#sliderDiv").width();
        var backgroundWidth = background.naturalWidth || background.width;
        // 已验证方案：原图坐标按比例映射到 canvasLength，再 -1
        var moveLength = Math.round(best.x / backgroundWidth * canvasLength) - 1;
        if (moveLength < 0) {
            moveLength = 0
        }
        // 每次随机 c 总和和提交延迟，避免固定节奏；总时长贴近真实手动拖动（1.5~1.9s）
        var trackSum = randomInt(1250, 1650);
        var tracksForVerify = buildTracks(moveLength, trackSum);
        var actualTrackSum = 0;
        for (var ti = 0; ti < tracksForVerify.length; ti++) {
            actualTrackSum += tracksForVerify[ti].c || 0
        }
        // 等待必须明显超过 c 总和：实测 486ms 余量可通过，160~260ms 出现过 0。
        // 300~450ms 仍小于已验证的 486ms 上限。
        var submitDelay = actualTrackSum + randomInt(300, 450);
        this.options._tracks = tracksForVerify;
        this.options._submitDelay = submitDelay;
        this._moveDebug = {
            canvasLength: canvasLength,
            backgroundWidth: backgroundWidth,
            lineX: best.x,
            moveLength: moveLength,
            trackSum: actualTrackSum,
            submitDelay: submitDelay
        };
        console.log("[sliderCaptcha-auto] 检测完成", this._moveDebug);
        console.log("[capture] sliderCaptcha detect " + JSON.stringify(this._moveDebug));
        // 留档本次检测所用图片，失败时可离线复算，确认是不是检测坐标的问题
        window.__lastSliderImages = {
            background: background.src,
            piece: piece.src
        };
        this.x = moveLength;
        this.moveLength = moveLength;
        this.block.style.left = moveLength + "px";
        this.slider.style.left = (moveLength - 1) + "px";
        this.sliderMask.style.width = (moveLength + 4) + "px";
        this.sliderContainer.addClass("sliderContainer_active");
        var submit = function() {
            if (token !== i.verifyToken) {
                return
            }
            var domBackground = d("#slider-img1")[0] ? d("#slider-img1")[0].src : "";
            var domPiece = d("#slider-img2")[0] ? d("#slider-img2")[0].src : "";
            // DOM 已经换成新 captcha 时，作废这次结果并按新图重来
            if ((domBackground && background.src !== domBackground) ||
                (domPiece && piece.src !== domPiece)) {
                i.reset();
                return
            }
            // 用本次检测所用的 smallImage 现算 secret，避免拿旧的 safeSecure 对象
            i.options._smallImageSrc = piece.src;
            // 不传真实轨迹，tracks 在 DEFAULTS.verify 内按 moveLength 构造
            var result = i.verify(canvasLength, moveLength);
            if (result.spliced && result.verified) {
                i.markVerified()
            } else {
                console.warn("sliderCaptcha: 坐标对比", i._moveDebug);
                i.fail()
            }
        };
        var afterCredentials = function() {
            if (token !== i.verifyToken) {
                return
            }
            var username = d("#username");
            var password = d("#password");
            // 页面上有账号密码框时，等它们填好后再 verify
            if (username.length && password.length && (!username.val() || !password.val())) {
                setTimeout(afterCredentials, 100);
                return
            }
            // 随机等待：比本次 tracks 的 c 总和多 160~260ms
            setTimeout(submit, i.options._submitDelay || 1037)
        };
        afterCredentials()
    };
    a.success = function() {
        this.sliderContainer.removeClass("sliderContainer_active");
        this.sliderContainer.addClass("sliderContainer_success");
        this.callOnSuccess()
    };
    a.callOnSuccess = function() {
        if (d.isFunction(this.options.onSuccess)) {
            this.options.onSuccess.call(this.$element)
        }
    };
    a.markVerified = function() {
        var i = this;
        var token = this.verifyToken;
        this.sliderContainer.removeClass("sliderContainer_active");
        this.sliderContainer.addClass("sliderContainer_success");
        var check = function() {
            // 期间如果换了新验证码，旧等待作废
            if (token !== i.verifyToken) {
                return
            }
            // 有账号密码框时，确认两者仍有值后再调用 onSuccess 提交登录表单
            if (!d("#username").length || !d("#password").length ||
                (d("#username").val() && d("#password").val())) {
                i.callOnSuccess();
                return
            }
            setTimeout(check, 100)
        };
        check()
    };
    a.fail = function() {
        var i = this;
        this.verifyToken = (this.verifyToken || 0) + 1;
        this.sliderContainer.removeClass("sliderContainer_active");
        this.sliderContainer.addClass("sliderContainer_fail");
        if (d.isFunction(this.options.onFail)) {
            this.options.onFail.call(this.$element)
        }
        // 判定失败后走原有自动刷新通道，重新取图后再检测
        setTimeout(function() {
            i.text.text(i.options.failedText);
            openSliderCaptcha();
            i.reset()
        }, 1000)
    };
    a.clean = function() {
        this.canvasCtx.clearRect(0, 0, this.options.width, this.options.height);
        this.blockCtx.clearRect(0, 0, this.options.width, this.options.height);
        this.block.width = this.options.width
    };
    a.bindEvents = function() {
        var i = this;
        this.$element.on("selectstart", function() {
            return false
        });
        d(this.refreshIcon).on("click", function() {
            i.reset();
            openSliderCaptcha()
        });
        d(this.closeIcon).on("click", function() {
            i.reset();
            d("#password").removeAttr("disabled");
            d("#bjGray").hide();
            d("#captcha-id").hide()
        })
    };
    a.verify = function(n, o, g) {
        var i = false;
        var f = false;
        if (this.options.isRemoveUrl == 1) {
            i = this.options.verify(n, o, g);
            f = i
        } else {
            var h = parseInt(this.block.style.left);
            i = f = Math.abs(h - this.x) < this.options.offset
        }
        return {
            spliced: i,
            verified: f
        }
    };
    a.reset = function() {
        this.verifyToken = (this.verifyToken || 0) + 1;
        // reset 后允许同一对图片（src 相同）重新走一次检测，
        // 避免刷新失败但图片未变化时被 solvedSignature 去重卡死
        this.solvedSignature = null;
        this.hideCaptcha();
        this.sliderContainer.removeClass("sliderContainer_fail sliderContainer_success");
        this.slider.style.left = 0;
        this.block.style.left = 0;
        this.sliderMask.style.width = 0;
        this.clean();
        this.text.attr("data-text", this.text.text());
        this.text.text(this.options.loadingText);
        this.img.setSrc()
    }
})(jQuery);
