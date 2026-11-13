// PositionTracker.js
// Injected into WKWebView to track and restore reading position
// Position is stored as xpath + scrollY for accurate same-device restore

(function() {
    'use strict';
    function jsLog(msg) {
        if (window.webkit && window.webkit.messageHandlers.jsLog) {
            window.webkit.messageHandlers.jsLog.postMessage(msg);
        }
    }
    // --- Language detection from content ---

    // Asked on every apply for a book with no `lang` — and `textContent`
    // builds the WHOLE book as one string to keep its first 2000
    // characters (CR #1115): once per step of a slider. The first text
    // nodes are walked to that length instead, and the answer is kept:
    // the page's text does not change under one load.
    var _detectedLanguage = null;

    function detectLanguage() {
        if (_detectedLanguage !== null) return _detectedLanguage;
        var text = '';
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        var textNode;
        while (text.length < 2000 && (textNode = walker.nextNode())) {
            text += textNode.nodeValue;
        }
        text = text.substring(0, 2000);
        var language = languageOf(text);
        // An empty page (not laid in yet, or pictures alone) decides nothing.
        if (text.length > 0) _detectedLanguage = language;
        return language;
    }

    function languageOf(text) {
        var cyrillic = 0, latin = 0, cjk = 0, arabic = 0, greek = 0, kana = 0, hangul = 0;
        for (var i = 0; i < text.length; i++) {
            var c = text.charCodeAt(i);
            if (c >= 0x0400 && c <= 0x04FF) cyrillic++;
            else if ((c >= 0x0041 && c <= 0x005A) || (c >= 0x0061 && c <= 0x007A) || (c >= 0x00C0 && c <= 0x024F)) latin++;
            else if (c >= 0x4E00 && c <= 0x9FFF) cjk++;
            else if (c >= 0x3040 && c <= 0x30FF) kana++;
            else if (c >= 0xAC00 && c <= 0xD7AF) hangul++;
            else if (c >= 0x0600 && c <= 0x06FF) arabic++;
            else if (c >= 0x0370 && c <= 0x03FF) greek++;
        }
        // Japanese writes its kanji among kana (#1019), Korean its
        // occasional hanja among hangul: the kana or the hangul decide.
        var east = cjk + kana + hangul;
        var max = Math.max(cyrillic, latin, east, arabic, greek);
        if (max === 0) return 'en';
        if (max === cyrillic) return 'ru';
        if (max === east) return kana > east * 0.1 ? 'ja' : (hangul > cjk ? 'ko' : 'zh');
        if (max === arabic) return 'ar';
        if (max === greek) return 'el';
        return 'en';
    }

    // --- XPath utilities ---

    function getXPath(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            node = node.parentNode;
        }
        if (!node || node === document.body) return '/html/body';

        const parts = [];
        let current = node;

        while (current && current !== document.body) {
            let index = 1;
            let sibling = current.previousSibling;
            while (sibling) {
                if (sibling.nodeType === Node.ELEMENT_NODE &&
                    sibling.tagName === current.tagName) {
                    index++;
                }
                sibling = sibling.previousSibling;
            }
            parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
            current = current.parentNode;
        }

        return '/html/body/' + parts.join('/');
    }

    function getNodeByXPath(xpath) {
        try {
            const result = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );
            return result.singleNodeValue;
        } catch (e) {
            return null;
        }
    }

    // --- Position detection ---

    // True when a caret-probe hit is part of our fixed chrome (Norton frame,
    // page separator, clocks) rather than book text — those must never become
    // a position anchor.
    function isInFixedChrome(node) {
        var el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        var depth = 0;
        while (el && depth < 8) {
            if (el.id && el.id.indexOf('_cr_') === 0) return true;
            var pos = window.getComputedStyle(el).position;
            if (pos === 'fixed') return true;
            el = el.parentElement;
            depth++;
        }
        return false;
    }

    // O(1) probe for the first visible text node via caretRangeFromPoint —
    // the TreeWalker below scans EVERY text node from the start of the
    // document on every position report (~2×/s while scrolling), which is
    // O(reading depth): tens of thousands of range/rect queries near the end
    // of a big book (#180). Returns null when no probe lands on real text;
    // callers fall back to the exact walker, so this is strictly a fast path.
    function getFirstVisibleTextNodeFast() {
        if (!document.caretRangeFromPoint) return null;
        var xs = [Math.floor(window.innerWidth * 0.5), 24, Math.floor(window.innerWidth * 0.8)];
        for (var yFrac = 0.03; yFrac <= 0.3; yFrac += 0.07) {
            var y = Math.floor(window.innerHeight * yFrac);
            for (var i = 0; i < xs.length; i++) {
                var r = document.caretRangeFromPoint(xs[i], y);
                if (!r || !r.startContainer) continue;
                var n = r.startContainer;
                if (n.nodeType !== Node.TEXT_NODE || !n.textContent.trim()) continue;
                if (isInFixedChrome(n)) continue;
                return n;
            }
        }
        return null;
    }

    function getFirstVisibleTextNode() {
        var fast = getFirstVisibleTextNodeFast();
        if (fast) return fast;

        const viewportTop = window.scrollY;
        const viewportBottom = viewportTop + window.innerHeight * 0.3;

        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    const text = node.textContent.trim();
                    if (!text) return NodeFilter.FILTER_SKIP;
                    const range = document.createRange();
                    range.selectNode(node);
                    const rect = range.getBoundingClientRect();
                    const absTop = rect.top + window.scrollY;
                    if (absTop >= viewportTop && absTop <= viewportBottom) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_SKIP;
                }
            }
        );

        return walker.nextNode();
    }

    function getCurrentPosition() {
        if (isPaged()) {
            computeTotalPages();
            var page = getCurrentPage();
            var progress = wholeBookOnScreen(true) ? 1 : totalPages > 1 ? page / (totalPages - 1) : 0;
            var textNode = getFirstVisibleTextNodePaged();
            var xpath = textNode ? getXPath(textNode.parentNode) : '/html/body';
            return {
                xpath: xpath,
                charOffset: 0,
                scrollY: document.documentElement.scrollLeft,
                progress: Math.min(1.0, Math.max(0.0, progress))
            };
        }
        var scrollHeight = document.body.scrollHeight;
        var total = scrollHeight - window.innerHeight;
        var progress = wholeBookOnScreen(false) ? 1 : total > 0 ? window.scrollY / total : 0;
        var textNode = getFirstVisibleTextNode();

        var xpath = textNode
            ? getXPath(textNode.parentNode)
            : '/html/body';

        return {
            xpath: xpath,
            charOffset: 0,
            scrollY: window.scrollY,
            progress: Math.min(1.0, Math.max(0.0, progress)),
            // The node the path names and the height read for it — so the
            // reporter need not look either up again (#852).
            node: textNode ? textNode.parentNode : null,
            scrollHeight: scrollHeight
        };
    }

    // --- Position restore ---

    function restorePosition(xpath, charOffset, scrollY, progress) {
        isInitialRestorePending = true;
        jsLog('restorePosition: ' + scrollY + ' progress: ' + progress)

        if (xpath && xpath !== '/html/body') {
            lastKnownXpath = xpath;
        }
        if (progress > 0) {
            lastKnownProgress = progress;
        }

        // Store saved values for applySettings to use on initial load.
        // applySettings always runs right after onLoaded and will call
        // restorePositionPaged() for paged mode with these saved values.
        _initialRestoreXpath = xpath;
        _initialRestoreProgress = progress || 0;
        _initialRestoreScrollY = scrollY || 0;

        if (isPaged()) {
            // Paged mode already active (unusual) — restore now
            let attempts = 0;
            let lastWidth = 0;
            function tryRestorePaged() {
                var currentWidth = document.body.scrollWidth;
                if (currentWidth === lastWidth || attempts >= 15) {
                    computeTotalPages();
                    restorePositionPaged(xpath, progress || 0);
                    setTimeout(function() {
                        postInitialRestored(document.documentElement.scrollLeft);
                    }, 50);
                } else {
                    lastWidth = currentWidth;
                    attempts++;
                    setTimeout(tryRestorePaged, 100);
                }
            }
            setTimeout(tryRestorePaged, 50);
            return;
        }

        if (scrollY <= 0) {
            if (xpath && xpath !== '/html/body') {
                const node = getNodeByXPath(xpath);
                if (node) node.scrollIntoView({ behavior: 'instant', block: 'start' });
            }
            setTimeout(function() {
                postInitialRestored(window.scrollY);
            }, 50);
            return;
        }

        // Wait for layout to stabilize, then scroll
        let attempts = 0;
        let lastHeight = 0;

        function tryRestore() {
            const currentHeight = document.body.scrollHeight;
            if (currentHeight === lastHeight || attempts >= 15) {
                // Geometry-aware restore (#180): the absolute pixel offset is
                // only valid for the geometry it was saved under. If the saved
                // xpath element would NOT be inside the viewport that scrollY
                // shows (window resized, moved to another display, resolution
                // change, iPad rotated between sessions, font applied
                // elsewhere), anchor on the ELEMENT instead — raw pixels land
                // on the wrong text. A same-geometry reopen keeps the exact
                // pixel offset as before.
                var target = scrollY;
                if (xpath && xpath !== '/html/body') {
                    var anchorNode = getNodeByXPath(xpath);
                    if (anchorNode && anchorNode.getBoundingClientRect) {
                        var ar = anchorNode.getBoundingClientRect();
                        var elTop = ar.top + window.scrollY;
                        var elBottom = elTop + ar.height;
                        var inViewport = elBottom > scrollY && elTop < scrollY + window.innerHeight;
                        if (!inViewport) {
                            target = Math.max(0, elTop);
                        }
                    }
                }
                document.documentElement.scrollTop = target;
                document.body.scrollTop = target;

                // Compute element fraction for accurate resize restore
                if (xpath && xpath !== '/html/body') {
                    var xpNode = getNodeByXPath(xpath);
                    if (xpNode) {
                        var xpRect = xpNode.getBoundingClientRect();
                        var xpH = xpRect.height;
                        lastKnownElementFraction = xpH > 0 ? Math.max(0, -xpRect.top) / xpH : 0;
                    }
                }
                lastSavedScrollY = window.scrollY;

                setTimeout(function() {
                    postInitialRestored(window.scrollY);
                }, 50);
            } else {
                lastHeight = currentHeight;
                attempts++;
                setTimeout(tryRestore, 100);
            }
        }

        // First attempt after short delay
        setTimeout(tryRestore, 50);
    }

    // --- Paging mode ---

    let pagingMode = 'scroll'; // 'scroll' | 'page'
    // How many columns a turned page shows (#864). `pagingColumnsWanted`
    // is what the reader asked for — 'auto' or 1..4 — and `pagingColumns`
    // is what the page settled on against its own width, in
    // resolvePagingColumns. 'twoPage' used to be a third MODE; it is
    // Pages with two columns now, and the reader never sends the word.
    let pagingColumnsWanted = '2';
    let pagingColumns = 1;
    // The rules for the count (#864): the narrowest a column may be — a
    // line's worth of average characters in the page's own font (user,
    // 2026-09-16), see `resolvePagingColumns` — and whether more than one
    // needs a landscape page: the iPad's spread was always landscape-only
    // (#3), the Mac never gated its columns.
    let columnsMinChars = 24;
    let columnsNeedLandscape = false;
    let currentPage = 0;
    let totalPages = 1;
    let pageTransition = true; // animated slide transition
    // Page turn: Flip (#879) — the reader turns the leaf over the page
    // from two snapshots; the page only scrolls, instantly, when asked.
    var pageFlip = false;
    // The carriage turn (#880): the Typewriter's own — the reader slides
    // the spread up and out and the next one in from below, on a spring,
    // from the same two snapshots. A theme trait sent with the settings.
    var pageCarriage = false;
    // Page turn: Cards (#885) — every column a card revolving about its
    // own axis, the new text on the back; two columns and up.
    var pageCards = false;
    // Page turn: Sink (#886) — the old page sinks into the paper, the new
    // one lands on it from the side; any columns.
    var pageSink = false;
    // The Terminal's own turn (#881): the old page's letters crumble out
    // of their cells and fall, the new page under them. A theme trait,
    // like the carriage.
    var pageCrumble = false;
    // The phone (#890): its one column in portrait is a card too.
    var phoneDevice = false;
    let pageSeparatorMode = 'line'; // 'none' | 'line' | 'shadow' | 'gap' | ... — the first gutter's
    // The other gutters' separator (#864, user): the reading line stands
    // in the first gutter, once; the rest take this.
    let pageSeparatorRestMode = 'line';
    // How far the separator's top rule sits below the page's edge: the
    // shut top dock's strip is lifted into the titlebar and its foot
    // reaches a few points below it (user, 2026-09-02) — but only while
    // that strip is there. With no top dock at all the rule runs along
    // the edge, level with the side docks (user: "an ugly step"). The
    // reader sets it; 0 until it does.
    var topRulePad = 0;
    // Quiet (#887): the top rule is chrome — the line under the title
    // goes with the title. Opacity, like the reader's own fades, so it
    // comes back where it was.
    var quietChrome = false;
    /// #837 — selection mode. While it is on, the page stops fighting the
    /// finger: no swallowed touchmove, no swipe page-turns, no tap zones.
    /// iOS then behaves as it does anywhere else — long press, drag the
    /// handles — which is all the reader wanted in the first place.
    let selectionMode = false;
    /// A strip at the top the PAGE must not answer for (#837): the app
    /// draws its own zone there — selection mode — and a tap that reached
    /// both turned a page as well, which is why the zone felt like it
    /// worked "sometimes, and only in the middle".
    let topReservedZone = 0;
    let pageTapZone = 'horizontal'; // 'horizontal' | 'vertical'
    let invertTapZones = false;     // mirror page-turn zones (left↔right / top↔bottom)
    let scrollAnimation = true;     // smooth-scroll up/down arrow line stepping (#53)
    let nativeLineKeys = false;     // Mac: WebKit scrolls ↑/↓ itself (#860)
    let lastAppliedSettings = null; // cached for paged layout recalculation

    // The settings that only say how the page answers a tap or a key:
    // read when the event comes, with nothing to lay out or paint.
    var _behaviourKeys = { invertTapZones: 1, pageTapZone: 1, scrollAnimation: 1, nativeLineKeys: 1, pageTransition: 1 };

    // True when `after` differs from `before` and only in those.
    function behaviourAloneChanged(before, after) {
        if (!before || !after) return false;
        var own = Object.prototype.hasOwnProperty;
        var changed = false, key;
        for (key in after) {
            if (!own.call(after, key)) continue;
            if (JSON.stringify(after[key]) === JSON.stringify(before[key])) continue;
            if (!_behaviourKeys[key]) return false;
            changed = true;
        }
        for (key in before) {
            if (own.call(before, key) && !own.call(after, key)) return false;
        }
        return changed;
    }

    function isPaged() {
        return pagingMode === 'page';
    }

    /// The column count for the page's current width (#864): the ceiling
    /// asked for, capped by what the width can hold at `columnsMinWidth()`
    /// a column (and by landscape where the platform asks for it) — so a
    /// narrow window never shows four columns of six words. Under the
    /// Norton frame the body padding is held at a floor first: the boxes
    /// split the width in equal shares with a rim each, and the columns
    /// line up with them only while the gap between columns is twice the
    /// padding (`colGap = 2·pad` — see applyPagingCSS), which the 40px
    /// gap floor breaks below 20 of padding.
    /// The most columns the current width could hold — told to the
    /// reader beside the count, so the settings can say "up to 3 here".
    var pagingCapacity = 1;

    /// The narrowest column: `columnsMinChars` average characters of the
    /// book's own text in the page's own font (user, 2026-09-16: "the
    /// count should follow the font size too — three would fit here, and
    /// only two are allowed"). A floor in pixels was two columns of a
    /// small face and three of a big one told apart by nothing; a line's
    /// worth of characters is the same line at every size. Measured, not
    /// guessed: a sample of the book on a canvas in the body's font, so
    /// Cyrillic and a wide face count for what they are. The sample is
    /// the page's for as long as the page lives; the font is read every
    /// time, since the font is what changes.
    var _charSample = null;
    var _measureCanvas = null;
    function averageCharWidth() {
        var cs = getComputedStyle(document.body);
        var fs = parseFloat(cs.fontSize) || 18;
        var sample = _charSample;
        if (sample === null) {
            var text = '';
            var ps = document.body.querySelectorAll('p');
            for (var i = 0; i < ps.length && text.length < 600; i++) text += ' ' + ps[i].textContent;
            text = text.replace(/\s+/g, ' ').trim().slice(0, 600);
            // Kept only once the book's own text is there; a pangram
            // stands in until then.
            if (text.length >= 40) _charSample = sample = text;
            else sample = 'The quick brown fox jumps over the lazy dog. Съешь же ещё этих мягких французских булок, да выпей чаю.';
        }
        if (!_measureCanvas) _measureCanvas = document.createElement('canvas');
        var ctx = _measureCanvas.getContext('2d');
        if (!ctx) return fs * 0.5;
        ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + fs + 'px ' + cs.fontFamily;
        var w = ctx.measureText(sample).width;
        return w > 0 ? w / sample.length : fs * 0.5;
    }

    function columnsMinWidth() {
        // Never under 180 whatever the face: below that a column is a
        // ribbon, not a page.
        return Math.max(180, Math.round(columnsMinChars * averageCharWidth()));
    }

    /// Comfort (#915): the reader chose a face and a size; the margins
    /// are the page's to settle — `{ marginShare, gutterEm, verticalEm, stripBalance }`
    /// from Swift, resolved here against the page's own width on every
    /// settings pass and every resize. The text takes the window (user,
    /// 2026-09-18): the margin is a share of the width, never under the
    /// gutter. Null outside Comfort, and then the reader's padding stands
    /// as given.
    var _comfort = null;
    /// Comfort's strip over the foot of the page, in px (#1041) — 0 where
    /// the page has a bar of its own below it.
    var _comfortStrip = 0;
    /// A book of pictures (#945): `{ rtl, strip, firstAlone }` from the
    /// settings, null for a text book. Paged, a page a column, spreads of
    /// two; right to left when `rtl` — the columns run right to left and
    /// the page index maps onto the scroll the other way round
    /// (`pageToX` / `xToPage`), so the DOM, the xpaths and the engine's
    /// idea of "next" never change, only where a page stands.
    var _pages = null;
    /// The side padding Comfort settled on, in px — reported to the reader
    /// so its strip can stand on the text column.
    var _comfortPad = 0;
    function comfortPadding(paged, wanted) {
        var c = _comfort;
        var cs = getComputedStyle(document.body);
        var fs = parseFloat(cs.fontSize) || 18;
        var W = window.innerWidth;
        var gutter = Math.round(c.gutterEm * fs);
        var N = paged ? Math.max(1, parseInt(wanted, 10) || 1) : 1;
        if (N > 1 && columnsNeedLandscape && W <= window.innerHeight) N = 1;
        var pad;
        if (N === 2) {
            // A spread: the outer margin, which the centre repeats twice
            // (user, 2026-09-18). A share of the width, not of the face:
            // a big face had the margins grow with it (user).
            pad = Math.max(Math.round(2 * fs), Math.round(W * 0.035));
        } else if (N > 2) {
            // Columns cut the margins (user): the gap between columns
            // and the same at the edges — the paging pass takes the gap
            // AS the pad past two columns, so an outer margin is twice a
            // column's inner one.
            pad = Math.max(Math.round(2 * fs), Math.round(W * 0.025));
        } else {
            pad = Math.max(gutter, Math.round(W * c.marginShare));
        }
        // Never past a third of the width: a tiny window keeps its text.
        pad = Math.min(pad, Math.round(W / 3));
        _comfortPad = pad;
        return pad;
    }
    /// Comfort's vertical clearance, in px: `verticalEm` of the face,
    /// never under 10 — the titlebar and the strip are clearance too, and
    /// the column's whole-line rounding adds up to a line of its own.
    function comfortTopPad() {
        if (!_comfort) return 0;
        var cs = getComputedStyle(document.body);
        var fs = parseFloat(cs.fontSize) || 18;
        return Math.max(10, Math.round(_comfort.verticalEm * fs));
    }

    function resolvePagingColumns(contentArea, pad) {
        // The gap the paging pass will use (#915): Comfort's columns
        // past two take the pad as the gap, and a capacity counted with
        // twice that gap said "two" where three fit.
        var wantedN = parseInt(pagingColumnsWanted, 10) || 2;
        var gap = _comfort && wantedN > 2 ? Math.max(40, pad) : Math.max(40, 2 * pad);
        var cap = Math.max(1, Math.floor((contentArea + gap) / (columnsMinWidth() + gap)));
        if (columnsNeedLandscape && window.innerWidth <= window.innerHeight) cap = 1;
        cap = Math.min(4, cap);
        pagingCapacity = cap;
        var wanted = parseInt(pagingColumnsWanted, 10);
        if (!(wanted >= 1)) wanted = 2;
        return Math.max(1, Math.min(cap, wanted));
    }

    /// Tell the reader what the page settled on (#864) — the read-out
    /// counts pages by it, the reading line stands in a gutter only when
    /// there are two. Sent on change only.
    var _reportedColumns = 0;
    var _reportedCapacity = 0;
    function reportPagingColumns() {
        var n = isPaged() ? pagingColumns : 1;
        var cap = isPaged() ? pagingCapacity : 0;
        if (n === _reportedColumns && cap === _reportedCapacity) return;
        _reportedColumns = n;
        _reportedCapacity = cap;
        postPageLayout();
    }

    /// Cached per-pair scroll pitch for paged mode. Recomputed by
    /// applyPagingCSS based on body padding, colWidth, and colGap (the
    /// actual values the browser will lay out, accounting for the fact
    /// that CSS multi-column auto-balances columns within body's
    /// content-area). For two-page mode with a non-zero body padding,
    /// pitch is NOT simply innerWidth — it's the literal distance between
    /// the start of one pair and the start of the next.
    var _pagePitch = 0;

    /// Viewport size the paged CSS was last computed for (#272). iPadOS
    /// re-lays-out the scene at other sizes for app-switcher snapshots
    /// while backgrounding; those resizes race web-process suspension, so
    /// applyPagingCSS could last run at a snapshot width and never re-run
    /// at the real one — visible as four narrow columns on return. The
    /// stamp lets healPagedLayoutIfStale() detect and repair that state.
    var _appliedPagingW = 0;
    var _appliedPagingH = 0;

    /// True when a resize arrived while the document was hidden (#272) —
    /// the layout on file is then a snapshot-pass layout, and the first
    /// live frames after resume can show it scaled to the real window
    /// ("huge text for a moment"). The body is hidden from the first such
    /// resize until the visibility-return pass has re-asserted the layout.
    var _hiddenResizeSeen = false;

    /// Active Norton-frame insets — set by `applyNortonFrame` after it
    /// computes its `ti` (top) and `bt` (bottom) values. Read by both
    /// the scroll-mode body-padding line in `applyNortonFrame` itself
    /// AND by `applyPagingCSS` so paged columns sit inside the frame
    /// instead of poking out the top/bottom. Both reset to 0 when
    /// Norton is inactive so non-Norton paged math keeps its own
    /// (smaller) defaults.
    var _nortonTopInset = 0;
    var _nortonBottomInset = 0;

    // A text book that reads right to left (#1094) — see nativeRTLText.
    var _textRTL = false;

    function getPageWidth() {
        if (isPaged() && _pagePitch > 0) return _pagePitch;
        return window.innerWidth;
    }

    /// The book reads right to left — a book of pictures by its layout
    /// (#945), a text book by its own flag (#1094). What every INPUT asks:
    /// which side is forward.
    function pagesRTL() {
        return (!!(_pages && _pages.rtl) || nativeRTLText()) && isPaged();
    }

    /// A text book that reads right to left (#1094). Its html runs rtl, so
    /// the columns go leftward and the horizontal scroll is WebKit's rtl
    /// scroll: 0 at the start, negative after it — page k at −k·pitch. A
    /// book of pictures does it the other way (its slots reversed in an
    /// ltr body), which text cannot: the words are in reading order.
    function nativeRTLText() {
        return _textRTL && !_pages;
    }
    function nativeRTL() { return nativeRTLText() && isPaged(); }

    /// Where page `page` stands in the scroll (#945): rightmost first in
    /// an rtl book, so the engine's page 0 is the far right of the body.
    function pageToX(page) {
        var w = getPageWidth();
        if (nativeRTL()) return -page * w;
        if (!pagesRTL()) return page * w;
        computeTotalPages();
        return Math.max(0, (totalPages - 1 - page) * w);
    }

    function xToPage(x) {
        var w = getPageWidth();
        if (w <= 0) return 0;
        if (nativeRTL()) return Math.max(0, Math.round(-x / w));
        var p = Math.round(x / w);
        if (!pagesRTL()) return p;
        computeTotalPages();
        return Math.max(0, totalPages - 1 - p);
    }

    /// The page a document x falls in (a rect's left edge).
    function xToPageFloor(x) {
        var w = getPageWidth();
        if (w <= 0) return 0;
        // A left edge in an rtl text book: page k holds −k·w + (0, w].
        if (nativeRTL()) return Math.max(0, Math.ceil(-x / w - 0.001));
        var p = Math.floor(x / w);
        if (!pagesRTL()) return p;
        computeTotalPages();
        return totalPages - 1 - p;
    }

    /// A rect's START as a logical document x (#1094): from the start of
    /// the book, growing as one reads — the left edge of an ltr book, the
    /// right edge measured from the right in an rtl one. `sx` is the
    /// scroll the rect was measured at (the live one by default).
    function rectStartX(r, sx) {
        if (sx === undefined) sx = document.documentElement.scrollLeft;
        if (nativeRTL()) return window.innerWidth - (r.right + sx);
        return r.left + sx;
    }

    /// The page a rect starts on — the reading start, so a box broken
    /// across columns counts where it begins in either direction.
    function rectPage(r, sx) {
        if (sx === undefined) sx = document.documentElement.scrollLeft;
        if (nativeRTL()) {
            var w = getPageWidth();
            return w > 0 ? Math.max(0, Math.floor(rectStartX(r, sx) / w)) : 0;
        }
        return xToPageFloor(r.left + sx);
    }

    function computeTotalPages() {
        if (!isPaged()) { totalPages = 1; return; }
        totalPages = pagesForScrollWidth(document.body.scrollWidth);
    }

    /// The spreads a paged body of this width holds. Spread k stands at
    /// k·pitch and needs the whole window after it, so a body ending at
    /// k·pitch + innerWidth holds k + 1. That is not ceil(width / pitch)
    /// where the pitch is shorter than the window: in Comfort's three and
    /// four columns the gap is the pad, the pitch is the window less one
    /// pad, and the old count found a spread that was not there. The
    /// sentinel then built it (#1042, user: one spread of text, and a
    /// turn to a page holding only the last column's tail). 2 px of slack
    /// for the rounding.
    function pagesForScrollWidth(scrollW) {
        var pitch = getPageWidth();
        if (pitch <= 0) return 1;
        return Math.max(1, 1 + Math.ceil((scrollW - window.innerWidth - 2) / pitch));
    }

    function getCurrentPage() {
        if (!isPaged()) return 0;
        var colW = getPageWidth();
        if (colW <= 0) return 0;
        return xToPage(document.documentElement.scrollLeft);
    }

    /// Self-heal for a paged layout computed at a stale viewport size
    /// (#272): app-switcher snapshot resizes can leave the column CSS at a
    /// width the window no longer has (four narrow columns / wrong page).
    /// Cheap two-int check; when stale, re-applies the CSS for the CURRENT
    /// geometry and restores the last known good position. Returns true if
    /// it repaired anything.
    /// #291: monochrome illustrations (import-tagged via a `.mono.`
    /// filename suffix) lose their opaque white plates and sit on the page.
    /// Gated on the user's "tint images" switch: some heavy engravings
    /// come out badly and the white box is the lesser evil.
    ///
    /// By ALPHA, not by blending (2026-10-13): `mix-blend-mode` blends only
    /// within the element's own compositing group, and the page's texture
    /// (#865) is a fixed layer OUTSIDE the scrolled content's group — with
    /// the texture on, a JPEG engraving blended against nothing and kept
    /// its white plate (user: every EPUB and MOBI alike; only the PNGs with
    /// their own alpha were right). An SVG colour matrix turns luminance
    /// into transparency — white → clear, ink → the text colour — the same
    /// arithmetic as multiply on a page, and it needs no backdrop at all.
    /// The alpha row is `A − luminance`, not `1 − luminance`: a transparent
    /// pixel (black at alpha 0 — the filter's own margin, the fractional
    /// last row of a box) must stay clear, not turn to ink. A mono PNG
    /// carries its own alpha and keeps the blend rule it always had.
    var _monoInkSVGNS = 'http://www.w3.org/2000/svg';
    function monoImageCSS(settings) {
        var svg = document.getElementById('_cr_mono_ink_svg');
        if (!settings.tintMonoImages) {
            if (svg) svg.remove();
            return '';
        }
        var ink = parseColorToRGB(settings.textColor || '#000000').split(',').map(function (v) {
            return (parseFloat(v) || 0) / 255;
        });
        var values = '0 0 0 0 ' + ink[0].toFixed(4) +
            ' 0 0 0 0 ' + ink[1].toFixed(4) +
            ' 0 0 0 0 ' + ink[2].toFixed(4) +
            ' -0.2126 -0.7152 -0.0722 1 0';
        if (!svg) {
            svg = document.createElementNS(_monoInkSVGNS, 'svg');
            svg.id = '_cr_mono_ink_svg';
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('width', '0');
            svg.setAttribute('height', '0');
            svg.style.cssText = 'position:absolute; width:0; height:0; overflow:hidden; pointer-events:none;';
            var filter = document.createElementNS(_monoInkSVGNS, 'filter');
            filter.id = '_cr_mono_ink';
            // sRGB, not linear light: a mid-grey wash must come out as half
            // ink, the way multiply read it, not the quarter linear light says.
            filter.setAttribute('color-interpolation-filters', 'sRGB');
            var matrix = document.createElementNS(_monoInkSVGNS, 'feColorMatrix');
            matrix.setAttribute('type', 'matrix');
            filter.appendChild(matrix);
            svg.appendChild(filter);
            document.documentElement.appendChild(svg);
        }
        svg.querySelector('feColorMatrix').setAttribute('values', values);
        // A book of pictures (#945) has rules of its own — `pagesTintCSS`,
        // on a sheet the texture can refresh; the filter above is shared.
        if (_pages) return '';
        var dark = isDarkPaper(settings);
        return ' img[src$=".mono.jpg"] { filter: url("#_cr_mono_ink"); }' +
            (dark
                ? ' img[src$=".mono.png"] { filter: invert(1) brightness(0.85); mix-blend-mode: screen; }'
                : ' img[src$=".mono.png"] { mix-blend-mode: multiply; }');
    }

    function isDarkPaper(settings) {
        var m = /^#?([0-9a-f]{6})$/i.exec(String(settings.bgColor || '').trim());
        if (!m) return false;
        var n = parseInt(m[1], 16);
        var lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
        return lum < 128;
    }

    /// A book of pictures and the paper (#945, user: "can we lose the
    /// white fields?"): a page's white is the paper, not a plate on it.
    /// A page drawn in ink (the import's `.mono.` tag) goes through the
    /// ink filter — transparent where the page is white, the theme's ink
    /// where it is black, in every theme. A page in colour keeps its
    /// colours and multiplies into the paper on the light themes; a dark
    /// theme shows it as printed, there being no honest way to put a
    /// colour page on black. The paper — colour AND wash — is painted on
    /// the page box itself: a blend sees only its own group, and the
    /// fixed wash behind the document is not in it (the #996 lesson).
    ///
    /// On dark paper the pages have a brightness of their own (#1034): the
    /// negative's light lines, a positive page's white, a colour page —
    /// all dimmed alike. On the page BOX, not the picture: a filter list
    /// holding the ink filter's url() does not interpolate, and the box's
    /// does, so a slider's step eases instead of jumping. 1 = as drawn.
    function pagesTintCSS(settings) {
        if (!_pages) return '';
        var dark = isDarkPaper(settings);
        var level = Math.max(0.3, Math.min(1, Number(settings.pagesBrightness) || 1));
        var dim = dark
            ? ' ._cr_page { transition: filter 0.2s ease-out;' +
              (level < 0.995 ? ' filter: brightness(' + level.toFixed(2) + ');' : '') + ' }'
            : '';
        if (!settings.tintMonoImages) return dim;
        var css = ' ._cr_page img[src*=".mono."] { filter: url("#_cr_mono_ink"); }';
        if (dark) return css + dim;
        var wash = (_pageTextureOn && _pageTextureBuiltURL)
            ? ' background-image: url("' + _pageTextureBuiltURL + '"); background-repeat: repeat;'
            : '';
        css += ' ._cr_page { background-color: ' + (settings.bgColor || '#ffffff') + ';' + wash + ' }' +
            ' ._cr_page img:not([src*=".mono."]) { mix-blend-mode: multiply; }';
        return css;
    }

    function applyPagesTint(settings) {
        var sheet = document.getElementById('_cr_pages_tint');
        var css = settings ? pagesTintCSS(settings) : '';
        if (!css) {
            if (sheet) sheet.remove();
            return;
        }
        if (!sheet) {
            sheet = document.createElement('style');
            sheet.id = '_cr_pages_tint';
            document.head.appendChild(sheet);
        }
        if (sheet.textContent !== css) sheet.textContent = css;
    }

    function healPagedLayoutIfStale() {
        if (!isPaged()) return false;
        if (_appliedPagingW === window.innerWidth && _appliedPagingH === window.innerHeight) return false;
        applyPagingCSS();
        restorePositionPaged(lastKnownXpath, lastKnownProgress);
        return true;
    }

    /// Lift a dim/hide our own resize/applySettings machinery left behind
    /// when its fade-back timers got cancelled mid-burst. The steady-state
    /// opacity is '' (stylesheet default) or '1' — anything else this long
    /// after the last resize event is an orphan.
    function liftStuckDim() {
        var op = document.body.style.opacity;
        if (op === '' || op === '1') return;
        document.body.style.transition = 'opacity 0.15s ease';
        document.body.style.opacity = '1';
        document.body.style.filter = '';
        setTimeout(function() { document.body.style.transition = ''; }, 200);
    }

    /// Timestamp of the last window.resize event (any visibility).
    var _lastResizeEventAt = 0;

    // Layout watchdog (#279): a margins-mode sheet resize (fixed sheet
    // proportions double the width on a page↔twoPage flip) can be
    // interrupted mid-burst by an occlusion-driven visibility bounce —
    // the hidden branch of onResize bails without repaginating and the
    // visibilitychange return pass clears the debounced timers, leaving
    // column CSS stamped for the pre-flip width and the body dimmed
    // until the user presses something (nextPage heals on entry). Sweep
    // once a second: when the document is visible, no burst is live and
    // no snapshot-pass layout is pending, repair the stale stamp and
    // lift any orphaned dim. Two int compares + a style read — free.
    setInterval(function() {
        if (document.hidden || isResizing || _hiddenResizeSeen) return;
        if (Date.now() - _lastResizeEventAt < 800) return;
        healPagedLayoutIfStale();
        liftStuckDim();
    }, 1000);

    /// Until when a turn is sliding to its spread — the drift snap
    /// leaves it alone (see the snap's listener).
    var _animatedTurnUntil = 0;

    function goToPage(pageIndex, forceInstant) {
        if (!isPaged()) return;
        healPagedLayoutIfStale();
        // User turned a page → the frozen settings anchor (#82) is now stale.
        invalidateStickyAnchor();
        computeTotalPages();
        var page = Math.max(0, Math.min(pageIndex, totalPages - 1));
        var targetX = pageToX(page);
        // Under a flip the leaf is the animation (#879): the page itself
        // must land at once, whatever Page turn says.
        // A JUMP lands at once too (user, 2026-10-24: "Go to image" from
        // page 240 to 311 stopped at 247, and only the first far jump
        // missed): a smooth scroll across dozens of spreads drags through
        // pictures not yet painted, a frame stalls past the drift snap's
        // 120 ms, and the snap stops the journey wherever it stands. Only
        // a turn to the next or the previous spread slides.
        var animated = pageTransition && !forceInstant && Math.abs(page - currentPage) <= 1;
        if (animated) _animatedTurnUntil = Date.now() + 700;

        // The two-page separator (#84) is a fixed overlay (position:fixed on
        // <html>) over the gutter at centerX, so text slides UNDER it. During
        // a smooth turn we only DIM it (not hide) — it stays present as a
        // column-rule, but softer so its overlap with the sliding text mid-
        // slide doesn't read as "cutting" the text.
        if (animated) {
            dimSeparator(true);
            setTimeout(function() { dimSeparator(false); }, 300);
        }
        window.scrollTo({ left: targetX, top: 0, behavior: animated ? 'smooth' : 'instant' });

        currentPage = page;
        // Stamp the turn's intent synchronously (#272 audit): the report
        // below runs up to 350ms out (animated turns) and can get caught
        // in backgrounding churn / an applySettings capture. Progress
        // becomes the authority (xpath cleared) until the report derives
        // a fresh xpath at a stable layout — so any restore in the gap
        // lands on the page the user turned TO, not the one they left.
        lastKnownProgress = totalPages > 1 ? page / (totalPages - 1) : 0;
        lastKnownXpath = null;
        // Delay position report until scroll reaches the target page
        var delay = animated ? 350 : 20;
        setTimeout(function() { reportPagePosition(); }, delay);
    }

    /// Whether a turn is the reader's to draw (#879): the flip is on and
    /// the spread is two columns, or the Typewriter's carriage is on
    /// (#880, any column count) — and there is a reader to ask. Every
    /// path into a turn — keys, wheel, swipe, click zones, the reader's
    /// own buttons — goes through nextPage/prevPage, so the one question
    /// stands here.
    function flipHandled(direction, vertical) {
        var leaf = pageFlip && pagingColumns === 2;
        // One column is one card the page wide, revolving about its
        // centre (user, 2026-09-20) — the phone's shape (#890), on every
        // device now.
        var cards = pageCards;
        // The plain slide follows the KEY (user, 2026-09-20): Up/Down,
        // Space and Return slide the page up and down, Left/Right and the
        // swipe slide it sideways — the sideways one is the page's own
        // scroll, the vertical one the reader's, drawn like the carriage
        // without the spring. Only where no effect stands in.
        var slide = !!vertical && pageTransition && !leaf && !cards && !pageSink && !pageCarriage && !pageCrumble;
        if (!leaf && !cards && !pageSink && !pageCarriage && !pageCrumble && !slide) return false;
        if (!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pageFlip)) return false;
        computeTotalPages();
        var target = currentPage + direction;
        if (target < 0 || target > totalPages - 1) return true;   // the edge: nothing turns
        // The sink and the cards follow the key too (user, 2026-09-22):
        // a vertical key turns them on the vertical axis.
        var axisVertical = slide || (!!vertical && (cards || pageSink));
        // The host animates what it sees: in an rtl book the next page comes
        // from the left (#945), so the leaf's direction is mirrored here and
        // mirrored back in turnPageInstant.
        var visual = pagesRTL() && !axisVertical ? -direction : direction;
        window.webkit.messageHandlers.pageFlip.postMessage({ direction: visual, vertical: axisVertical,
            kind: leaf ? 'leaf' : (cards ? 'cards' : (pageSink ? 'sink' : (pageCrumble ? 'crumble' : (slide ? 'slide' : 'carriage')))) });
        return true;
    }

    /// The reader's half of the flip: the page lands on the neighbouring
    /// spread at once, under the leaf.
    function turnPageInstant(direction) {
        if (!isPaged()) return;
        healPagedLayoutIfStale();
        computeTotalPages();
        // The host's direction is the one it animated — visual (see flipHandled).
        if (pagesRTL()) direction = -direction;
        var target = currentPage + direction;
        if (target < 0 || target > totalPages - 1) return;
        goToPage(target, true);
    }

    var separatorBaseOpacity = 1; // set in applyPageSeparator per mode

    // #84 hybrid: during a smooth turn, dim the (fixed) separator to a
    // fraction of its base opacity instead of hiding it — keeps the divider
    // present as a column-rule while softening its overlap with text mid-slide.
    function dimSeparator(dim) {
        var sep = document.getElementById('_cr_page_separator');
        if (!sep) return;
        var DIM = 0.35;
        sep.style.transition = 'opacity ' + (dim ? '90' : '160') + 'ms ease';
        sep.style.opacity = String(dim ? separatorBaseOpacity * DIM : separatorBaseOpacity);
    }

    /// - Parameter vertical: the turn was asked for by a vertical key
    ///   (Up/Down, Space, Return) — the plain slide follows it.
    function nextPage(vertical) {
        if (!isPaged()) return;
        if (flipHandled(1, vertical)) return;
        healPagedLayoutIfStale();
        computeTotalPages();
        // Use tracked currentPage to avoid reading mid-animation scrollLeft
        if (currentPage < totalPages - 1) {
            goToPage(currentPage + 1);
        }
    }

    function prevPage(vertical) {
        if (!isPaged()) return;
        if (flipHandled(-1, vertical)) return;
        healPagedLayoutIfStale();
        computeTotalPages();
        if (currentPage > 0) {
            goToPage(currentPage - 1);
        }
    }

    /// One-line vertical scroll. Used by Up/Down arrow keys in the
    /// scroll navigation mode — distinct from Space / Left / Right
    /// which page by viewport. No-op in paged modes (those have no
    /// concept of "one line").
    /// direction: +1 forward (down), -1 backward (up). Honours the
    /// document's computed line-height; falls back to font-size × 1.6
    /// when line-height resolves to 'normal'.
    // scrollByLine uses an accumulating-target model so rapid key
    // repeat produces a smooth continuous scroll instead of a stutter
    // of cancelled-and-restarted tweens (#53). The handle is non-null
    // while a rAF loop is in flight; the target Y accumulates each
    // press, and the loop closes on it via exponential decay.
    //
    // `_scrollLineLastSetY` is the position we placed at the previous
    // frame. The step compares it against the current `scrollY` — a
    // mismatch >1px means the user took over with wheel / touch / etc.
    // and the loop bails so it doesn't fight the manual scroll
    // (the "rubber-band back to where the arrows had been pointing"
    // bug after a few quick taps left the loop alive while the
    // target was still ahead of the actual position).
    var _scrollLineRAF = null;
    var _scrollLineTargetY = 0;
    var _scrollLineLastSetY = null;
    // Actual scrollY observed at the start of the previous frame. If it
    // didn't change after we issued a scrollTo, we're stuck (clamped at a
    // document edge, or the decay step fell below the browser's pixel
    // quantization) — the loop must finish or it spins forever pinning the
    // scroll and silently overriding native page navigation (#264).
    var _scrollLinePrevY = null;
    // scrollY two frames back. A period-2 oscillation — the ±1px progress
    // guarantee overshooting a target the scroll quantization can't
    // express — passes BOTH guards above: each frame moves (stall guard
    // blind) and moves by ≤1px (external-scroll guard blind). Seen live
    // on the Mac as endless 1–2px text jitter after arrow-key scrolling.
    var _scrollLinePrev2Y = null;
    // When the last arrow press landed. The FULL scroll report (the xpath
    // probe and the app-side rebuild) is held back while presses keep
    // coming: a line step decays for ~400ms and the 250ms settle wait ran
    // out between two presses a second apart — a full report per press,
    // and each one a hitch under the next line (user, 2026-09-11: the
    // wheel is smooth, the arrows stutter). See checkScrollSettled.
    var _lastLineScrollAt = 0;
    var LINE_SCROLL_SETTLE_MS = 900;

    // --- The page step in scroll mode, with a mark where the eye left off ---
    // A viewport's step leaves two or three lines of the old screen on the
    // new one, and the eye has to hunt for the last line it read (user,
    // 2026-09-22). After the step, a dashed rule under that line — or over
    // the first one, going back — lights and fades, edge to edge.

    /// The line at the viewport's edge that is still WHOLLY in view: the
    /// last one going forward, the first one going back. In viewport y.
    function edgeLineY(dir) {
        var b = document.body.getBoundingClientRect();
        var x = Math.max(4, Math.min(window.innerWidth - 4,
                  b.left + Math.min(40, b.width / 4) + (parseFloat(getComputedStyle(document.body).paddingLeft) || 0)));
        var h = window.innerHeight;
        for (var i = 0; i < 80; i++) {
            var y = dir > 0 ? h - 2 - i * 4 : 2 + i * 4;
            if (y < 0 || y > h) break;
            var r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
            if (!r) continue;
            var rects = r.getClientRects();
            var rect = rects && rects.length ? rects[0] : null;
            if (!rect || rect.height <= 0) continue;
            if (dir > 0 && rect.bottom <= h) return rect.bottom;
            if (dir < 0 && rect.top >= 0) return rect.top;
        }
        return null;
    }

    function showPageStepMark(docY) {
        var el = document.getElementById('_cr_page_step_mark');
        if (!el) {
            el = document.createElement('div');
            el.id = '_cr_page_step_mark';
            document.documentElement.appendChild(el);
        }
        el.style.cssText = 'position: absolute; left: 0; width: 100%; height: 0; pointer-events: none; z-index: 9998; ' +
            'top: ' + Math.round(docY + 2) + 'px; border-top: 1px dashed var(--text-color, currentColor); ' +
            'opacity: 0; transition: opacity 0.18s ease-out;';
        void el.offsetHeight;
        el.style.opacity = '0.55';
        clearTimeout(el._crFade);
        el._crFade = setTimeout(function() {
            el.style.transition = 'opacity 0.6s ease-in';
            el.style.opacity = '0';
        }, 500);
    }

    /// One viewport forward or back in scroll mode, the edge line marked.
    function scrollPage(direction) {
        if (isPaged()) return;
        var dir = direction < 0 ? -1 : 1;
        var edge = edgeLineY(dir);
        var docY = edge !== null ? window.scrollY + edge : null;
        var before = window.scrollY;
        window.scrollBy({ top: dir * window.innerHeight * 0.9, left: 0, behavior: scrollAnimation ? 'smooth' : 'auto' });
        if (docY === null) return;
        var shown = false;
        function mark() {
            if (shown) return;
            shown = true;
            window.removeEventListener('scrollend', mark);
            if (Math.abs(window.scrollY - before) < 2) return;   // at an end: nothing moved
            showPageStepMark(docY);
        }
        window.addEventListener('scrollend', mark);
        setTimeout(mark, scrollAnimation ? 700 : 60);
    }

    function scrollByLine(direction) {
        if (isPaged()) return;
        var dir = direction < 0 ? -1 : 1;
        var bodyStyle = getComputedStyle(document.body);
        var fs = parseFloat(bodyStyle.fontSize) || 18;
        var lh = parseFloat(bodyStyle.lineHeight);
        if (isNaN(lh) || lh <= 0) lh = fs * 1.6;
        var delta = lh * dir;
        // A strip of pictures (#945) has no line: a tenth of the window.
        if (_pages) delta = Math.round(window.innerHeight * 0.1) * dir;

        _lastLineScrollAt = Date.now();

        if (!scrollAnimation) {
            // Instant: skip the loop, no animation.
            window.scrollBy(0, delta);
            return;
        }

        if (_scrollLineRAF !== null) {
            // Loop in flight — extend the existing target. No restart,
            // no velocity reset. Holding the arrow key adds one `lh`
            // per OS key-repeat interval, the target stays ahead of
            // the current position, and the decay step pulls toward it
            // continuously.
            _scrollLineTargetY = Math.round(_scrollLineTargetY + delta);
            return;
        }

        // No loop in flight — start fresh from current scroll position.
        // The target is kept on WHOLE pixels: line-height is fractional
        // (e.g. 29.9px), and a fractional target can land exactly between
        // two positions the browser's scroll quantization can reach — the
        // loop then never gets within the finish threshold and the ±1px
        // progress guarantee overshoots forever (the 60Hz A↔B jitter).
        _scrollLineTargetY = Math.round(window.scrollY + delta);
        _scrollLineLastSetY = null;
        _scrollLinePrevY = null;
        _scrollLineRAF = requestAnimationFrame(stepScrollLine);
    }

    function endScrollLine() {
        _scrollLineRAF = null;
        _scrollLineLastSetY = null;
        _scrollLinePrevY = null;
        _scrollLinePrev2Y = null;
    }

    function stepScrollLine() {
        var currentY = window.scrollY;
        // External-scroll guard: if currentY drifted from where we
        // placed it last frame, the user took over (wheel / touch /
        // drag / programmatic). Bail without snapping back — leave
        // the page where the user moved it.
        if (_scrollLineLastSetY !== null
            && Math.abs(currentY - _scrollLineLastSetY) > 1) {
            endScrollLine();
            return;
        }
        var distance = _scrollLineTargetY - currentY;
        // Sub-pixel snap: stop when within 0.5px of target so we don't
        // burn rAF frames on imperceptible motion.
        if (Math.abs(distance) < 0.5) {
            window.scrollTo(0, _scrollLineTargetY);
            endScrollLine();
            return;
        }
        // Stall guard (#264): if our last scrollTo didn't actually move
        // the position — clamped at a document edge, or the decay step
        // fell below the browser's pixel-scroll quantization — the loop
        // would otherwise spin forever re-pinning scrollY every frame,
        // which silently swallows native page navigation (Space / the
        // smooth scrollBy on the side arrows) until a real wheel/touch
        // scroll trips the external-scroll guard above. Finish here.
        if (_scrollLinePrevY !== null && currentY === _scrollLinePrevY) {
            endScrollLine();
            return;
        }
        // Oscillation guard: back where we were two frames ago means the
        // loop is bouncing across a target it cannot land on (see
        // _scrollLinePrev2Y). Settle on the target once — quantization
        // picks the nearest reachable position — and finish.
        if (_scrollLinePrev2Y !== null && currentY === _scrollLinePrev2Y) {
            window.scrollTo(0, _scrollLineTargetY);
            endScrollLine();
            return;
        }
        _scrollLinePrev2Y = _scrollLinePrevY;
        _scrollLinePrevY = currentY;
        // Exponential decay: 13% of remaining distance per frame
        // (~9 frames to cover 70%, ~17 frames for 90%; at 60fps that's
        // ~150ms to 70% and ~283ms to 90%). Lower decay than the
        // initial 0.18 — held arrows produced occasional jitter on
        // long holds because the per-frame correction was big enough
        // to amplify timing mismatches between the OS key-repeat
        // cadence and the 60Hz rAF tick. Smaller corrections smooth
        // the steady-state velocity.
        var step = distance * 0.13;
        // Guarantee at least ~1px of progress toward the target so the
        // tail of the animation can't stall below pixel quantization
        // (the other half of #264; the stall guard above then catches
        // the edge-clamp case where even 1px can't move).
        if (Math.abs(step) < 1) step = distance > 0 ? 1 : -1;
        var nextY = currentY + step;
        window.scrollTo(0, nextY);
        _scrollLineLastSetY = nextY;
        _scrollLineRAF = requestAnimationFrame(stepScrollLine);
    }

    /// updateAnchor === false → RESTORE path (#272): the position state
    /// (lastKnownXpath/Progress) is the anchor this restore came FROM —
    /// the user's position. Re-deriving it from the rendered page top
    /// only loses information (top-of-page quantization), and doing so
    /// against a mid-settle layout during app-switch churn poisoned it by
    /// whole spreads. Restores therefore never write position state; only
    /// genuine user actions (page turn, scroll snap, explicit navigation)
    /// do. Swift still gets the derived page numbers for the UI, but the
    /// saved/synced xpath+progress stay the user's.
    function reportPagePosition(updateAnchor) {
        // A user-action report caught in churn must not derive from the
        // live layout (#272 audit): goToPage schedules this up to 350ms
        // out, and a turn-then-switch-apps gesture lets the timer fire
        // against the backgrounding snapshot relayout — the derived
        // garbage would enter position state AND be synced. Defer until
        // the layout is real again; goToPage already stamped the turn's
        // progress synchronously, so restores in the gap stay correct.
        if (updateAnchor !== false && (document.hidden || isResizing)) {
            setTimeout(function() { reportPagePosition(updateAnchor); }, 150);
            return;
        }
        computeTotalPages();
        var progress = wholeBookOnScreen(true) ? 1 : totalPages > 1 ? currentPage / (totalPages - 1) : 0;

        var clampedProgress = Math.min(1.0, Math.max(0.0, progress));
        var xpath;
        var haveAnchor = lastKnownXpath && lastKnownXpath !== '/html/body';
        if (updateAnchor === false && haveAnchor) {
            xpath = lastKnownXpath;
        } else {
            // Derive from the rendered viewport and make it the new anchor.
            if (_pages) {
                // A page has no text to anchor on: the page itself, by its
                // id — an xpath that survives the blanks the layout adds.
                xpath = pagesAnchorXPath();
            } else {
                var textNode = getFirstVisibleTextNodePaged();
                xpath = textNode ? getXPath(textNode.parentNode) : '/html/body';
            }
            lastKnownXpath = xpath;
            lastKnownProgress = clampedProgress;
        }

        if (window.webkit && window.webkit.messageHandlers.positionUpdate) {
            // Column-based page numbers: N per spread (#864).
            var colsPerSpread = pagingColumns;
            window.webkit.messageHandlers.positionUpdate.postMessage({
                xpath: xpath,
                charOffset: 0,
                scrollY: document.documentElement.scrollLeft,
                progress: (updateAnchor === false && haveAnchor) ? lastKnownProgress : clampedProgress,
                viewportRatio: totalPages > 0 ? 1.0 / totalPages : 1,
                currentPage: currentPage * colsPerSpread,
                totalPages: totalPages * colsPerSpread
            });
        }
    }

    function getFirstVisibleTextNodePaged() {
        // In paged mode, find first text node visible in the current column viewport.
        //
        // Two scroll positions matter here and they can disagree:
        //
        //   actualScrollX   = document.documentElement.scrollLeft
        //                     — what the UIScrollView is CURRENTLY showing.
        //                     getBoundingClientRect's rect.left is relative
        //                     to THIS viewport, so document_x = rect.left +
        //                     actualScrollX.
        //
        //   intendedScrollX = currentPage * innerWidth
        //                     — what we asked scrollLeft to be via the most
        //                     recent goToPage / goToPageInstant.
        //
        // On iOS WKWebView with a multi-column body, window.scrollTo
        // can be asynchronous: a programmatic page jump fires this
        // function (via reportPagePosition 20ms later) BEFORE the
        // UIScrollView has committed the new contentOffset.x. In that
        // window actualScrollX is still 0 (or the previous page), but
        // we KNOW the user's intent is currentPage.
        //
        // Compare the text rect's DOCUMENT position (via actualScrollX)
        // against the INTENDED column viewport (via intendedScrollX).
        // That picks the correct page's text node regardless of whether
        // the scroll has propagated yet.
        //
        // Without this, lastKnownXpath was getting locked to the first
        // text node in the book after a scroll→paged mode switch:
        // reportPagePosition fired 20 ms after goToPageInstant with
        // actualScrollX still 0, walked the start of the document, cached
        // /html/body/.../p[0]. Nothing then updates lastKnownXpath until
        // the next manual page turn (onScroll's body checks
        // window.scrollY which doesn't change for horizontal column
        // scroll, so it can't correct it). Symptom: scroll → paged → FS
        // toggle "flies to start of book"; one manual page-turn first
        // makes it work because that goToPage runs reportPagePosition
        // once scrollLeft has settled.
        var actualScrollX = document.documentElement.scrollLeft;
        // Intended scroll = where goToPage(currentPage) would land, which
        // uses _pagePitch (= scroll distance per logical page-turn) — not
        // innerWidth. When pad/innerWidth produce sub-pixel column widths
        // these differ by 1+ pixels per page and a long-running session
        // ends up reading the wrong text node.
        var pageW = (_pagePitch > 0) ? _pagePitch : window.innerWidth;
        var intendedScrollX = isPaged() ? pageToX(currentPage) : actualScrollX;
        var viewLeft = intendedScrollX;
        var viewRight = intendedScrollX + window.innerWidth;

        // Fast path (#180): probe with caretRangeFromPoint instead of walking
        // every text node from the start of the document on each page turn.
        // Only valid when the intended column is actually on screen (caret
        // probes use the RENDERED viewport) — mid-jump, while the UIScrollView
        // hasn't committed the new contentOffset, fall through to the walker,
        // which compensates via the intended/actual split documented above.
        // Every hit is validated with the SAME geometric predicate the walker
        // uses, so the fast path can't change which node gets picked.
        if (document.caretRangeFromPoint) {
            var offsetX = viewLeft - actualScrollX;
            if (offsetX >= 0 && offsetX < window.innerWidth - 8) {
                // From the start side: the right of an rtl page (#1094).
                var pxs = nativeRTL()
                    ? [offsetX + window.innerWidth - 16, offsetX + Math.floor(window.innerWidth * 0.7)]
                    : [offsetX + 16, offsetX + Math.floor(window.innerWidth * 0.3)];
                var fracs = [0.05, 0.15, 0.25, 0.35, 0.45];
                for (var fi = 0; fi < fracs.length; fi++) {
                    var py = Math.floor(window.innerHeight * fracs[fi]);
                    for (var pi = 0; pi < pxs.length; pi++) {
                        if (pxs[pi] >= window.innerWidth) continue;
                        var pr = document.caretRangeFromPoint(pxs[pi], py);
                        if (!pr || !pr.startContainer) continue;
                        var pn = pr.startContainer;
                        if (pn.nodeType !== Node.TEXT_NODE || !pn.textContent.trim()) continue;
                        if (isInFixedChrome(pn)) continue;
                        var vrange = document.createRange();
                        vrange.selectNode(pn);
                        var vrect = vrange.getBoundingClientRect();
                        var vLeft = vrect.left + actualScrollX;
                        var vRight = vrect.right + actualScrollX;
                        if (vRight > viewLeft && vLeft < viewRight && vrect.top >= 0 && vrect.top < window.innerHeight * 0.5) {
                            return pn;
                        }
                    }
                }
            }
        }

        var walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    var text = node.textContent.trim();
                    if (!text) return NodeFilter.FILTER_SKIP;
                    var range = document.createRange();
                    range.selectNode(node);
                    var rect = range.getBoundingClientRect();
                    // Convert viewport-relative rect to document coords
                    // using the ACTUAL scroll, then compare against the
                    // INTENDED column viewport.
                    var absLeft = rect.left + actualScrollX;
                    var absRight = rect.right + actualScrollX;
                    if (absRight > viewLeft && absLeft < viewRight && rect.top >= 0 && rect.top < window.innerHeight * 0.5) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_SKIP;
                }
            }
        );
        return walker.nextNode();
    }

    // --- Voice reader position highlight ---

    var _vrHighlightEl = null;

    function highlightVoiceReaderTarget(el) {
        // Remove any previous highlight
        clearVoiceReaderHighlight();

        // Inject CSS if not present
        var style = document.getElementById('_vr_highlight_css');
        if (!style) {
            style = document.createElement('style');
            style.id = '_vr_highlight_css';
            style.textContent =
                '._vr_highlight { ' +
                '  background: linear-gradient(90deg, rgba(59,130,246,0.12) 0%, rgba(59,130,246,0.06) 100%) !important; ' +
                '  border-inline-start: 3px solid rgba(59,130,246,0.5) !important; ' +
                '  padding-inline-start: 8px !important; ' +
                '  margin-inline-start: -11px !important; ' +
                '  border-radius: 2px !important; ' +
                '  transition: background 0.6s ease, border-color 0.6s ease; ' +
                '} ' +
                '._vr_highlight_fade { ' +
                '  background: transparent !important; ' +
                '  border-left-color: transparent !important; ' +
                '}';
            document.head.appendChild(style);
        }

        el.classList.add('_vr_highlight');
        _vrHighlightEl = el;

        // Remove highlight on first scroll/page-turn
        var removeOnScroll = function() {
            clearVoiceReaderHighlight();
            window.removeEventListener('scroll', removeOnScroll);
        };
        // Small delay so the initial scrollTo doesn't trigger removal
        setTimeout(function() {
            window.addEventListener('scroll', removeOnScroll, { once: true });
        }, 500);
    }

    function clearVoiceReaderHighlight() {
        if (_vrHighlightEl) {
            _vrHighlightEl.classList.add('_vr_highlight_fade');
            var el = _vrHighlightEl;
            setTimeout(function() {
                el.classList.remove('_vr_highlight', '_vr_highlight_fade');
            }, 600);
            _vrHighlightEl = null;
        }
    }

    /// The pages' slots for N columns (#945), in READING order: a wide
    /// picture (a drawn spread) takes both columns of a spread and begins
    /// on its first one; the first page stands alone on the far side when
    /// the book says so (a bound book's page 1 faces the inside of the
    /// cover); blanks fill what the pairing leaves. A right-to-left book is
    /// then laid into the DOM in REVERSE slot order: WebKit's own rtl
    /// multicol stacks its columns from the viewport's right edge whatever
    /// the container's width, so the columns stay left-to-right and the
    /// reading order comes from the DOM — the last slot first, so that
    /// the engine's page 0 (the far right of the body) is the first spread
    /// and, within a spread, the right column is the earlier page. The
    /// pages keep their ids; the anchors are by id. Returns the slot count.
    function layoutPages(N) {
        var pages = Array.prototype.slice.call(document.querySelectorAll('._cr_page'));
        pages.sort(function (a, b) { return pageNumber(a) - pageNumber(b); });
        Array.prototype.slice.call(document.querySelectorAll('._cr_blank')).forEach(function (b) { b.remove(); });
        function blank() {
            var b = document.createElement('div');
            b.className = '_cr_blank';
            b.setAttribute('aria-hidden', 'true');
            return b;
        }
        var rtl = !!(_pages && _pages.rtl);
        function isWide(p) {
            var img = p.querySelector('img');
            var w = img ? (parseInt(img.getAttribute('width'), 10) || 0) : 0;
            var h = img ? (parseInt(img.getAttribute('height'), 10) || 0) : 0;
            return N > 1 && w > h * 1.05;
        }
        var order = [];
        // A wide first page (a cover drawn across the spread) is a spread
        // of its own: no blank before it, or the book OPENS on an empty
        // spread (user, 2026-10-14: "the reader will think the book is
        // empty and close it").
        if (N > 1 && _pages.firstAlone && pages.length > 1 && !isWide(pages[0])) order.push(blank());
        for (var i = 0; i < pages.length; i++) {
            var p = pages[i];
            var wide = isWide(p);
            p.classList.toggle('_cr_wide', wide);
            if (wide) {
                if (order.length % 2 === 1) order.push(blank());
                // The box begins in the LEFT column of its spread and runs
                // over into the right one; the blank holds that column.
                // Left is the second slot read in an rtl book.
                if (rtl) { order.push(blank()); order.push(p); } else { order.push(p); order.push(blank()); }
            } else {
                order.push(p);
            }
        }
        if (N > 1 && order.length % 2 === 1) order.push(blank());
        var physical = rtl ? order.slice().reverse() : order;
        for (var k = 0; k < physical.length; k++) document.body.appendChild(physical[k]);
        return order.length;
    }

    function pageNumber(el) {
        var m = /^_cr_p(\d+)$/.exec(el.id || '');
        return m ? parseInt(m[1], 10) : 0;
    }

    /// What the lens shows for a book of pictures (user, 2026-10-26): the
    /// spread a fraction names, its slots left to right as the eye meets
    /// them (an rtl book's too), a wide picture alone; in the strip, the
    /// page at that point. Each picture by its file and its size.
    function spreadAtProgress(fraction) {
        var f = Math.min(1, Math.max(0, Number(fraction) || 0));
        function slot(el) {
            if (el.classList.contains('_cr_blank')) return { blank: true };
            var img = el.querySelector('img');
            if (!img) return { blank: true };
            return { src: img.getAttribute('src') || '',
                     w: parseInt(img.getAttribute('width'), 10) || 0,
                     h: parseInt(img.getAttribute('height'), 10) || 0 };
        }
        if (isPaged()) {
            computeTotalPages();
            var page = Math.round(f * (totalPages - 1));
            var x0 = pageToX(page), x1 = x0 + getPageWidth();
            var sx = document.documentElement.scrollLeft;
            var hits = [];
            var slots = document.querySelectorAll('._cr_page, ._cr_blank');
            for (var i = 0; i < slots.length; i++) {
                var r = slots[i].getBoundingClientRect();
                var left = r.left + sx;
                if (left + r.width > x0 + 1 && left < x1 - 1) hits.push({ el: slots[i], left: left });
            }
            hits.sort(function (a, b) { return a.left - b.left; });
            var wide = hits.filter(function (h) { return h.el.classList.contains('_cr_wide'); });
            var shown = (wide.length ? wide : hits).map(function (h) { return slot(h.el); });
            return { page: page * pagingColumns + 1, total: totalPages * pagingColumns, items: [], spread: shown };
        }
        var pages = document.querySelectorAll('._cr_page');
        var at = stripPageIndexAt(Math.max(0, document.body.scrollHeight - window.innerHeight) * f);
        return { page: Math.max(0, at) + 1, total: pages.length, items: [],
                 spread: at >= 0 ? [slot(pages[at])] : [] };
    }

    /// The strip's page a document y falls in: the first that reaches past
    /// it. The lens shows this page, and a jump lands on its top.
    function stripPageIndexAt(y) {
        var pages = document.querySelectorAll('._cr_page');
        for (var k = 0; k < pages.length; k++) {
            if (pages[k].getBoundingClientRect().bottom + window.scrollY > y + 1) return k;
        }
        return pages.length - 1;
    }

    /// The earliest page of the current spread, by id (#945).
    function pagesAnchorXPath() {
        var pages = document.querySelectorAll('._cr_page');
        var x0 = pageToX(currentPage), x1 = x0 + getPageWidth();
        var scrollX = document.documentElement.scrollLeft;
        var best = null;
        for (var i = 0; i < pages.length; i++) {
            var r = pages[i].getBoundingClientRect();
            var left = r.left + scrollX;
            if (left + r.width > x0 + 1 && left < x1 - 1) {
                if (!best || pageNumber(pages[i]) < pageNumber(best)) best = pages[i];
            }
        }
        return best && best.id ? '//*[@id="' + best.id + '"]' : '/html/body';
    }

    /// A book of pictures read as a flow — a webtoon's strip (#945): the
    /// pictures one under another, as wide as the page allows.
    function pagesFlowCSS() {
        // The strip's only: in spreads the 1000 px cap took the wide box
        // down to one column and a bit (user, 2026-10-14).
        if (!_pages || !_pages.strip) return '';
        return ' body._cr_pages { padding-left: 0 !important; padding-right: 0 !important; }' +
            ' body._cr_pages ._cr_page { width: 100%; max-width: 1000px; margin: 0 auto; padding: 0; }' +
            ' body._cr_pages ._cr_page img { width: 100%; height: auto; display: block; margin: 0; }';
    }

    function applyPagingCSS() {
        _lastLaidW = window.innerWidth;
        _lastLaidH = window.innerHeight;
        var sheet = document.getElementById('_paging_override');
        if (!sheet) {
            sheet = document.createElement('style');
            sheet.id = '_paging_override';
            document.head.appendChild(sheet);
        }

        // Tell the iOS host about the current paging mode so its
        // ScrollClampDelegate knows whether to clamp contentOffset.x = 0.
        if (window.webkit && window.webkit.messageHandlers.setPagedMode) {
            window.webkit.messageHandlers.setPagedMode.postMessage({ isPaged: isPaged() });
        }

        // Govern native touch panning declaratively via touch-action. Unlike
        // touchmove preventDefault this does NOT disable the iOS text-selection
        // handle gesture, so we keep handles draggable while blocking content
        // drift (#1): paged = no pan at all (pages turn via tap/swipe, scroll is
        // programmatic), scroll = vertical only (no sideways drift). Without
        // this, allowing touchmove during a selection let a handle-drag pan the
        // columns to the next page / push scroll-mode content off-screen.
        // Only where there is touch (#864): a touch-action other than
        // auto makes WebKit keep an EVENT REGION for the document — it
        // "paints" every text box of every column into a region on each
        // rendering update — which on a pointer machine buys nothing and
        // was most of a five-second stall on a wide window.
        var _ta = (navigator.maxTouchPoints > 0) ? (isPaged() ? 'none' : 'pan-y') : '';
        document.documentElement.style.touchAction = _ta;
        document.body.style.touchAction = _ta;

        _pagedGutters = [];
        if (!isPaged()) {
            _appliedPagingW = 0;
            _appliedPagingH = 0;
            // Remove the paging stylesheet entirely (not just clear it)
            // to ensure WebKit doesn't retain column layout artifacts
            sheet.remove();
            document.documentElement.style.overflow = '';
            document.documentElement.style.height = '';
            document.documentElement.style.scrollBehavior = '';
            document.body.style.overflow = '';
            document.body.style.height = '';
            document.body.style.columnWidth = '';
            document.body.style.columnGap = '';
            document.body.style.columnFill = '';
            document.body.style.boxSizing = '';
            // #649 - the scroll clearance lives IN the document now (FS
            // phone full-bleeds the frame): re-assert it through the
            // paged->scroll cleanup instead of clearing to the old
            // frame-owns-it default.
            var _stp = (lastAppliedSettings && lastAppliedSettings.scrollTopPad > 0)
                ? lastAppliedSettings.scrollTopPad + 'px' : '';
            document.body.style.paddingTop = _stp;
            document.body.style.paddingBottom = '';
            ['_cr_page_separator', '_cr_page_border_top', '_cr_page_border_bottom'].forEach(function(id) {
                var e = document.getElementById(id);
                if (e) e.remove();
            });
            // Reset horizontal scroll. In paged mode scrollLeft = page ×
            // pageWidth — a large number. Without this the scrollView
            // remembers the old position.
            window.scrollTo({ left: 0, top: window.scrollY, behavior: 'instant' });
            // Force full layout tree rebuild to clear WebKit column break artifacts.
            // Body is already faded (opacity 0.3) so display:none won't flash.
            document.body.style.display = 'none';
            document.body.offsetHeight;
            document.body.style.display = '';
            document.body.offsetHeight;
            // After the forced reflow, scroll left again — the layout
            // rebuild can reset scroll to an arbitrary remembered value.
            window.scrollTo({ left: 0, top: window.scrollY, behavior: 'instant' });
            // CSS + JS scrollTo aren't always enough on iOS — the
            // WKWebView's underlying UIScrollView remembers a wider
            // contentSize from paged mode. Ask the Swift host to clamp
            // its contentSize.width down. Slight delay so the JS reflow
            // above has actually settled in WebKit before we read bounds.
            if (window.webkit && window.webkit.messageHandlers.scrollResetX) {
                setTimeout(function() {
                    window.webkit.messageHandlers.scrollResetX.postMessage({});
                }, 50);
            }
            // A flowing page has one column, and the read-out should
            // know it the moment the columns go (#864).
            pagingColumns = 1;
            reportPagingColumns();
            return;
        }

        // Body padding is already set by applySettings (paddingLeft/Right)
        // to the user's chosen value (0..50 iPhone, 0..200 elsewhere).
        // Key formula: column-width + column-gap = viewport width
        // This ensures each page turn of exactly viewport-width lands on a column.
        // Read the user's body padding here without a minimum clamp —
        // the previous `Math.max(20, ...)` made the in-paged-mode override
        // sheet below stamp body padding back to 20 minimum, so any user
        // value below ~20 silently snapped to 20.
        var pad = parseInt(document.body.style.paddingLeft) || 0;
        // Norton label extends to ~y=22, need content below it
        var hasNorton = !!document.getElementById('_norton_border');
        // Under the frame, several columns need room for the rims (#864,
        // user): a padding floor of 24 keeps the text off the outer box's
        // double line and lines the columns up with the boxes (the gap
        // between columns is 2·pad from 20 up). A single column keeps the
        // user's padding as it is.
        var contentAreaProbe = window.innerWidth - 2 * pad;
        if (hasNorton && parseInt(pagingColumnsWanted, 10) > 1 && pad < 24
            && resolvePagingColumns(contentAreaProbe, pad) > 1) {
            pad = 24;
        }
        // A plain frame keeps its text gap on the sides too (#866): the
        // text starts the gap inside the rule, wherever the rule stands.
        if (hasNorton && !_frameLegends) {
            pad = Math.max(pad, _frameSideInset + _frameTextGap);
        }
        // #283 — independent composition: the Swift layer gives the WebView a
        // content frame that already excludes the control strip, the safe
        // areas, and (in iOS fullscreen) the FS clock pill. The paddings here
        // are CONTENT cosmetics only — small breathing room against the frame
        // edges — and know nothing about the chrome. Norton reserves extra for
        // its DOM-internal decorative rim (ti=10 + label above the first line,
        // rim + buffer below the last one).
        // Comfort (#915): the column's clearance, plus a balance at the
        // top for the strip that stands under the page (user).
        var vPadTop = hasNorton ? (_frameLegends ? 26 : 10 + _frameTextGap)
            : (_comfort ? comfortTopPad() + (_comfort.stripBalance || 0) : 6);
        var vPadBottom = hasNorton ? (_frameLegends ? 36 : 10 + _frameTextGap) : (_comfort ? comfortTopPad() : 6);
        // A page of pictures fills its column edge to edge (#945) — above
        // Comfort's strip, which stands over the page's foot (#1041, user:
        // a scan cut to its drawing ran under the strip; one with white
        // margins hid it). Text keeps its own clearance there.
        if (_pages) { vPadTop = 0; vPadBottom = _comfortStrip > 0 ? _comfortStrip + 6 : 0; }
        var colGap, colWidth;
        // CSS multi-column auto-balances columns within body's content
        // area (= innerWidth - 2*pad with box-sizing: content-box). If we
        // specify `column-width: X` but the content area can fit wider
        // columns of the same count, the browser uses (content - gap)/n
        // instead of X. To keep scroll pitch aligned with column
        // boundaries we must compute colWidth as the browser will
        // actually lay it out — based on the available content area and
        // the desired column count for the mode.
        var contentArea = window.innerWidth - 2 * pad;
        var contentAreaFull = contentArea;
        // The count for THIS width (#864). A change of count while the
        // mode stays paged is a flip like page↔twoPage was: the anchors
        // stay valid (both are column layouts of the same book), and the
        // resize path's anchor must survive the round trip (#272) — so
        // the hold is raised here, where the count is settled, for the
        // rotation that resolved it and the return leg alike.
        var resolved = resolvePagingColumns(contentArea, pad);
        if (resolved !== pagingColumns) {
            pagingColumns = resolved;
            _pagedFlipAnchorHold = true;
        }
        var N = pagingColumns;
        // The remainder of the content area that N whole-pixel columns and
        // their gaps do not cover — handed to the trailing padding below, so
        // the browser's own column width is the integer we asked for (#864).
        // A fractional column width (2030 wide, three columns: 596.67) put
        // every text box off the pixel grid, and WebKit's event-region
        // union of unaligned boxes ran for seconds where aligned rows had
        // merged for free — three columns hung, two and four did not.
        // The remainder goes to the LEADING padding (user, 2026-09-19:
        // Comfort, three columns — a sliver of the next column's letters
        // stood at the right edge). Comfort's gap between three or more
        // columns is the pad itself, so with the remainder on the
        // trailing side the next spread began at innerWidth − remainder:
        // inside the viewport by a pixel or two. On the leading side the
        // last column ends at innerWidth − pad, and the next begins one
        // gap later — never nearer than the edge, since the gap is never
        // less than the pad. The gutters below shift with it.
        var padRemainder = 0;
        if (N > 1) {
            // Several columns visible. Enforce a minimum visible gap
            // between them — if user pad is 0 the columns would glue
            // text-to-text and look unreadable. The 40px minimum is
            // independent of body padding (which is allowed to be 0).
            // Comfort (#915, user): the outer margins twice a column's
            // inner one — the gap between columns is the pad itself, so
            // an edge column has a full gap's worth of paper outside it.
            // The pitch below is `contentArea + colGap` whatever the gap.
            // Two columns are a SPREAD (user): the outer margins are
            // repeated twice at the centre, as a book's are — the classic
            // 2·pad. Three and four are columns: the gap is the pad.
            colGap = _comfort && N > 2 ? Math.max(40, pad) : Math.max(40, 2 * pad);
            // colWidth for CSS must be an integer pixel value; floor.
            colWidth = Math.floor((contentArea - (N - 1) * colGap) / N);
            padRemainder = contentArea - N * colWidth - (N - 1) * colGap;
            contentArea -= padRemainder;
            // Pitch = distance from start of one spread to start of the
            // next = N*actualColWidth + N*colGap. The BROWSER renders
            // columns at fractional (sub-pixel) widths when the division
            // is not whole — e.g. innerWidth=1875, pad=0, N=2 →
            // actualColWidth=917.5 but our floored colWidth=917. Using
            // N*colWidth + N*colGap with the floored value would put
            // pitch at 1914 while the browser's actual layout has spreads
            // at multiples of 1915 — a 1px drift per spread that visibly
            // accumulates by ~30 spreads (partial pre/next columns leaking
            // on viewport edges). Algebraically: N*((contentArea-(N-1)*
            // colGap)/N) + N*colGap = contentArea + colGap, whatever N.
            // This form is exact regardless of sub-pixel widths.
            _pagePitch = contentArea + colGap;
        } else {
            // Single-page mode: one column visible per page, filling the
            // entire content area. Pitch = colWidth + colGap (col + gap
            // to the next col) = contentArea + colGap, which works out
            // to innerWidth in both pad=0 and pad>0 cases because
            // colGap = 2*pad here.
            colGap = 2 * pad;
            colWidth = contentArea;
            _pagePitch = contentArea + colGap;
        }
        // A book of pictures (#945): a hairline between the two pages of a
        // spread and nothing else; every page a column, blanks where the
        // pairing asks for them, the body exactly as wide as its spreads
        // so the columns run from one end to the other — in either
        // direction.
        var pagesBodyWidth = 0;
        if (_pages) {
            colGap = N > 1 ? 4 : 0;
            colWidth = Math.floor((contentAreaFull - (N - 1) * colGap) / N);
            padRemainder = contentAreaFull - N * colWidth - (N - 1) * colGap;
            contentArea = contentAreaFull - padRemainder;
            _pagePitch = contentArea + colGap;
            var slots = layoutPages(N);
            pagesBodyWidth = Math.max(1, Math.ceil(slots / N)) * _pagePitch - colGap;
        }

        // Column height = viewport minus top + bottom clearance,
        // rounded DOWN to a whole number of lines so the last line
        // never starts inside the column but gets clipped at the bottom.
        var rawColHeight = window.innerHeight - vPadTop - vPadBottom;
        var fs = parseFloat(getComputedStyle(document.body).fontSize) || 18;
        var lh = parseFloat(getComputedStyle(document.body).lineHeight);
        if (isNaN(lh)) lh = fs * 1.6; // fallback if lineHeight is 'normal'
        var colHeight = Math.floor(rawColHeight / lh) * lh;

        // Distribute the SNAP remainder FIRST, before we possibly substitute
        // a cached colHeight below. Otherwise the subtraction
        // `rawColHeight - colHeight` after the substitution counts the
        // cache delta on top of the snap remainder and dumps the whole sum
        // into vPadTop — visible as a huge gap above the text.
        //
        // Where to put it:
        // - Norton: TOP (decorative brass rim already eats top budget;
        //   the bottom rim sits right at the chrome, can't take extra).
        // - iPhone non-FS non-Norton: TOP. The bottom budget is
        //   pre-sized to clear the bar chrome exactly (vPadBottom_initial
        //   = chrome_top + 1pt buffer), so any remainder dumped at the
        //   bottom reads as a wasted ~lh-tall cream strip *above* the
        //   bar — the user reads it as "another line could fit here".
        //   The top in non-FS is below the status bar (`.ignoresSafeArea`
        //   is .bottom only), so a thicker vPadTop is just breathing
        //   room, not an overlap risk. Text still anchors to the top of
        //   the column box; only the column box itself sits lower.
        // - Everything else (iPad / desktop non-Norton): BOTTOM. The
        //   wider chrome reads better when the column is top-aligned
        //   against the status-bar edge.
        var snapRemainder = rawColHeight - colHeight;
        if (hasNorton) {
            vPadTop += snapRemainder;
        } else {
            // Split the whole-line rounding remainder between the frame
            // edges — dumped entirely at the bottom it reads as "one more
            // line would fit here" against the control strip (#283 device
            // feedback); halved it's breathing room on both sides.
            var snapTop = Math.floor(snapRemainder / 2);
            vPadTop += snapTop;
            vPadBottom += snapRemainder - snapTop;
        }

        // #283: no FS absorption and no cached-column reconciliation any more —
        // the Swift content frame is the only geometry input, and a fullscreen
        // toggle is an ordinary resize (position restored via the resize
        // anchor, same as rotation).
        sheet.textContent =
            'html { ' +
            '  overflow-y: hidden !important; ' +
            '  overflow-x: scroll !important; ' +
            '  -webkit-overflow-scrolling: touch !important; ' +
            '  height: 100vh !important; ' +
            '  scrollbar-width: none !important; ' +
            '} ' +
            'html::-webkit-scrollbar { display: none !important; } ' +
            'body { ' +
            '  column-width: ' + colWidth + 'px !important; ' +
            '  column-gap: ' + colGap + 'px !important; ' +
            '  column-fill: auto !important; ' +
            '  height: ' + colHeight + 'px !important; ' +
            '  overflow: visible !important; ' +
            '  max-width: none !important; ' +
            '  padding-top: ' + vPadTop + 'px !important; ' +
            '  padding-bottom: ' + vPadBottom + 'px !important; ' +
            // The remainder on the LEADING side (see above) — the right
            // in an rtl book (#1094).
            '  padding-left: ' + (pad + (nativeRTLText() ? 0 : padRemainder)) + 'px !important; ' +
            '  padding-right: ' + (pad + (nativeRTLText() ? padRemainder : 0)) + 'px !important; ' +
            '  box-sizing: content-box !important; ' +
            '} ' +
            // The BOOK's pictures — not the frame's drawings on <html> (#866).
            'body img, body picture, body figure img, body svg { ' +
            '  max-height: ' + (colHeight - 40) + 'px !important; ' +
            '  break-inside: avoid !important; ' +
            '} ' +
            'h1, h2, h3, h4, h5, h6 { ' +
            '  break-after: avoid-column !important; ' +
            '}';
        if (_pages) {
            var wideW = N > 1 ? (2 * colWidth + colGap) : colWidth;
            sheet.textContent +=
                ' body { width: ' + pagesBodyWidth + 'px !important; margin-left: 0 !important; margin-right: 0 !important; direction: ltr !important; }' +
                ' ._cr_page, ._cr_blank { box-sizing: border-box !important; width: ' + colWidth + 'px !important; height: ' + colHeight + 'px !important;' +
                ' margin: 0 !important; padding: 0 !important; break-after: column !important; break-inside: avoid !important; }' +
                ' ._cr_page { display: flex !important; align-items: center !important; justify-content: center !important; overflow: hidden !important; }' +
                ' ._cr_page._cr_wide { width: ' + wideW + 'px !important; }' +
                // The box, not the scan's own size (user, 2026-10-14: a
                // low-resolution page stood small in its column): the
                // picture fills the box and keeps its shape.
                ' ._cr_page img { width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important;' +
                ' object-fit: contain !important; display: block !important; margin: 0 !important; break-inside: avoid !important; }';
        }

        // Stamp the geometry this paged layout was computed for (#272).
        _appliedPagingW = window.innerWidth;
        _appliedPagingH = window.innerHeight;

        // Re-align scrollLeft immediately to the current page's new
        // pitch. Padding changes alter _pagePitch (e.g. two-page
        // pad=0 → 20 changes pitch from 1940 to 1900), which moves
        // column boundaries in body coordinates. The post-CSS
        // restorePositionPaged that applySettings/onResize run AFTER
        // a setTimeout will eventually snap to the right place — but
        // until that fires the scroll position falls between columns
        // of the new layout, visible as partial pre/next columns
        // leaking on both viewport edges. Snap now so the 80ms
        // settle window doesn't show the broken state.
        if (_pagePitch > 0 && currentPage >= 0) {
            var targetX = pageToX(currentPage);
            // (pageToX is a physical x: negative in an rtl text book.)
            if (Math.abs(document.documentElement.scrollLeft - targetX) > 1) {
                window.scrollTo({ left: targetX, top: 0, behavior: 'instant' });
            }
        }

        // The gutters between the columns (#864): gutter k (1..N-1) is
        // centred at pad + k*(actualColWidth + colGap) - colGap/2, with
        // actualColWidth = (contentArea - (N-1)*colGap)/N — the browser's
        // own width, not the floored CSS one, so the mark stands on the
        // gap however the sub-pixels fell. For N=2 that is innerWidth/2
        // whatever the pad, as it always was.
        var gutters = [];
        if (N > 1) {
            var actualColWidth = (contentArea - (N - 1) * colGap) / N;
            for (var k = 1; k < N; k++) {
                var g = Math.round(pad + padRemainder + k * (actualColWidth + colGap) - colGap / 2);
                // Mirrored in an rtl book (#1094): the columns run from the right.
                gutters.push(nativeRTLText() ? window.innerWidth - g : g);
            }
        }
        _pagedGutters = gutters;
        applyPageSeparator(gutters, vPadTop, colHeight);
        reportPagingColumns();
        // A frame's boxes seam on these gutters (#866): re-lay them now
        // that the columns are known, rather than a rebuild later — on a
        // resize the frame is drawn BEFORE the columns, and the trailing
        // rebuild is a quarter of a second away.
        if (hasNorton && N > 1 && lastAppliedSettings) {
            applyNortonFrame(lastAppliedSettings, !!lastAppliedSettings.nortonFrame);
        }

        // Paged mode handles clearance via column height — remove scroll masks
        removeScrollMasks();

        // Last-page right-shift fix.
        //
        // When body.padding-right is set with content-box and the column
        // algorithm overflows columns past the body box, body.scrollWidth
        // ends at the right edge of the LAST column — without the
        // padding-right contribution. Result: max scrollLeft is `pad`
        // short of what goToPage() asks for, so the last column gets
        // clamped and visually shifts right by `pad`.
        //
        // Fix: schedule an absolutely-positioned 1×1 invisible sentinel
        // past the last column's right edge so scrollWidth grows to
        // include the missing padding. Doesn't touch column layout.
        requestAnimationFrame(function() { adjustLastPagePadding(pad); });
    }

    function adjustLastPagePadding(pad) {
        if (!isPaged()) {
            // Cleanup if mode switched
            var existing = document.getElementById('_cr_paged_right_sentinel');
            if (existing) existing.remove();
            return;
        }

        var sentinelId = '_cr_paged_right_sentinel';
        var sentinel = document.getElementById(sentinelId);

        // Body needs `position: relative` for absolute child to be
        // positioned relative to it.
        if (document.body.style.position !== 'relative') {
            document.body.style.position = 'relative';
        }

        if (!sentinel) {
            sentinel = document.createElement('div');
            sentinel.id = sentinelId;
            sentinel.setAttribute('aria-hidden', 'true');
            sentinel.style.cssText =
                'position:absolute !important;' +
                'top:0 !important;' +
                'width:1px !important;' +
                'height:1px !important;' +
                'visibility:hidden !important;' +
                'pointer-events:none !important;';
            document.body.appendChild(sentinel);
        }
        // Park sentinel off-screen so it doesn't contribute to the
        // measurement we're about to take — off the START side, which no
        // scroll reaches: the left of an ltr page, the right of an rtl one
        // (#1094), where the left IS the scrollable far end.
        if (nativeRTLText()) { sentinel.style.left = 'auto'; sentinel.style.right = '-10000px'; }
        else { sentinel.style.right = 'auto'; sentinel.style.left = '-10000px'; }

        // Force reflow so scrollWidth reflects the parked sentinel.
        void document.body.offsetWidth;

        var scrollW = document.body.scrollWidth;
        // pageW must be the SAME pitch goToPage/getCurrentPage use —
        // i.e. _pagePitch, not innerWidth. With non-trivial body padding
        // or odd innerWidth values, _pagePitch differs from innerWidth
        // (e.g. innerWidth=1875, pad=0 → pitch=1915), and a sentinel
        // placed by innerWidth leaves the last page offset by the
        // per-page pitch delta — visible as a stripe of the previous
        // page's right edge bleeding into the left of the last page's view.
        // The body must reach the LAST spread's start plus the window,
        // not a whole number of pitches — `pagesForScrollWidth`.
        var pageW = (_pagePitch > 0) ? _pagePitch : window.innerWidth;
        var pages = pagesForScrollWidth(scrollW);
        var expectedW = (pages - 1) * pageW + window.innerWidth;
        var deficit = expectedW - scrollW;

        if (deficit > 0 && deficit < pageW) {
            // Place sentinel so its far edge sits at expectedW.
            if (nativeRTLText()) sentinel.style.right = (expectedW - 1) + 'px';
            else sentinel.style.left = (expectedW - 1) + 'px';
        }
    }

    // --- Scroll-mode edge masks ---
    // In scroll mode, text extends to the full viewport edges.
    // Fixed-position masks hide content at top/bottom, providing visual clearance
    // similar to paged mode's height constraint.
    // --- The texture under the text (#865) ---
    // A tile the reader hands over as a data URL (setPageTexture), read as
    // GRAIN: mid-grey is flat, darker a hollow, lighter a ridge. The layer
    // is a fixed div behind the content painting that grain as a wash of
    // the page's ink — black where the paper dips, white where it rises —
    // so it takes the theme's colour from underneath whatever it is; on a
    // dark theme the tile is read the other way up, the light side held
    // down, so a rule shows and the page never lightens.
    // Built once per (tile, dark) on a canvas; the strength is the div's
    // opacity, so a slider costs nothing.
    var _pageTextureSrc = '';        // the tile as handed over
    var _pageTextureOpacity = 0.5;
    var _pageTextureDark = false;
    var _pageTextureOn = false;
    var _pageTextureBuiltKey = '';   // src + dark + strength the current wash was built for
    var _pageBgColor = '';           // the page colour, painted under the wash
    var _pageTextureBuiltURL = '';   // the wash, as a data URL
    var _pageTextureImage = null;    // the tile, decoded

    function setPageTexture(src) {
        if (src === _pageTextureSrc) return;
        _pageTextureSrc = src || '';
        _pageTextureImage = null;
        _pageTextureBuiltKey = '';
        applyPageTexture();
    }

    function applyPageTexture() {
        var el = document.getElementById('_cr_page_texture');
        var root = document.documentElement.style;
        if (!_pageTextureOn || !_pageTextureSrc) {
            if (el) el.remove();
            root.backgroundImage = '';
            if (_pages && lastAppliedSettings) applyPagesTint(lastAppliedSettings);
            return;
        }
        // The strength is BAKED into the wash's alpha (2026-09-17): as the
        // div's opacity it came out double what the reader's own ground
        // draws beside the page at the same number — the rails and the
        // bar stood a shade lighter than the paper they continue. One
        // build per (tile, side, strength); a slider step is a canvas pass.
        var key = _pageTextureSrc.length + ':' + _pageTextureSrc.slice(-64) + ':' + (_pageTextureDark ? 'd' : 'l') + ':' + _pageTextureOpacity;
        if (_pageTextureBuiltKey !== key) {
            if (!_pageTextureImage || _pageTextureImage.src !== _pageTextureSrc) {
                var img = new Image();
                _pageTextureImage = img;
                img.onload = function () {
                    if (_pageTextureImage !== img) return;
                    applyPageTexture();
                };
                img.src = _pageTextureSrc;
                return;
            }
            if (!_pageTextureImage.complete || !_pageTextureImage.naturalWidth) return;
            _pageTextureBuiltURL = buildPageTextureWash(_pageTextureImage, _pageTextureDark, _pageTextureOpacity);
            _pageTextureBuiltKey = key;
        }
        // A book of pictures (#945): the wash on the document itself,
        // scrolling with the pages — paper sheets, not a desk. A FIXED
        // layer under the document puts the pages into composited layers
        // of their own once they carry a filter or a blend (the tint), and
        // WebKit's snapshot — the flip's and the stand's — then finds a
        // page turned to blank; in the root layer they paint as drawn.
        if (_pages) {
            if (el) el.remove();
            root.backgroundImage = 'url("' + _pageTextureBuiltURL + '")';
            root.backgroundRepeat = 'repeat';
            if (lastAppliedSettings) applyPagesTint(lastAppliedSettings);
            return;
        }
        root.backgroundImage = '';
        if (!el) {
            el = document.createElement('div');
            el.id = '_cr_page_texture';
            document.documentElement.appendChild(el);
        }
        // The page colour under the wash, on the div itself (2026-09-17):
        // the web view draws no background of its own and the root's
        // colour is not painted for it, so the reader's ground — page
        // colour AND paper — showed through, and the page wore the wash
        // twice against the rails' once. Opaque here, the div is the page.
        el.style.cssText = 'position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; z-index: -1; pointer-events: none; ' +
            (_pageBgColor ? 'background-color: ' + _pageBgColor + '; ' : '') +
            'background-image: url("' + _pageTextureBuiltURL + '"); background-repeat: repeat; background-position: 0 0;';
        if (_pages && lastAppliedSettings) applyPagesTint(lastAppliedSettings);
    }

    /// The tile's grain as a wash: per pixel, |luma − 128| becomes the
    /// alpha and the side of 128 the colour — black below, white above.
    /// Dark themes get the hollows only.
    function buildPageTextureWash(img, dark, strength) {
        var s = (typeof strength === 'number') ? Math.max(0, Math.min(1, strength)) : 1;
        var w = img.naturalWidth, h = img.naturalHeight;
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        var data = ctx.getImageData(0, 0, w, h);
        var px = data.data;
        // The tile's flat is its MEDIAN luma, not its mean: a ruled paper
        // is mostly flat with lines below it, and a mean pulled down by
        // the lines would have read the flat as a ridge and the lines as
        // nothing. A photo's grey point is not 128 either.
        var hist = new Uint32Array(256), n = px.length / 4, lumas = new Uint8Array(n);
        for (var i = 0, k = 0; i < px.length; i += 4, k++) {
            var l = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
            lumas[k] = l; hist[l]++;
        }
        var acc = 0, mid = 128;
        for (var h = 0; h < 256; h++) { acc += hist[h]; if (acc * 2 >= n) { mid = h; break; } }
        for (var j = 0, m = 0; j < px.length; j += 4, m++) {
            var d = lumas[m] - mid;
            var a, ink;
            // A gentle hand: the family's tiles keep their grain within
            // some fifty levels of flat, and the wash at full strength
            // should still read as paper, not as weather. On a dark page
            // the tile is read the other way up — a hollow (a rule, a
            // dip in the paper) is drawn light, held down so the page
            // never lightens, and a ridge dark (#865).
            if (d < 0) {
                ink = dark ? 255 : 0;
                a = Math.min(255, Math.round(-d * (dark ? 0.5 : 1.1)));
            } else {
                ink = dark ? 0 : 255;
                a = Math.min(255, Math.round(d * 1.1));
            }
            px[j] = ink; px[j + 1] = ink; px[j + 2] = ink;
            px[j + 3] = Math.round(a * s);
        }
        ctx.putImageData(data, 0, 0);
        return canvas.toDataURL('image/png');
    }

    var _scrollMaskBgColor = '#ffffff';

    function applyScrollMasks(isNorton) {
        var topMask = document.getElementById('_cr_scroll_mask_top');
        var botMask = document.getElementById('_cr_scroll_mask_bottom');

        if (isPaged()) {
            if (topMask) topMask.remove();
            if (botMask) botMask.remove();
            return;
        }

        // Norton frame only: mask the area outside the decorative border
        if (!isNorton) {
            if (topMask) topMask.remove();
            if (botMask) botMask.remove();
            return;
        }

        // #283: the content frame no longer extends under any chrome, so the
        // masks are pure cosmetics — a thin strip at each frame edge that
        // scrolling text slides under instead of touching the edge dead-on.
        // Norton mirrors its rim insets (rim + 3) so the masks cover exactly
        // the bands outside the cyan frame.
        var topH = _nortonTopInset > 0 ? _nortonTopInset + 3 : 13;
        var botH = _nortonBottomInset > 0 ? _nortonBottomInset + 3 : 13;

        if (!topMask) {
            topMask = document.createElement('div');
            topMask.id = '_cr_scroll_mask_top';
            document.body.appendChild(topMask);
        }
        if (!botMask) {
            botMask = document.createElement('div');
            botMask.id = '_cr_scroll_mask_bottom';
            document.body.appendChild(botMask);
        }

        var base = 'position:fixed;left:0;right:0;pointer-events:none;z-index:9500;background:' + _scrollMaskBgColor + ';transform:translateZ(0);-webkit-backface-visibility:hidden;will-change:transform;';
        topMask.style.cssText = base + 'top:0;height:' + topH + 'px;';
        botMask.style.cssText = base + 'bottom:0;height:' + botH + 'px;';
    }

    function removeScrollMasks() {
        var topMask = document.getElementById('_cr_scroll_mask_top');
        var botMask = document.getElementById('_cr_scroll_mask_bottom');
        if (topMask) topMask.remove();
        if (botMask) botMask.remove();
    }

    var lastReportedGutter;
    function reportPageGutter(x) {
        if (x === lastReportedGutter) { return; }
        lastReportedGutter = x;
        postPageLayout();
    }

    /// What the page laid (#783, #864): the gutter the reading line may
    /// stand in, and the column count the read-out counts pages by.
    /// One message for both — they change together, on the same relayout.
    function postPageLayout() {
        if (window.webkit && window.webkit.messageHandlers.pageLayout) {
            window.webkit.messageHandlers.pageLayout.postMessage({
                x: lastReportedGutter === undefined ? null : lastReportedGutter,
                // Every gutter (#885): the cards are cut on them.
                xs: _pagedGutters.slice(),
                columns: _reportedColumns || 1,
                capacity: _reportedCapacity || 0,
                // The text column (#915): where the page's padding puts
                // it, for a strip that stands on it. The padding of the
                // moment, Comfort's or the reader's.
                pad: parseInt(document.body.style.paddingLeft) || 0,
                width: window.innerWidth
            });
        }
    }

    function applyPageSeparator(gutters, vPadTop, colHeight) {
        var el = document.getElementById('_cr_page_separator');
        var topLine = document.getElementById('_cr_page_border_top');
        var botLine = document.getElementById('_cr_page_border_bottom');

        // Under the Norton frame the NC double-line boxes already separate the
        // pages and cap the top — the line/shadow separator + top rule just
        // add stray lines down the gutters and across the top, so suppress them.
        var hasNorton = !!document.getElementById('_norton_border');

        // The first gutter's separator and the others' (#864): nothing to
        // draw only when both say none. A frame's boxes separate on their
        // own (#866) — but the reading line may still stand in the first
        // gutter, between the boxes: it is the one separator a frame
        // allows (user, 2026-09-13: it floated mid-column on three and
        // four, because this branch reported no gutter at all).
        var restMode = pageSeparatorRestMode === 'progress' ? 'line' : pageSeparatorRestMode;
        // Comfort (#915): two columns part on a shadow, three or four on
        // lines — no setting, the count decides.
        var firstMode = pageSeparatorMode;
        if (_comfort) {
            firstMode = gutters.length === 1 ? 'shadow' : 'line';
            restMode = 'line';
        }
        var nothingToDraw = firstMode === 'none' && (gutters.length < 2 || restMode === 'none');
        if (!gutters.length || nothingToDraw || hasNorton) {
            if (el) el.remove();
            if (topLine) topLine.remove();
            if (botLine) botLine.remove();
            reportPageGutter(hasNorton && gutters.length && pageSeparatorMode === 'progress' ? gutters[0] : null);
            return;
        }

        var html = document.documentElement;

        // Use theme text color
        var textColor = getComputedStyle(document.body).color || 'rgba(0,0,0,1)';
        var rgb = parseColorToRGB(textColor);
        // The reader's own line may be standing in the first gutter
        // (#783): it has to stand where the COLUMNS were laid, which
        // during a resize burst is not yet where the frame is. One line,
        // once — the other gutters take the rest mode (#864, user).
        var lineInGutter = pageSeparatorMode === 'progress';
        reportPageGutter(lineInGutter ? gutters[0] : null);

        // --- Vertical separators ---
        // 'progress' draws nothing for its gutter (user, 2026-09-02): the
        // reader's own reading line stands there, drawn by SwiftUI over
        // the page — the top rule below still applies.
        var drawn = [];
        gutters.forEach(function (x, i) {
            var m = i === 0 ? firstMode : restMode;
            if (m !== 'progress' && m !== 'none') drawn.push({ x: x, mode: m });
        });
        if (!drawn.length) {
            if (el) el.remove();
        } else {
            // One fixed container across the page, a child per gutter
            // (#864): whoever dims or re-tops the separator (a page turn,
            // the top rule's pad) touches the container and reaches every
            // gutter at once.
            if (!el) {
                el = document.createElement('div');
                el.id = '_cr_page_separator';
                html.appendChild(el);
            }

            // Full viewport height so it's not clipped — from the top rule
            // down, not from the edge (user, 2026-09-02: it poked up into the
            // lifted tabs' keycaps, the same way the top rule did). On a
            // SHEET there is no rule and no dock above: the separator runs
            // from the sheet's own edge.
            var onSheet = !!(lastAppliedSettings && lastAppliedSettings.onSheet);
            var sepTop = onSheet ? 0 : topRulePad;
            el.style.cssText = 'position: fixed; left: 0; width: 100vw; top: ' + sepTop + 'px; height: calc(100vh - ' + sepTop + 'px); pointer-events: none; z-index: 9999; background: transparent;';
            el.innerHTML = '';
            var gutterBase = 'position: absolute; top: 0; height: 100%; pointer-events: none;';
            // Each gutter carries its own tone (a line is a tenth of the
            // ink, the rest full) — the container's opacity is the page
            // turn's dimmer, and dims them all alike.
            separatorBaseOpacity = 1;
            el.style.opacity = '1';

            drawn.forEach(function (d) {
                var centerX = d.x, mode = d.mode;
                var g = document.createElement('div');
                if (mode === 'line') {
                    g.style.cssText = gutterBase + ' left: ' + centerX + 'px; width: 1px; background: ' + textColor + '; opacity: 0.10;';
                } else if (mode === 'shadow') {
                    var c03 = 'rgba(' + rgb + ',0.025)';
                    var c06 = 'rgba(' + rgb + ',0.05)';
                    g.style.cssText = gutterBase + ' left: ' + (centerX - 20) + 'px; width: 40px; ' +
                        'background: linear-gradient(to right, transparent, ' + c03 + ' 30%, ' + c06 + ' 50%, ' + c03 + ' 70%, transparent);';
                } else if (mode === 'ornament') {
                    // A printer's rule turned on end (user, 2026-09-02: "a
                    // vignette, rotated 90 degrees"): a hairline that thins to
                    // nothing at both ends, a small knot at each third and a
                    // rosette at the middle, all in the text's ink. The rule is
                    // laid in four segments with the ornaments in the gaps, so
                    // nothing has to paint the page's colour over it — a sheet's
                    // page is transparent.
                    var oInk = 'rgba(' + rgb + ',0.34)';
                    var oW = 40;
                    g.style.cssText = gutterBase + ' left: ' + (centerX - oW / 2) + 'px; width: ' + oW + 'px; background: transparent;';
                    var segs = [[5, 22.6, true, false], [27.4, 47, false, false], [53, 72.6, false, false], [77.4, 95, false, true]];
                    segs.forEach(function (sg) {
                        var seg = document.createElement('div');
                        var grad = 'linear-gradient(to bottom, ' + (sg[2] ? 'transparent' : oInk) + ', ' + oInk + ' 45%, ' + oInk + ' 55%, ' + (sg[3] ? 'transparent' : oInk) + ')';
                        seg.style.cssText = 'position:absolute; left:' + (oW / 2 - 0.5) + 'px; width:1px; top:' + sg[0] + '%; height:' + (sg[1] - sg[0]) + '%; background:' + grad + ';';
                        g.appendChild(seg);
                    });
                    [['25%', '\u2726', 8], ['50%', '\u2743', 22], ['75%', '\u2726', 8]].forEach(function (o) {
                        var glyph = document.createElement('div');
                        glyph.textContent = o[1];
                        glyph.style.cssText = 'position:absolute; left:50%; top:' + o[0] + '; transform: translate(-50%, -50%); ' +
                            'font-family: -apple-system, "Apple Symbols", serif; font-size:' + o[2] + 'px; line-height:1; color:' + oInk + '; white-space:nowrap;';
                        g.appendChild(glyph);
                    });
                } else if (mode === 'ornamentWave') {
                    // The second vignette (user, 2026-09-02): two wavy rules a
                    // few points apart, a dot between every two waves, and a
                    // four-petal star at the middle. Each rule is a repeating
                    // SVG tile — one wave and one dot — in two columns, split
                    // around the star and tapered at the ends by a mask.
                    var wInk = 'rgba(' + rgb + ',0.34)';
                    var wW = 40, wGap = 7, tileH = 30;
                    var tile = '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="' + tileH + '" viewBox="0 0 6 ' + tileH + '">' +
                        '<path d="M3 1 C 0.6 6, 5.4 10, 3 15 C 1.6 18, 2.2 20, 3 21" fill="none" stroke="' + wInk + '" stroke-width="1.2" stroke-linecap="round"/>' +
                        '<circle cx="3" cy="26" r="1.3" fill="' + wInk + '"/></svg>';
                    var tileURL = 'url("data:image/svg+xml,' + encodeURIComponent(tile) + '")';
                    g.style.cssText = gutterBase + ' left: ' + (centerX - wW / 2) + 'px; width: ' + wW + 'px; background: transparent;';
                    [-wGap, wGap].forEach(function (dx) {
                        [[5, 45, 'to bottom, transparent, black 25%, black'], [55, 95, 'to bottom, black, black 75%, transparent']].forEach(function (sg) {
                            var col = document.createElement('div');
                            col.style.cssText = 'position:absolute; left:' + (wW / 2 + dx - 3) + 'px; width:6px; top:' + sg[0] + '%; height:' + (sg[1] - sg[0]) + '%; ' +
                                'background-image:' + tileURL + '; background-repeat: repeat-y; background-position: center top; ' +
                                '-webkit-mask-image: linear-gradient(' + sg[2] + '); mask-image: linear-gradient(' + sg[2] + ');';
                            g.appendChild(col);
                        });
                    });
                    var star = document.createElement('div');
                    star.textContent = '\u2724';
                    star.style.cssText = 'position:absolute; left:50%; top:50%; transform: translate(-50%, -50%); ' +
                        'font-family: -apple-system, "Apple Symbols", serif; font-size:22px; line-height:1; color:' + wInk + ';';
                    g.appendChild(star);
                } else if (mode === 'gap') {
                    // The desk showing between two pages (user, 2026-09-02): the
                    // shadow's 40px, one even tone a shade darker than the page,
                    // and the pages' inner corners rounded into it — "][". The
                    // corners are four small squares on the pages' edges, each a
                    // quarter-circle of page colour on the gap's tone, so no
                    // element ever has to be cut out of the page itself.
                    var W = 40, R = 10;
                    var bgRGBA = parseColorToRGBA(getComputedStyle(document.body).backgroundColor || '');
                    var opaque = bgRGBA && bgRGBA[3] > 0.99;
                    var gapColor, pageColor;
                    if (opaque) {
                        var t = rgb.split(',').map(Number);
                        var mixed = bgRGBA.slice(0, 3).map(function (c, i) {
                            return Math.round(c * 0.94 + t[i] * 0.06);
                        });
                        gapColor = 'rgb(' + mixed.join(',') + ')';
                        pageColor = 'rgb(' + bgRGBA.slice(0, 3).join(',') + ')';
                    } else {
                        // No page colour to draw the corners in — the band alone.
                        gapColor = 'rgba(' + rgb + ',0.06)';
                        pageColor = null;
                    }
                    g.style.cssText = gutterBase + ' left: ' + (centerX - W / 2 - R) + 'px; width: ' + (W + 2 * R) + 'px; background: transparent;';
                    var band = document.createElement('div');
                    band.style.cssText = 'position:absolute; top:0; bottom:0; left:' + R + 'px; width:' + W + 'px; background:' + gapColor + ';';
                    g.appendChild(band);
                    if (pageColor) {
                        // In fullscreen the web view stops above the home
                        // indicator and SwiftUI carries the band on down to
                        // the edge (#820) — no bottom corners there, or they
                        // would sit in mid-air.
                        var fsTail = !!(lastAppliedSettings && lastAppliedSettings.isFullscreen);
                        // [x, y, where the page's quarter-circle is centred]
                        var corners = [['left:0', 'top:0', '0 100%'], ['right:0', 'top:0', '100% 100%']];
                        if (!fsTail) corners.push(['left:0', 'bottom:0', '0 0'], ['right:0', 'bottom:0', '100% 0']);
                        corners.forEach(function (c) {
                            var corner = document.createElement('div');
                            corner.style.cssText = 'position:absolute; ' + c[0] + '; ' + c[1] + '; width:' + R + 'px; height:' + R + 'px; ' +
                                'background: radial-gradient(circle at ' + c[2] + ', ' + pageColor + ' ' + (R - 0.5) + 'px, ' + gapColor + ' ' + (R + 0.5) + 'px);';
                            g.appendChild(corner);
                        });
                    }
                }
                el.appendChild(g);
            });
        }

        // --- Top horizontal line (separates title bar from content) ---
        if (botLine) botLine.remove(); // no longer used
        // Fullscreen hides the header, so the divider under it is an
        // orphaned stray line (#301 device feedback) — draw it only when
        // the header exists. A sheet on a desk has its own edge and no
        // dock above it (user, 2026-09-02): no rule there either.
        // Comfort (#915, user, 2026-09-18) has no rule either: the
        // Professional bar props the page from below, Comfort's strip is
        // too light to answer a line at the top.
        if (_comfort || (lastAppliedSettings && (lastAppliedSettings.isFullscreen || lastAppliedSettings.onSheet))) {
            if (topLine) topLine.remove();
            return;
        }
        var lineColor = 'rgba(' + rgb + ',0.08)';

        if (!topLine) {
            topLine = document.createElement('div');
            topLine.id = '_cr_page_border_top';
            html.appendChild(topLine);
        }
        var topBg = pageSeparatorMode === 'shadow'
            ? 'linear-gradient(to right, transparent 5%, ' + lineColor + ' 25%, ' + lineColor + ' 75%, transparent 95%)'
            : lineColor;
        // 8px down, not on the very edge (user, 2026-09-02): the shut
        // top dock's strip is lifted into the titlebar and its foot
        // reaches a few points below it, so a line at 0 ran through the
        // keycaps of the tabs standing there.
        topLine.style.cssText = 'position: fixed; left: 0; width: 100vw; height: 1px; pointer-events: none; z-index: 9999; top: ' + topRulePad + 'px; background: ' + topBg + ';' +
            ' transition: opacity 0.25s ease-in-out; opacity: ' + (quietChrome ? '0' : '1') + ';';
    }

    // Any CSS colour as [r, g, b, a] — null when the browser could not
    // read it at all.
    function parseColorToRGBA(color) {
        if (!color) return null;
        var canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        var d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
    }

    function parseColorToRGB(color) {
        // Convert any CSS color to "r,g,b" string
        var canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        var d = ctx.getImageData(0, 0, 1, 1).data;
        return d[0] + ',' + d[1] + ',' + d[2];
    }

    var lastKnownProgress = 0; // track progress for fallback restore

    function restorePositionPaged(xpath, savedProgress) {
        if (!isPaged()) return;

        // Reset scroll to 0 so getBoundingClientRect returns absolute positions
        window.scrollTo({ left: 0, top: 0, behavior: 'instant' });

        computeTotalPages();
        var pageW = getPageWidth();
        var progressTarget = (savedProgress != null) ? savedProgress
                            : (lastKnownProgress != null ? lastKnownProgress : 0);

        // Primary: use xpath (finds exact element after reflow/resize).
        // For elements that span multiple columns (a long paragraph), use
        // getClientRects() — each rect is one column fragment. Picking the
        // fragment whose page is closest to savedProgress restores to where
        // the user was actually reading, not to the start of the paragraph
        // (which getBoundingClientRect().left would return and visibly drop
        // the page back by 1+ after every fullscreen toggle).
        var totalForProgress = Math.max(1, totalPages - 1);
        var progressPage = Math.round(progressTarget * totalForProgress);
        if (xpath && xpath !== '/html/body') {
            var node = getNodeByXPath(xpath);
            if (node) {
                var rects = (node.getClientRects && node.getClientRects().length > 0)
                    ? Array.from(node.getClientRects())
                    : [node.getBoundingClientRect()];
                var bestPage = -1;
                var bestDist = Infinity;
                for (var i = 0; i < rects.length; i++) {
                    var r = rects[i];
                    if (!r.width && !r.height) continue;
                    var p = rectPage(r, 0);
                    if (p < 0 || p >= totalPages) continue;
                    var dist = Math.abs(p - progressPage);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestPage = p;
                    }
                }
                if (bestPage >= 0) {
                    goToPageInstant(bestPage, false);
                    return;
                }
            }
        }

        // Fallback: use progress (approximate page fraction)
        if (progressTarget > 0 && totalPages > 1) {
            var page = Math.round(progressTarget * (totalPages - 1));
            goToPageInstant(page, false);
            return;
        }

        goToPageInstant(0, false);
    }

    function goToPageInstant(pageIndex, updateAnchor) {
        // Like goToPage but always instant (no animation) — for restore
        // operations and programmatic snaps. updateAnchor === false =
        // restore path: position state stays frozen (see
        // reportPagePosition), only scroll/currentPage move.
        computeTotalPages();
        var page = Math.max(0, Math.min(pageIndex, totalPages - 1));
        window.scrollTo({ left: pageToX(page), top: 0, behavior: 'instant' });
        currentPage = page;
        if (updateAnchor !== false) {
            // Update lastKnownProgress IMMEDIATELY from the page index so
            // any event firing before reportPagePosition's 20ms timer
            // (e.g. an FS toggle right after mode switch) sees the correct
            // progress — even if lastKnownXpath is still stale.
            lastKnownProgress = totalPages > 1 ? page / (totalPages - 1) : 0;
        }
        // lastKnownXpath update happens in reportPagePosition 20ms later;
        // it needs WebKit to finish the scroll before getBoundingClientRect
        // returns accurate per-fragment positions.
        setTimeout(function() { reportPagePosition(updateAnchor); }, 20);
    }

    // --- Initial restore values (saved by restorePosition, consumed by applySettings) ---
    var _initialRestoreXpath = null;
    var _initialRestoreProgress = 0;
    var _initialRestoreScrollY = 0;

    // --- Scroll tracking ---

    // Kept for resize-handler clear calls; the actual throttle uses
    // scrollTrailingTimer below.
    let scrollTimer = null;
    let lastSavedScrollY = -1;
    let lastKnownXpath = null;
    let lastKnownElementFraction = 0; // fraction of xpath element above viewport top
    let isResizing = false;
    let isInitialRestorePending = false;
    // #649 r2 — true once the INITIAL restore has actually landed. Before
    // that, any anchor captured from the viewport is the un-restored page
    // top (the book's title), and sticking it anywhere poisons the next
    // resize: open -> quick FS tap re-anchored to the title and the book
    // fell to its start (proven by [REST] logs, 2026-08-23).
    let _initialRestoreDone = false;
    // #1038 — a book wholly on screen has been read to its end. With
    // nothing to scroll the fraction is 0 over 0, which came out as 0 %
    // for good. Only once the initial restore has landed: a page still
    // being laid out "fits" for a moment, and a large book reporting
    // 100 % then would open at its end next time. Paged callers have
    // counted the pages already.
    function wholeBookOnScreen(paged) {
        if (!_initialRestoreDone) return false;
        return paged ? totalPages <= 1 : document.body.scrollHeight - window.innerHeight <= 0;
    }
    // ...and says so as the restore lands: nothing will scroll to report it.
    function reportIfWholeBookOnScreen() {
        if (isPaged()) {
            computeTotalPages();
            if (wholeBookOnScreen(true)) reportPagePosition();
            return;
        }
        if (!wholeBookOnScreen(false)) return;
        var pos = getCurrentPosition();
        lastKnownXpath = pos.xpath;
        lastKnownProgress = pos.progress;
        if (window.webkit && window.webkit.messageHandlers.positionUpdate) {
            window.webkit.messageHandlers.positionUpdate.postMessage({
                xpath: pos.xpath, charOffset: 0, scrollY: pos.scrollY,
                progress: pos.progress, viewportRatio: 1
            });
        }
    }
    // #720 — true while an applySettings mode flip's post-reflow restore is
    // still scheduled. The restore posts below defer to that branch: posting
    // "restored" while the paged reflow is in flight was the early-fire the
    // whole contract rewrite removes.
    let _modeFlipInFlight = false;

    // #720 — the ONE place "restored" is reported from the restore paths.
    // Defers when a mode flip owns the settle (its branch posts instead),
    // so exactly one party posts, after the layout is real.
    // #1040 — and says that it deferred: the flip's safety post is for a
    // post held back, not for a restore that has not come round to posting.
    var _initialPostDeferred = false;
    function postInitialRestored(scrollVal) {
        if (_modeFlipInFlight) { _initialPostDeferred = true; return; }
        _initialPostDeferred = false;
        isInitialRestorePending = false;
        _initialRestoreDone = true;
        // Anything frozen BEFORE the restore pointed at the wrong page.
        invalidateStickyAnchor();
        whenPagePainted(function () {
            if (window.webkit && window.webkit.messageHandlers.positionRestored) {
                window.webkit.messageHandlers.positionRestored.postMessage({ scrollY: scrollVal });
            }
            reportIfWholeBookOnScreen();
        });
    }

    /// A book of pictures is shown with its page PAINTED (#1040 r2, user:
    /// Aqua after another manga showed its cover, then nothing, then the
    /// page). The restore had landed on the right spread before "restored"
    /// went out — the log had no resize, no second restore — but the
    /// spread's pictures load lazily and decode late, and until then the
    /// view showed the frame it last painted, the first page, and then an
    /// empty spread. The pictures on screen are asked for at once and
    /// decoded (1.5 s at most), two frames go by, and only then is the book
    /// said to be restored. A text book posts as before.
    function whenPagePainted(done) {
        if (!_pages) { done(); return; }
        var vw = window.innerWidth, vh = window.innerHeight;
        var waits = [];
        var imgs = document.querySelectorAll('._cr_page img');
        for (var i = 0; i < imgs.length; i++) {
            var img = imgs[i];
            var r = img.getBoundingClientRect();
            if (r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh) continue;
            if (img.loading === 'lazy') img.loading = 'eager';
            if (img.decode) waits.push(img.decode().catch(function () {}));
        }
        var settled = false;
        function finish() {
            if (settled) return;
            settled = true;
            requestAnimationFrame(function () { requestAnimationFrame(done); });
        }
        if (!waits.length) { finish(); return; }
        Promise.all(waits).then(finish);
        setTimeout(finish, 1500);
    }
    var _pendingAnchor = null;
    var _pendingAnchorProgress = 0;

    // Scroll-report throttle. Previous behavior was strict debounce
    // (clearTimeout + 300ms setTimeout) — every scroll event reset the
    // timer, so during continuous reading the report fired *never*, and
    // Swift's push side never saw an update to forward to iCloud. The
    // other device's library showed a stuck position no matter how much
    // the active reader scrolled.
    //
    // Two reporters (#852). While the page MOVES, a LIGHT report — the
    // scroll fraction alone, no DOM probing — at most every 500ms, for the
    // progress line and the page count. The FULL report — the anchor
    // xpath, the element fraction, everything the store persists — waits
    // for the page to SETTLE: no scroll event for SCROLL_SETTLE_MS and the
    // same scrollY as when the wait began. Before this the full report
    // ran on a 500ms throttle straight through a fling — a dozen
    // caretRangeFromPoint probes, an XPath walk, a second lookup of the
    // same node and a forced layout on the WebContent thread, then a
    // whole-reader rebuild in the app on the message — and the phone
    // hitched on every tick, thicker as the fling slowed (user,
    // 2026-09-09: "дёрг ------- дёрг ----- дёрг -- дёрг - дёрг").
    var scrollTrailingTimer = null;
    var scrollSettleY = -1;
    var SCROLL_SETTLE_MS = 250;
    var scrollProgressTimer = null;
    var scrollProgressLastFire = 0;
    var SCROLL_PROGRESS_THROTTLE_MS = 500;

    function fireScrollReport() {
        scrollTrailingTimer = null;
        // A trailing timer scheduled before the document went hidden can
        // fire during the backgrounding snapshot window — the layout it
        // would read is the snapshot's, not the user's (#272).
        if (document.hidden) return;
        // SCROLL-mode reporter only — paged mode reports through
        // reportPagePosition. Without this bail the first scroll→paged
        // switch fired it from the restore's programmatic scrolls
        // (lastSavedScrollY still held the scroll-mode value, so the
        // |0 − old| > 20 gate passed), overwriting the anchor from a
        // half-settled layout and killing the just-frozen resize anchor
        // via invalidateStickyAnchor (#272 audit).
        if (isPaged()) return;
        const currentScrollY = window.scrollY;
        if (Math.abs(currentScrollY - lastSavedScrollY) > 20) {
            // Genuine user scroll moved us → drop the frozen settings anchor (#82).
            invalidateStickyAnchor();
            lastSavedScrollY = currentScrollY;
            const pos = getCurrentPosition();
            lastKnownXpath = pos.xpath;
            lastKnownProgress = pos.progress;
            // Save how far into the element the viewport top is — from
            // the node the position was read off, not a second lookup of
            // the path just built from it (#852).
            if (pos.node && pos.xpath && pos.xpath !== '/html/body') {
                var rect = pos.node.getBoundingClientRect();
                var h = rect.height;
                lastKnownElementFraction = h > 0 ? Math.max(0, -rect.top) / h : 0;
            }
            if (window.webkit && window.webkit.messageHandlers.positionUpdate) {
                var scrollH = pos.scrollHeight || document.body.scrollHeight;
                var viewportRatio = scrollH > 0 ? window.innerHeight / scrollH : 1;
                window.webkit.messageHandlers.positionUpdate.postMessage({
                    xpath: pos.xpath,
                    charOffset: pos.charOffset,
                    scrollY: pos.scrollY,
                    progress: pos.progress,
                    viewportRatio: viewportRatio
                });
            }
        }
    }

    // The light report: where the scroll stands as a fraction, read off
    // the scroll position alone. Nothing here touches the DOM tree.
    function fireScrollProgress() {
        scrollProgressTimer = null;
        if (document.hidden || isResizing || isPaged()) return;
        scrollProgressLastFire = Date.now();
        var scrollH = document.body.scrollHeight;
        var total = scrollH - window.innerHeight;
        var progress = wholeBookOnScreen(false) ? 1 : total > 0 ? window.scrollY / total : 0;
        if (window.webkit && window.webkit.messageHandlers.positionUpdate) {
            window.webkit.messageHandlers.positionUpdate.postMessage({
                light: true,
                progress: Math.min(1.0, Math.max(0.0, progress)),
                viewportRatio: scrollH > 0 ? window.innerHeight / scrollH : 1
            });
        }
    }

    // The settle check: still where we were when the wait began → the
    // page has stopped, report in full. Moved → a fling still in flight
    // whose scroll events came sparsely; wait again.
    function checkScrollSettled() {
        scrollTrailingTimer = null;
        // Arrow-key line scrolling: a loop still in flight, or a press
        // within the last LINE_SCROLL_SETTLE_MS, means the reader is
        // stepping through lines — the full report waits for the run to
        // end, not for the gap between two presses.
        var sinceKey = Date.now() - _lastLineScrollAt;
        // A key-up that never reached the page (a modifier pressed on the
        // way out, a sheet) must not hold the report forever: repeats stop
        // arriving, and a quiet second says the key is up.
        if (_nativeKeyHeld && sinceKey > 1500) _nativeKeyHeld = false;
        if (_scrollLineRAF !== null || _nativeKeyHeld || sinceKey < LINE_SCROLL_SETTLE_MS) {
            scrollSettleY = window.scrollY;
            scrollTrailingTimer = setTimeout(checkScrollSettled,
                Math.max(SCROLL_SETTLE_MS, LINE_SCROLL_SETTLE_MS - sinceKey));
            return;
        }
        if (window.scrollY !== scrollSettleY) {
            scrollSettleY = window.scrollY;
            scrollTrailingTimer = setTimeout(checkScrollSettled, SCROLL_SETTLE_MS);
            return;
        }
        fireScrollReport();
    }

    function onScroll() {
        // During resize, reflow causes scroll events — ignore them so they
        // don't overwrite the xpath we captured at resize start
        if (isResizing) return;
        // Hidden document: any scroll is a side effect of the snapshot
        // relayout, not the user — never let it into position state (#272).
        if (document.hidden) return;

        if (!_nativeKeyHeld) {
            var now = Date.now();
            var elapsed = now - scrollProgressLastFire;
            if (elapsed >= SCROLL_PROGRESS_THROTTLE_MS) {
                fireScrollProgress();
            } else if (scrollProgressTimer === null) {
                scrollProgressTimer = setTimeout(fireScrollProgress, SCROLL_PROGRESS_THROTTLE_MS - elapsed);
            }
        } else if (scrollProgressTimer !== null) {
            clearTimeout(scrollProgressTimer);
            scrollProgressTimer = null;
        }

        clearTimeout(scrollTrailingTimer);
        scrollSettleY = window.scrollY;
        scrollTrailingTimer = setTimeout(checkScrollSettled, SCROLL_SETTLE_MS);
    }

    // --- Resize handling ---
    // Hide content at the start of a resize burst, restore by xpath when it ends.
    // We use lastKnownXpath (set by the last stable scroll event) rather than calling
    // getCurrentPosition() at resize start, which could be mid-reflow and unreliable.
    // We also cancel any pending scroll debounce so it can't overwrite lastKnownXpath
    // while isResizing is true (the timer callback doesn't check isResizing).

    let resizeTimer = null;
    let resizeSafetyTimer = null;
    /// applySettings' 400ms fade-back safety (#272 audit) — tracked so a
    /// resize burst or visibility return can cancel it instead of letting
    /// a stale fire force-clear isResizing mid-burst.
    var _applySafetyTimer = null;
    // Frozen anchor for entire resize sequence — prevents error accumulation
    var _resizeAnchorXpath = null;
    var _resizeAnchorProgress = 0;
    var _resizeAnchorFraction = 0;
    var _resizeAnchorCleanup = null;
    /// When the frozen anchor was written (#291): orphaned anchors (release
    /// timer killed by visibility churn) must not be trusted forever.
    var _resizeAnchorFrozenAt = 0;
    // How long the frozen anchor survives after a *settings* apply (#82). In
    // paged mode each font-size / paragraph-spacing change reflows the columns,
    // so the paragraph at the top of the page shifts; re-capturing on every
    // change makes the position creep forward as you nudge a slider. Holding
    // the first change's anchor across the adjustment burst restores every
    // reflow to the SAME spot. Invalidated on genuine user navigation (see
    // invalidateStickyAnchor) so read → scroll → adjust still captures fresh.
    var _settingsAnchorTTL = 4000;

    // True while a column-count flip sequence is in flight (#272; it was
    // the page↔twoPage flip before #864): iPad
    // rotation = applySettings(mode flip) + window.resize interleaved, and
    // BOTH orientations of the round-trip must restore to the SAME frozen
    // anchor. onResize's default 500ms anchor release killed it between
    // the two rotations, so the return leg re-anchored to the new page
    // top — one spread backwards per rotation cycle. While this flag is
    // set the anchor survives _settingsAnchorTTL instead.
    var _pagedFlipAnchorHold = false;

    /// Single scheduler for the frozen-anchor release. Always cancels the
    /// previous timer first — assigning a new setTimeout id over the old
    /// one ORPHANS it (still fires!), and an orphaned release from one
    /// rotation cycle was silently killing the anchor re-frozen by the
    /// next cycle (#272).
    function scheduleAnchorRelease(ms) {
        clearTimeout(_resizeAnchorCleanup);
        _resizeAnchorCleanup = setTimeout(function() {
            _resizeAnchorXpath = null;
            _resizeAnchorProgress = 0;
            _resizeAnchorFraction = 0;
            _pagedFlipAnchorHold = false;
        }, ms);
    }

    // Drop the frozen settings/resize anchor — called from real user
    // navigation (page turn / scroll) so a later settings tweak doesn't reuse
    // a now-stale anchor. No-op cost when nothing is frozen.
    /// Forget the anchor a coming reflow would restore to. Any DELIBERATE
    /// travel — a bookmark, a chapter, a lens's Cancel — makes that anchor
    /// a memory of somewhere the reader has just left, and the next resize
    /// (a keyboard going away, a panel closing) would drag them back to it
    /// with the "Restoring position…" overlay on top (user, 2026-09-07).
    /// The initial restore owns the anchor until it has finished, so this
    /// leaves it alone until then.
    function clearPendingAnchor() {
        if (isInitialRestorePending) return;
        _pendingAnchor = null;
        _pendingAnchorProgress = 0;
    }

    function invalidateStickyAnchor() {
        _pagedFlipAnchorHold = false;
        if (_resizeAnchorXpath === null) return;
        _resizeAnchorXpath = null;
        _resizeAnchorProgress = 0;
        _resizeAnchorFraction = 0;
        clearTimeout(_resizeAnchorCleanup);
    }

    // While a fullscreen SHEET is up (#820) the host freezes resizes: the
    // sheet's field blinking its keyboard makes WebKit shrink the layout
    // viewport and fire a resize the page has no business answering —
    // it dimmed, blurred and repaginated behind every mode switch (user,
    // 2026-09-04). Unfreezing runs ONE relayout if the size really moved.
    var _resizeFrozen = false;
    var _lastLaidW = 0, _lastLaidH = 0;

    // Freezing stops US from answering a resize; it does not stop WebKit
    // from relaying the columns out. A sheet's keyboard shrinks the layout
    // viewport, the page repaginates on its own, and the reader watched
    // the text behind the sheet slide by a column a second after it opened
    // (user, 2026-09-07, iPad). So while frozen we HOLD the place instead
    // of ignoring the resize: the same anchor the visible path takes,
    // restored once the layout settles, and silent — none of the dim, the
    // blur or the reports, which is what the freeze was protecting.
    var _frozenHoldXpath = null, _frozenHoldProgress = 0, _frozenHoldFraction = 0;
    var _frozenHoldTimer = null;

    function clearFrozenHold() {
        clearTimeout(_frozenHoldTimer);
        _frozenHoldTimer = null;
        _frozenHoldXpath = null;
        _frozenHoldProgress = 0;
        _frozenHoldFraction = 0;
    }

    function holdFrozenPlace() {
        if (document.hidden) return;
        // Taken ONCE per burst, before the relayout has moved anything.
        if (_frozenHoldXpath === null) {
            _frozenHoldXpath = lastKnownXpath;
            _frozenHoldProgress = lastKnownProgress;
            _frozenHoldFraction = lastKnownElementFraction;
        }
        clearTimeout(_frozenHoldTimer);
        _frozenHoldTimer = setTimeout(function() {
            if (!_resizeFrozen) { clearFrozenHold(); return; }
            var xp = _frozenHoldXpath || lastKnownXpath;
            var pr = _frozenHoldXpath ? _frozenHoldProgress : lastKnownProgress;
            var fr = _frozenHoldFraction;
            try {
                if (isPaged()) {
                    applyPagingCSS();
                    computeTotalPages();
                    restorePositionPaged(xp, pr);
                } else if (xp && xp !== '/html/body') {
                    var node = getNodeByXPath(xp);
                    if (node) {
                        var rect = node.getBoundingClientRect();
                        window.scrollTo(0, rect.top + window.scrollY + fr * rect.height);
                    }
                }
            } catch (e) {
                jsLog('frozen hold failed: ' + e);
            }
            clearFrozenHold();
        }, 160);
    }

    function onResize() {
        // Cheap, and the only witness to a reflow nobody asked for: the
        // page behind a sheet moving is always a resize somewhere.
        jsLog('resize ' + Math.round(window.innerWidth) + 'x' +
              Math.round(window.innerHeight) + (_resizeFrozen ? ' [frozen]' : ''));
        if (_resizeFrozen) { holdFrozenPlace(); return; }
        _lastResizeEventAt = Date.now();
        // Backgrounding snapshot resize (#272): iPadOS lays the scene out
        // at other sizes to snapshot for the app switcher. Nothing here is
        // user-visible, and the debounced timers race web-process
        // suspension — a restore could consume the anchor at a geometry
        // that stops existing on resume. Ignore entirely; the
        // visibility-return pass re-applies the paged CSS at the real
        // geometry and restores the hide-time anchor.
        if (document.hidden) {
            // The snapshot pass is about to relayout the DOM at a size the
            // user never sees. Hide the body so no post-resume frame can
            // flash that layout scaled to the real window ("huge text").
            // Invisible right now (the switcher card was snapshotted at
            // the true size BEFORE backgrounding); revealed by the
            // visibility-return pass.
            if (!_hiddenResizeSeen) {
                _hiddenResizeSeen = true;
                document.body.style.transition = 'none';
                document.body.style.opacity = '0';
            }
            return;
        }
        // Freeze position ONCE at the start of the resize sequence
        if (!_resizeAnchorXpath) {
            _resizeAnchorXpath = lastKnownXpath;
            _resizeAnchorProgress = lastKnownProgress;
            _resizeAnchorFraction = lastKnownElementFraction;
            _resizeAnchorFrozenAt = Date.now();
        }
        clearTimeout(_resizeAnchorCleanup);

        if (!isResizing) {
            isResizing = true;
            clearTimeout(scrollTimer);
            scrollTimer = null;
            clearTimeout(scrollTrailingTimer);
            scrollTrailingTimer = null;
            // The resize burst owns the opacity/isResizing lifecycle now —
            // a stale applySettings fade-back safety must not fire into it
            // (#272 audit). The burst's own 600ms safety covers unblur.
            clearTimeout(_applySafetyTimer);
            document.body.style.transition = 'none';
            document.body.style.opacity = '0.15';
            document.body.style.filter = 'blur(6px)';
        }

        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
          // The reveal is in a `finally` (#764 r19, user: the page went
          // blank after a search until the window was dragged): this body
          // dims to 0.15 on the way in, and ANY throw between here and the
          // fade-back — a paging pass over freshly wrapped <mark> nodes,
          // a missing anchor — left the text dimmed with nothing to undim
          // it but another resize.
          try {
            // FS toggle path: Swift hits `updateFullscreenFlag` (which
            // mutates `lastAppliedSettings.isFullscreen` in place) and
            // then the natural viewport resize lands here. Re-apply
            // the Norton frame so its `ti`/`bt` get recomputed for the
            // new FS state — otherwise the cyan rim and its body
            // padding-top stay at the previous FS-tuned values and
            // visually slide off-position. Cheap when Norton is off
            // (early-returns inside applyNortonFrame).
            if (lastAppliedSettings) {
                var _na = !!lastAppliedSettings.nortonFrame;
                applyNortonFrame(lastAppliedSettings, _na);
                _na = frameIsOn(lastAppliedSettings, _na);
                // Scroll-mode edge masks need to match the new frame
                // insets — they cover the strip outside the cyan rim
                // with the page bg colour so scrolled-out content
                // doesn't peek out above the top line / below the
                // bottom one. Cheap; no-op in paged mode.
                applyScrollMasks(_na);
                // Trailing re-assert after the resize settles (#94).
                scheduleNortonRebuild();
            }
            // Comfort's measure follows the width (#915): the padding is
            // settled again before the columns are.
            if (_comfort && lastAppliedSettings) {
                var _cp = comfortPadding(isPaged(), lastAppliedSettings.pageColumns);
                document.body.style.paddingLeft = _cp + 'px';
                document.body.style.paddingRight = _cp + 'px';
                if (!isPaged()) postPageLayout();
            }
            if (isPaged()) {
                applyPagingCSS();
                // The resize anchor can be cleared mid-flight by a mode-flip
                // applySettings that ran alongside this resize — on iPad a
                // rotation fires window.resize together with the Swift-driven
                // page↔twoPage flip (#3), and that flip's modeChanged branch
                // nulls _resizeAnchorXpath before this trailing timer consumes
                // it. Falling back to the live last-known position (which the
                // flip's own restore already set to the correct spread) keeps
                // us put instead of restoring to page 0.
                var rXpath = _resizeAnchorXpath || lastKnownXpath;
                var rProgress = _resizeAnchorXpath ? _resizeAnchorProgress : lastKnownProgress;
                restorePositionPaged(rXpath, rProgress);
            } else if (_resizeAnchorXpath && _resizeAnchorXpath !== '/html/body') {
                var node = getNodeByXPath(_resizeAnchorXpath);
                if (node) {
                    var rect = node.getBoundingClientRect();
                    var absTop = rect.top + window.scrollY;
                    var offset = _resizeAnchorFraction * rect.height;
                    window.scrollTo(0, absTop + offset);
                }
            }
          } catch (e) {
            jsLog('resize pass failed: ' + e);
          } finally {
            isResizing = false;

            // Unblur and fade back in
            document.body.style.transition = 'opacity 0.2s ease, filter 0.2s ease';
            document.body.style.opacity = '1';
            document.body.style.filter = 'blur(0px)';
            setTimeout(function() {
                document.body.style.transition = '';
                document.body.style.filter = '';
            }, 250);
          }

            // Release frozen anchor after a delay — if more resize events come,
            // they'll keep using the same anchor (onResize clears this timer).
            // During a column-count flip sequence hold it for the full
            // settings TTL so the rotation's return leg reuses it (#272).
            scheduleAnchorRelease(_pagedFlipAnchorHold ? _settingsAnchorTTL : 500);
        }, 150);

        // Safety: guarantee unblur after max 600ms even if resize events keep firing
        clearTimeout(resizeSafetyTimer);
        resizeSafetyTimer = setTimeout(function() {
            if (isResizing) {
                isResizing = false;
                document.body.style.transition = 'opacity 0.2s ease, filter 0.2s ease';
                document.body.style.opacity = '1';
                document.body.style.filter = 'blur(0px)';
                setTimeout(function() {
                    document.body.style.transition = '';
                    document.body.style.filter = '';
                }, 250);
            }
        }, 600);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    // Double-click toggles fullscreen on macOS only (whitespace double-click,
    // not on selectable text). Touch devices have the Fullscreen button (their
    // centre tap zone is gone, #1093) — dblclick is intentionally not handled
    // there to avoid the page-turn-before-double-tap problem.
    document.addEventListener('dblclick', function(e) {
        if ('ontouchstart' in window) return;
        // A picture's box: its note, not the page whole (#1057).
        var dblMark = e.target.closest ? e.target.closest('._cr_mark') : null;
        if (dblMark) { markPost({ kind: 'open', id: dblMark.getAttribute('data-mark') }); return; }
        // A page of pictures (#945): the page under the double click,
        // whole and zoomable, in the gallery's preview.
        if (_pages) { postPageZoom(pageImageAt(e.clientX, e.clientY)); return; }
        var tag = e.target.tagName.toLowerCase();
        if (tag === 'a' || tag === 'button' || tag === 'input' || tag === 'textarea') return;
        setTimeout(function() {
            var sel = window.getSelection();
            if (sel && !sel.isCollapsed) return;
            if (window.webkit && window.webkit.messageHandlers.toggleFullscreen) {
                window.webkit.messageHandlers.toggleFullscreen.postMessage({});
            }
        }, 50);
    }, { passive: true });

    // --- Tap zones ---

    var lastTapTime = 0;
    document.addEventListener('click', function(e) {
        // #837 — a tap in selection mode places the caret; it does not
        // turn a page.
        if (selectionMode) return;
        // A picture's mark (#1057): its note, not a turn; and the click
        // that ends a drawn box is the box's.
        if (_markSuppressClick) { _markSuppressClick = false; return; }
        var markEl = e.target.closest ? e.target.closest('._cr_mark') : null;
        if (_markActiveId && (!markEl || markEl.getAttribute('data-mark') !== _markActiveId)) {
            markSetActive(null);
            if (!markEl) return;
        }
        if (markEl) {
            // The Mac's click takes the box into the keys; its note is
            // the double click's, Return's or the menu's. On touch the
            // first tap takes it — its corners out, a finger's reach, its
            // body and corners in hand at once — and a tap on the box
            // taken is its note (user, 2026-11-06: a tap went straight to
            // the note, and a box could not be sized).
            var markId = markEl.getAttribute('data-mark');
            if (!('ontouchstart' in window) || _markActiveId !== markId) { markSetActive(markId); return; }
            markPost({ kind: 'open', id: markId });
            return;
        }
        // Ignore interactive elements
        var tag = e.target.tagName.toLowerCase();
        if (tag === 'a' || tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select') return;

        // Ignore if there's a text selection
        var sel = window.getSelection();
        if (sel && !sel.isCollapsed) return;

        // Debounce rapid taps
        var now = Date.now();
        if (now - lastTapTime < 350) return;
        lastTapTime = now;

        pageTapAt(e.clientX, e.clientY);
    }, { passive: true });

    /// The zones, for a point in the page's own coordinates — the click
    /// above, and a tap the reader forwards from something standing on
    /// the page (#898: the reading line in the gutter, on touch, which
    /// covered the centre zone at two columns).
    function pageTapAt(x, y) {
        var w = window.innerWidth;
        var h = window.innerHeight;

        // On macOS (no touch), limit tap zones to padding margins
        // so clicks on text allow selection for translation/bookmarks
        var isMacDesktop = !('ontouchstart' in window);

        // The app's own strip at the top (#837) — its zone, not the page's.
        if (topReservedZone > 0 && y < h * topReservedZone) return;

        // No centre zone on touch any more (#1093, user, 2026-11-08): it
        // toggled fullscreen by accident and could not be found on
        // purpose. Fullscreen is a button now, and the centre is page.

        // Page-turn zones only apply in paged mode
        if (!isPaged()) return;

        // invertTapZones mirrors the page-turn zones (left↔right / top↔bottom)
        // for left-handed use or a different grip.
        // An rtl book (#945) turns the other way: the next page is to the
        // left. The user's own inversion stacks on top.
        var mirror = invertTapZones !== pagesRTL();
        var tapNext = mirror ? prevPage : nextPage;
        var tapPrev = mirror ? nextPage : prevPage;

        if (pageTapZone === 'vertical') {
            // Vertical: top 50% = next (thumb reach up), bottom 50% = prev
            if (y < h * 0.5) {
                tapNext();
            } else {
                tapPrev();
            }
        } else if (isMacDesktop) {
            // macOS: click zones only in padding margins
            var pad = Math.max(20, parseInt(document.body.style.paddingLeft) || 0);
            if (x < pad) {
                tapPrev();
            } else if (x > w - pad) {
                tapNext();
            }
            // Click on text content: do nothing (allow selection)
        } else {
            // iOS: full-width tap zones
            if (x < w * 0.5) {
                tapPrev();
            } else {
                tapNext();
            }
        }
    }

    // --- Footnote popup support ---

    function findFootnoteAnchor(el) {
        while (el && el !== document.body) {
            if (el.classList && el.classList.contains('footnote-ref')) {
                return el;
            }
            if (el.dataset && el.dataset.footnoteId) {
                return el;
            }
            el = el.parentElement;
        }
        return null;
    }

    function showFootnotePopup(content, x, y, anchorLabel) {
        hideFootnotePopup();

        // Strip the note number heading (h2/h3 from section title) — keep only the body text
        var tmp = document.createElement('div');
        tmp.innerHTML = content;
        var headings = tmp.querySelectorAll('h1, h2, h3');
        headings.forEach(function(h) { h.remove(); });
        // Also strip nested <section> wrappers — unwrap their children
        var sections = tmp.querySelectorAll('section');
        sections.forEach(function(s) { s.replaceWith.apply(s, Array.from(s.childNodes)); });
        var cleanContent = tmp.innerHTML.trim();
        if (!cleanContent) cleanContent = content; // fallback

        var overlay = document.createElement('div');
        overlay.id = '_cr_footnote_overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; z-index:99998; background:transparent;';
        overlay.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            hideFootnotePopup();
        });

        var popup = document.createElement('div');
        popup.id = '_cr_footnote_popup';
        popup.innerHTML = '<div class="_cr_fn_content">' + cleanContent + '</div>';

        // Position: try below click, then above if not enough space
        var maxW = Math.min(500, window.innerWidth * 0.8);
        var maxH = window.innerHeight * 0.4;
        var bodyFS = parseFloat(getComputedStyle(document.body).fontSize) || 18;
        var fnFS = Math.max(12, Math.round(bodyFS * 0.8));
        popup.style.cssText = 'position:fixed; z-index:99999; max-width:' + maxW + 'px; max-height:' + maxH + 'px; overflow-y:auto; border-radius:8px; padding:12px 14px; box-shadow:0 4px 20px rgba(0,0,0,0.3); opacity:0; transition:opacity 0.15s ease; font-size:' + fnFS + 'px; line-height:1.5;';

        // Use html element background (body is transparent, html has the real bg)
        var htmlBg = getComputedStyle(document.documentElement).backgroundColor || 'rgb(255,255,255)';
        var textColor = getComputedStyle(document.body).color;
        var bgMatch = htmlBg.match(/\d+/g);
        var r = bgMatch ? parseInt(bgMatch[0]) : 255;
        var g = bgMatch ? parseInt(bgMatch[1]) : 255;
        var b = bgMatch ? parseInt(bgMatch[2]) : 255;
        var lum = (r*299 + g*587 + b*114) / 1000;
        // Offset like drawer background — slightly darker for light, slightly lighter for dark
        var off = lum > 128 ? -18 : 30;
        var popupBg = 'rgb(' + Math.max(0,Math.min(255,r+off)) + ',' + Math.max(0,Math.min(255,g+off)) + ',' + Math.max(0,Math.min(255,b+off)) + ')';
        // Norton/Terminal theme: Turbo Vision dialog style
        var isNorton = !!document.getElementById('_norton_border');
        if (isNorton) {
            popup.style.background = _nortonColors.plate;
            popup.style.color = '#000000';
            popup.style.borderRadius = '0';
            popup.style.padding = '10px 6px 6px 6px';
            popup.style.boxShadow = '10px 10px 0 rgba(0,0,0,0.55)';
            popup.style.fontFamily = 'Menlo, monospace';
            // Inner border with padding — emulates ASCII box drawing with margin
            var fnContent = popup.querySelector('._cr_fn_content');
            fnContent.style.cssText = 'border: 3px double ' + _nortonColors.ink + '; padding: 10px 12px; margin-bottom: 4px; position: relative;';
            // Anchor label on top border — like Turbo Vision dialog title
            if (anchorLabel) {
                var label = document.createElement('span');
                label.textContent = ' ' + anchorLabel + ' ';
                label.style.cssText = 'position:absolute; top:-10px; left:8px; background:' + _nortonColors.plate + '; color:' + _nortonColors.hit + '; font-size:12.5px; line-height:16px; padding:0 4px;';
                fnContent.appendChild(label);
            }
        } else {
            popup.style.background = popupBg;
            popup.style.color = textColor;
            popup.style.border = '1px solid ' + (lum > 128 ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)');
        }

        // Click on popup dismisses it (stopPropagation prevents page turn)
        popup.addEventListener('click', function(e) {
            e.stopPropagation();
            hideFootnotePopup();
        });
        popup.addEventListener('mousedown', function(e) {
            e.stopPropagation();
        });

        document.body.appendChild(overlay);
        document.body.appendChild(popup);

        // Calculate position after render
        requestAnimationFrame(function() {
            var pRect = popup.getBoundingClientRect();
            var left = Math.min(Math.max(8, x - pRect.width / 2), window.innerWidth - pRect.width - 8);
            var top;
            if (y + 20 + pRect.height < window.innerHeight - 8) {
                top = y + 20;
            } else if (y - 20 - pRect.height > 8) {
                top = y - 20 - pRect.height;
            } else {
                top = Math.max(8, (window.innerHeight - pRect.height) / 2);
            }
            popup.style.left = left + 'px';
            popup.style.top = top + 'px';
            popup.style.opacity = '1';
        });

        // Escape key dismiss
        document.addEventListener('keydown', _fnEscHandler);
    }

    function hideFootnotePopup() {
        var overlay = document.getElementById('_cr_footnote_overlay');
        var popup = document.getElementById('_cr_footnote_popup');
        if (overlay) overlay.remove();
        if (popup) popup.remove();
        document.removeEventListener('keydown', _fnEscHandler);
    }

    function _fnEscHandler(e) {
        if (e.key === 'Escape') {
            hideFootnotePopup();
        }
    }

    // Footnote click handler (before paged tap zones)
    document.addEventListener('click', function(e) {
        // Already showing a popup? Dismiss it on any click.
        if (document.getElementById('_cr_footnote_popup')) {
            hideFootnotePopup();
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        var anchor = findFootnoteAnchor(e.target);
        if (!anchor) return;

        e.preventDefault();
        e.stopPropagation();

        var noteId = anchor.dataset.footnoteId || '';
        if (!noteId) {
            var href = anchor.getAttribute('href') || '';
            if (href.startsWith('#')) noteId = href.substring(1);
        }
        if (!noteId) return;

        var fnContainer = document.getElementById('_cr_footnotes');

        // Markers that point at each other (the fb2→epub layout: the note's
        // "[1]" links back to the "[1]" in the text) resolve to an inline
        // anchor, not a note body. Which way we are going decides what
        // happens: a target that OPENS its paragraph is a note → popup with
        // that paragraph; a target sitting mid-sentence is the place in the
        // text → travel back to it. (user, 2026-09-11)
        var visible = document.getElementById(noteId);
        if (visible && !(fnContainer && fnContainer.contains(visible))) {
            // The target lives in the FLOW, not in the notes container: an
            // inline marker, or (FB2 with notes in the main body, #859) the
            // paragraph itself. A paragraph that OPENS with a marker is a
            // note → popup with the paragraph; anything else is the place
            // in the text → travel there.
            var para = visible.tagName === 'A' ? visible.closest('p, li, dd, td, div') : visible;
            var first = para ? para.firstChild : null;
            while (first && first.nodeType === 3 && !first.textContent.trim()) first = first.nextSibling;
            var opensWithMarker = first && first.nodeType === 1 && first.classList
                && first.classList.contains('footnote-ref');
            if (para && opensWithMarker && (visible.tagName !== 'A' || first === visible)) {
                var clone = para.cloneNode(true);
                var lead = clone.querySelector('a.footnote-ref');
                if (lead) lead.remove();
                showFootnotePopup(clone.innerHTML, e.clientX, e.clientY, anchor.textContent.trim());
            } else {
                scrollToElementId(noteId);
            }
            return;
        }

        // Look up footnote content: first in hidden container, then anywhere in DOM
        var noteEl = null;
        if (fnContainer) {
            noteEl = fnContainer.querySelector('[id="' + noteId + '"]');
        }
        if (!noteEl) {
            noteEl = visible;
        }
        if (!noteEl) return;

        showFootnotePopup(noteEl.innerHTML, e.clientX, e.clientY, anchor.textContent.trim());
    }, { capture: true });

    // Dismiss footnote popup on scroll
    window.addEventListener('scroll', function() {
        if (document.getElementById('_cr_footnote_popup')) {
            hideFootnotePopup();
        }
    }, { passive: true });

    // Snap to nearest page in paged mode after scroll settles
    // (catches trackpad momentum that drifts between page boundaries)
    var pageSnapTimer = null;
    window.addEventListener('scroll', function() {
        if (!isPaged()) return;
        clearTimeout(pageSnapTimer);
        pageSnapTimer = setTimeout(function() {
            // Only genuine user drift qualifies — during a resize/settings
            // reflow or while hidden (app-switch snapshot churn) the scroll
            // events are layout side effects, and snapping there would
            // stamp a garbage page into position state (#272).
            if (isResizing || document.hidden) return;
            // Nor a turn on its way (2026-10-24): a frame stalled past
            // 120 ms mid-slide is not drift, and snapping there stops
            // the turn short of its spread.
            if (Date.now() < _animatedTurnUntil) return;
            var pageW = getPageWidth();
            if (pageW <= 0) return;
            var scrollX = document.documentElement.scrollLeft;
            var nearestPage = xToPage(scrollX);
            if (Math.abs(scrollX - pageToX(nearestPage)) > 2) {
                goToPageInstant(nearestPage);
            }
        }, 120);
    }, { passive: true });

    // While WebKit itself scrolls under a held arrow (nativeLineKeys), the
    // light report stays quiet (#860 r4): each one is a message to the app
    // and a reader re-render on its main thread, and the app's main thread
    // is also where WebKit's frames get committed to the screen — Safari,
    // which posts nothing, glides on the same page. One report on key-up.
    var _nativeKeyHeld = false;
    document.addEventListener('keyup', function(e) {
        if (!_nativeKeyHeld) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            _nativeKeyHeld = false;
            _lastLineScrollAt = Date.now();
            fireScrollProgress();
            clearTimeout(scrollTrailingTimer);
            scrollSettleY = window.scrollY;
            scrollTrailingTimer = setTimeout(checkScrollSettled, SCROLL_SETTLE_MS);
        }
    }, { passive: true });

    // --- Keyboard handling for paged mode ---

    // The reader's hardware keys on the iPad (2026-09-16, user: "⎋⎋ and
    // h have to work on the iPad with a keyboard too"). The Mac reads them
    // off an NSEvent monitor before the page ever sees them; the iPad has
    // no monitor, and the page is the first responder while the book is
    // read — so the page reports every key it sees and the reader does
    // there what the monitor does here: `h` (by its physical key, any
    // layout) toggles quiet, any other key wakes it, ⎋⎋ closes the panels
    // or brings up the selector. Only where the reader listens: the
    // handler is registered on iOS alone. Modifier keys on their own are
    // not keys (the Mac never sees them as keyDown either).
    var _modifierKeys = { Shift: 1, Meta: 1, Control: 1, Alt: 1, CapsLock: 1 };
    function reportKeyToReader(e) {
        var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.readerKey;
        if (!h || _modifierKeys[e.key]) return false;
        h.postMessage({ key: e.key, code: e.code || '', meta: !!e.metaKey, ctrl: !!e.ctrlKey,
                        alt: !!e.altKey, shift: !!e.shiftKey, repeat: !!e.repeat, ts: e.timeStamp / 1000 });
        return true;
    }
    // While the panel selector stands (#883) the keys that walk and pick
    // it are the reader's, not the page's — an arrow must not turn the
    // page under the card. Everything else goes on as usual, so a panel's
    // F-key still opens the panel through the card.
    var keysToReader = false;
    var _selectorKeys = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, ' ': 1, Enter: 1, Escape: 1 };

    document.addEventListener('keydown', function(e) {
        // Don't intercept when typing in input fields
        var tag = (e.target || {}).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        if (reportKeyToReader(e)) {
            var bare = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
            if (keysToReader && _selectorKeys[e.key]) { e.preventDefault(); return; }
            // Quiet's letter (#887): taken here, so nothing further down
            // the chain gets a letter the reader has spoken for.
            if (bare && e.code === 'KeyH') { e.preventDefault(); return; }
        }

        if (!isPaged()) {
            // Scroll mode: own Up/Down here, exactly like the paged branch
            // below owns its keys. Without the preventDefault, an iPad with
            // a hardware keyboard DOUBLE-drives the scroll — WKWebView's
            // native UIScrollView arrow scrolling animates alongside our
            // scrollByLine (via the Swift shortcut path), and the two
            // animators fight over scrollY in a visible ±1px jitter (#273).
            // Ownership is exclusive per platform: when the WebView is the
            // first responder (iPad hardware keyboard) this handler
            // consumes the event and the Swift shortcut never fires; on
            // macOS the shortcut system consumes it first and this handler
            // never sees it — same rule the paged branch already relies on.
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp')
                && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
                // The Mac hands these keys to WebKit's own line scrolling
                // (#860): the reader's monitor delivers them straight to
                // the web view, and the default action — animated on the
                // scrolling thread, tiles prefetched as for the wheel — is
                // the one that glides under a held key. Nothing to do here
                // but stay out of the way.
                if (nativeLineKeys && scrollAnimation) {
                    // Every repeat re-stamps the press: WebKit's animation
                    // runs in segments, and a scroll-event gap between two
                    // segments read as "settled" — a FULL report (the
                    // xpath probe, the reader rebuild) per segment was the
                    // step in the glide (#860 r5). The full report waits
                    // for the key to be up and the page still.
                    _nativeKeyHeld = true;
                    _lastLineScrollAt = Date.now();
                    return;
                }
                e.preventDefault();
                scrollByLine(e.key === 'ArrowDown' ? 1 : -1);
                return;
            }
            // ← / → when the page holds the keys (#1039): the reader's
            // `pageRight`/`pageLeft`, a viewport a press — right is back in
            // a book read right to left.
            if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft')
                && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
                e.preventDefault();
                scrollPage(sideIsForward(e.key) ? 1 : -1);
                return;
            }
            // The page keys (2026-09-22): the same step WebKit takes,
            // with the mark where the eye left off.
            if ((e.key === ' ' || e.key === 'PageDown' || e.key === 'PageUp')
                && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                scrollPage((e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) ? -1 : 1);
            }
            return;
        }

        switch (e.key) {
            case ' ':         // Space
            case 'Enter':     // Return
            case 'ArrowDown': // Down arrow — same as right
                e.preventDefault();
                nextPage(true);
                break;
            case 'Backspace': // Delete
            case 'ArrowUp':   // Up arrow — same as left
                e.preventDefault();
                prevPage(true);
                break;
            // ← / → (#1039) where the page has the keys — the iPad's
            // hardware keyboard with the web view first responder, as ↑/↓
            // above. On the Mac the reader's hidden buttons take them even
            // then, as key equivalents, and this never sees them.
            case 'ArrowRight':
            case 'ArrowLeft':
                if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) break;
                e.preventDefault();
                if (sideIsForward(e.key)) nextPage(); else prevPage();
                break;
        }
    });

    /// The reader's `pageRight`/`pageLeft` (#945): in a book read right to
    /// left the right is the page before.
    function sideIsForward(key) {
        var rtl = !!(_pages && _pages.rtl) || nativeRTLText();
        return (key === 'ArrowRight') !== rtl;
    }

    // --- Trackpad / mouse wheel for paged mode ---

    var wheelAccum = 0;
    // 0 = ready; else the HAND's way at the fire — the sign of deltaX,
    // which the direction-change test below reads — never the book's
    // forward (user, 2026-11-06: a swipe in a right-to-left book turned
    // two: forward there is a push to the right, deltaX < 0, so a fire
    // stored as +1 took the swipe's own momentum for a reversal and,
    // past the lock, turned again).
    var wheelFiredDir = 0;
    var wheelIdleTimer = null;
    // One swipe, one page (#879, user: a swipe turned two): after a
    // fire, the momentum's tail is ignored for a while — its gaps ran
    // past the 60 ms idle reset and armed a second turn.
    var wheelLockUntil = 0;

    document.addEventListener('wheel', function(e) {
        if (!isPaged()) return;
        e.preventDefault();
        if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 0.5) return;

        // Ignore weak events (momentum decay has small deltas)
        if (Math.abs(e.deltaX) < 4) return;

        // Reset after an idle gap — real gestures have gaps between them,
        // momentum is continuous ~16ms. After a fire the gap has to be
        // longer (#879, user: a swipe turned two): the momentum's tail
        // thins past 60 ms between events, the reset re-armed the
        // accumulator, and the tail's leftovers added up to a second
        // turn. The lock below keeps the tail out; the timer must keep
        // re-arming through it, or it fires mid-tail.
        clearTimeout(wheelIdleTimer);
        wheelIdleTimer = setTimeout(function() {
            wheelAccum = 0;
            wheelFiredDir = 0;
        }, wheelFiredDir !== 0 ? 300 : 60);
        if (Date.now() < wheelLockUntil) return;

        // Already fired this gesture — only unlock on direction change
        if (wheelFiredDir !== 0) {
            if ((wheelFiredDir > 0 && e.deltaX < -8) ||
                (wheelFiredDir < 0 && e.deltaX > 8)) {
                wheelFiredDir = 0;
                wheelAccum = 0;
            } else {
                return;
            }
        }

        wheelAccum += e.deltaX;

        // Forward is a push to the left — to the right in an rtl book (#945).
        var wheelForward = pagesRTL() ? -wheelAccum : wheelAccum;
        if (Math.abs(wheelForward) > 30) {
            var hand = wheelAccum > 0 ? 1 : -1;
            if (wheelForward > 0) nextPage(); else prevPage();
            wheelFiredDir = hand;
            wheelAccum = 0;
            wheelLockUntil = Date.now() + 450;
        }
    }, { passive: false });

    // --- Swipe gestures for paged mode (touch devices) ---

    var touchStartX = 0;
    var touchStartY = 0;

    document.addEventListener('touchstart', function(e) {
        if (!isPaged()) return;
        var t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
    }, { passive: true });

    // Prevent native touch scrolling in paged mode — page turns are handled
    // programmatically via nextPage()/prevPage() in touchend below. EXCEPTION:
    // while text is selected, let touchmove through so the iOS selection
    // handles can be dragged to extend/adjust the selection — otherwise
    // preventDefault swallows the handle-drag gesture in paged mode (#1).
    document.addEventListener('touchmove', function(e) {
        if (!isPaged()) return;
        // #837 — in selection mode the drag belongs to the SELECTION, and
        // this preventDefault is exactly what made starting one a fight.
        if (selectionMode) return;
        var sel = window.getSelection();
        if (sel && !sel.isCollapsed) return;
        e.preventDefault();
    }, { passive: false });

    // A pinch on a page of pictures (#945) opens it whole — the touch
    // pair's distance growing by a third, and once per pair. The Mac's
    // trackpad says the same through WebKit's gesture events.
    var _pinchStart = 0, _pinchFired = false;
    function postPageZoom(img) {
        if (!img || !window.webkit || !window.webkit.messageHandlers.pageZoom) return;
        window.webkit.messageHandlers.pageZoom.postMessage({ src: img.getAttribute('src') || '' });
    }
    function pageImageAt(x, y) {
        var el = document.elementFromPoint(x, y);
        var page = el && el.closest ? el.closest('._cr_page') : null;
        return page ? page.querySelector('img') : null;
    }
    document.addEventListener('touchstart', function(e) {
        if (!_pages) return;
        if (e.touches.length === 2) {
            var dx = e.touches[0].clientX - e.touches[1].clientX;
            var dy = e.touches[0].clientY - e.touches[1].clientY;
            _pinchStart = Math.sqrt(dx * dx + dy * dy);
        } else {
            _pinchStart = 0;
            _pinchFired = false;
        }
    }, { passive: true });
    document.addEventListener('touchmove', function(e) {
        if (!_pages || !_pinchStart || _pinchFired || e.touches.length !== 2) return;
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        if (Math.sqrt(dx * dx + dy * dy) > _pinchStart * 1.3) {
            _pinchFired = true;
            postPageZoom(pageImageAt((e.touches[0].clientX + e.touches[1].clientX) / 2,
                                     (e.touches[0].clientY + e.touches[1].clientY) / 2));
        }
    }, { passive: true });
    document.addEventListener('gesturechange', function(e) {
        if (!_pages || _pinchFired || !(e.scale > 1.3)) return;
        _pinchFired = true;
        postPageZoom(pageImageAt(e.clientX, e.clientY));
    }, { passive: true });
    document.addEventListener('gestureend', function() { _pinchFired = false; }, { passive: true });

    document.addEventListener('touchend', function(e) {
        if (!isPaged() || selectionMode) return;
        if (_pinchFired) return;
        // A box being drawn or moved (#1057) is the finger's, not a swipe.
        if ((_markDraw && _markDraw.touch) || _markEdit) return;
        var t = e.changedTouches[0];
        var dx = t.clientX - touchStartX;
        var dy = t.clientY - touchStartY;
        // Only handle horizontal swipes (dx > dy, minimum 50px)
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            // Ignore if there's a selection
            var sel = window.getSelection();
            if (sel && !sel.isCollapsed) return;

            // swipe left = next; the other way round in an rtl book (#945)
            if ((dx < 0) !== pagesRTL()) {
                nextPage();
            } else {
                prevPage();
            }
        }
    }, { passive: true });

    // --- Marks on books of pictures (#1057) ---
    //
    // A box drawn over a page's picture, kept in the picture's own unit
    // square. The Mac draws it with a plain drag (a click still turns the
    // page: the drag is told from it by distance); touch with a long press
    // and a drag (a swipe still turns the page, a long press the system
    // would give its image menu). The finished box goes to the reader,
    // which makes the mark and opens its note; the marks come back through
    // showPageMarks and stand in their page's slot, so spreads, an rtl book
    // and the strip carry them for free.
    var _pageMarks = [];
    var _markDraw = null;
    var _markLongTimer = null;
    var _markLongStart = null;
    var _markSuppressClick = false;
    var _markObserver = null;
    var _markEdit = null;
    var _markActiveId = null;
    var _markEditTimer = null;
    var MARK_RGB = ['255,59,48', '255,149,0', '255,204,0', '52,199,89', '59,130,246', '175,82,222', '142,142,147'];

    function ensureMarkStyle() {
        if (document.getElementById('_cr_mark_style')) return;
        var st = document.createElement('style');
        st.id = '_cr_mark_style';
        st.textContent =
            ' body._cr_pages ._cr_page { position: relative; }' +
            // The picture is not the system's to drag, nor to menu.
            ' body._cr_pages ._cr_page img { -webkit-user-drag: none; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }' +
            ' ._cr_markframe { position: absolute; pointer-events: none; }' +
            ' ._cr_mark { position: absolute; pointer-events: auto; box-sizing: border-box; border-radius: 3px; cursor: pointer;' +
            ' background: rgba(var(--cr-mark), 0.16); border: 1.5px solid rgba(var(--cr-mark), 0.85); }' +
            ' ._cr_mark:hover, ._cr_mark._cr_mark_active { background: rgba(var(--cr-mark), 0.26); }' +
            // The corners as brackets (user: «light the live corners»):
            // shown with the box under the pointer, heavier and washed
            // under it — the size is taken there.
            ' ._cr_markhandle { position: absolute; width: 16px; height: 16px; box-sizing: border-box;' +
            ' border: 0 solid rgba(var(--cr-mark), 1); opacity: 0; transition: opacity 0.12s, border-width 0.08s, background 0.08s; }' +
            ' ._cr_mark:hover ._cr_markhandle, ._cr_mark._cr_mark_active ._cr_markhandle { opacity: 1; }' +
            ' ._cr_markhandle:hover { background: rgba(var(--cr-mark), 0.3); }' +
            ' ._cr_markhandle[data-corner="nw"] { left: -2px; top: -2px; border-top-width: 3px; border-left-width: 3px; border-top-left-radius: 3px; cursor: nwse-resize; }' +
            ' ._cr_markhandle[data-corner="ne"] { right: -2px; top: -2px; border-top-width: 3px; border-right-width: 3px; border-top-right-radius: 3px; cursor: nesw-resize; }' +
            ' ._cr_markhandle[data-corner="sw"] { left: -2px; bottom: -2px; border-bottom-width: 3px; border-left-width: 3px; border-bottom-left-radius: 3px; cursor: nesw-resize; }' +
            ' ._cr_markhandle[data-corner="se"] { right: -2px; bottom: -2px; border-bottom-width: 3px; border-right-width: 3px; border-bottom-right-radius: 3px; cursor: nwse-resize; }' +
            ' ._cr_markhandle[data-corner="nw"]:hover { border-top-width: 5px; border-left-width: 5px; }' +
            ' ._cr_markhandle[data-corner="ne"]:hover { border-top-width: 5px; border-right-width: 5px; }' +
            ' ._cr_markhandle[data-corner="sw"]:hover { border-bottom-width: 5px; border-left-width: 5px; }' +
            ' ._cr_markhandle[data-corner="se"]:hover { border-bottom-width: 5px; border-right-width: 5px; }' +
            // A finger's reach round the taken box's corners (user,
            // 2026-11-06: it could not be sized on touch).
            ' @media (pointer: coarse) { ._cr_mark._cr_mark_active ._cr_markhandle { width: 22px; height: 22px; }' +
            ' ._cr_mark._cr_mark_active ._cr_markhandle::before { content: ""; position: absolute; inset: -14px; } }' +
            ' ._cr_mark._cr_mark_active { border-width: 2px; }' +
            ' @media (hover: hover) { ._cr_mark { cursor: move; } }' +
            // The picture's bounds while a box is drawn, moved or sized
            // (user: «it stops at the picture's edge, which is not obvious
            // at first»): a dash-dot line in no mark's colour, white on a
            // dark underline — the dashed box in the mark's colour is the
            // box itself (user, 2026-11-06: the two read alike).
            ' ._cr_markbounds { position: fixed; z-index: 2147482999; pointer-events: none; }' +
            ' ._cr_markbounds svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; }' +
            ' ._cr_markdraft { position: fixed; z-index: 2147483000; pointer-events: none; box-sizing: border-box; border-radius: 3px;' +
            ' background: rgba(var(--cr-mark), 0.18); border: 1.5px dashed rgba(var(--cr-mark), 0.95); }';
        document.head.appendChild(st);
    }

    /// The picture as painted in its slot: `object-fit: contain` on a
    /// page, the box itself in the strip — one formula for both.
    function markPainted(img) {
        var r = img.getBoundingClientRect();
        var nw = parseFloat(img.getAttribute('width')) || img.naturalWidth || r.width;
        var nh = parseFloat(img.getAttribute('height')) || img.naturalHeight || r.height;
        if (!(nw > 0 && nh > 0 && r.width > 0 && r.height > 0)) return null;
        var k = Math.min(r.width / nw, r.height / nh);
        var w = nw * k, h = nh * k;
        return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
    }

    function markColor(index) {
        return MARK_RGB[Math.max(0, Math.min(MARK_RGB.length - 1, index | 0))];
    }

    /// The slots' sizes the frames were laid for: the observer redraws
    /// only on a real change. Observing a slot reports it at once, and
    /// re-observing on every draw made that report the next draw — a
    /// redraw every frame (user: the Graphics and Media process at 117 %,
    /// a second's pause per page, clicks lost as the boxes were rebuilt
    /// between press and release).
    var _markSlotSizes = {};
    var _markRedrawQueued = false;

    function markSlotObserver() {
        if (_markObserver || !window.ResizeObserver) return _markObserver;
        _markObserver = new ResizeObserver(function (entries) {
            var changed = false;
            entries.forEach(function (entry) {
                var key = entry.target.id;
                var size = Math.round(entry.contentRect.width) + 'x' + Math.round(entry.contentRect.height);
                if (_markSlotSizes[key] !== undefined && _markSlotSizes[key] !== size) changed = true;
                _markSlotSizes[key] = size;
            });
            if (changed && !_markRedrawQueued) {
                _markRedrawQueued = true;
                requestAnimationFrame(function () { _markRedrawQueued = false; renderPageMarks(); });
            }
        });
        return _markObserver;
    }

    function renderPageMarks() {
        ensureMarkStyle();
        var old = document.querySelectorAll('._cr_markframe');
        for (var i = 0; i < old.length; i++) old[i].remove();
        if (!_pages || !_pageMarks.length) return;
        var byPage = {};
        _pageMarks.forEach(function (m) { (byPage[m.page] = byPage[m.page] || []).push(m); });
        Object.keys(byPage).forEach(function (page) {
            var slot = document.getElementById('_cr_p' + page);
            var img = slot && slot.querySelector('img');
            if (!img) return;
            var painted = markPainted(img);
            if (!painted) return;
            var sr = slot.getBoundingClientRect();
            var frame = document.createElement('div');
            frame.className = '_cr_markframe';
            frame.style.left = (painted.left - sr.left) + 'px';
            frame.style.top = (painted.top - sr.top) + 'px';
            frame.style.width = painted.width + 'px';
            frame.style.height = painted.height + 'px';
            byPage[page].forEach(function (m) {
                var box = document.createElement('div');
                box.className = '_cr_mark';
                box.setAttribute('data-mark', m.id);
                box.style.setProperty('--cr-mark', markColor(m.color));
                box.style.left = (m.x * 100) + '%';
                box.style.top = (m.y * 100) + '%';
                box.style.width = (m.w * 100) + '%';
                box.style.height = (m.h * 100) + '%';
                if (m.id === _markActiveId) box.classList.add('_cr_mark_active');
                ['nw', 'ne', 'sw', 'se'].forEach(function (corner) {
                    var hd = document.createElement('div');
                    hd.className = '_cr_markhandle';
                    hd.setAttribute('data-corner', corner);
                    box.appendChild(hd);
                });
                frame.appendChild(box);
            });
            slot.appendChild(frame);
            // The slot resizes with the window, the columns, the strip:
            // the frame follows the picture it stands on. Observed once.
            var observer = markSlotObserver();
            if (observer && !slot._crMarkObserved) {
                slot._crMarkObserved = true;
                observer.observe(slot);
            }
        });
    }

    function markBegin(img, x, y, touch) {
        var painted = markPainted(img);
        if (!painted) return;
        if (x < painted.left || x > painted.left + painted.width || y < painted.top || y > painted.top + painted.height) return;
        var slot = img.closest('._cr_page');
        _markDraw = { img: img, page: pageNumber(slot), painted: painted, x0: x, y0: y, touch: touch, box: null };
        if (touch) markMove(x, y);
    }

    function markMove(x, y) {
        var d = _markDraw;
        if (!d) return;
        if (!d.box) {
            // A click is not a drag: the box waits for some distance.
            if (!d.touch && Math.abs(x - d.x0) < 6 && Math.abs(y - d.y0) < 6) return;
            ensureMarkStyle();
            markPost({ kind: 'drawing', on: true });
            d.box = document.createElement('div');
            d.box.className = '_cr_markdraft';
            d.box.style.setProperty('--cr-mark', markColor(window._crMarkColor || 2));
            document.body.appendChild(d.box);
            markShowBounds(d.painted, window._crMarkColor || 2);
        }
        var p = d.painted;
        var cx = Math.max(p.left, Math.min(p.left + p.width, x));
        var cy = Math.max(p.top, Math.min(p.top + p.height, y));
        d.x1 = cx; d.y1 = cy;
        d.box.style.left = Math.min(d.x0, cx) + 'px';
        d.box.style.top = Math.min(d.y0, cy) + 'px';
        d.box.style.width = Math.abs(cx - d.x0) + 'px';
        d.box.style.height = Math.abs(cy - d.y0) + 'px';
    }

    function markEnd() {
        var d = _markDraw;
        _markDraw = null;
        if (!d || !d.box) return;
        d.box.remove();
        markHideBounds();
        markPost({ kind: 'drawing', on: false });
        _markSuppressClick = true;
        setTimeout(function () { _markSuppressClick = false; }, 400);
        var p = d.painted;
        var x = (Math.min(d.x0, d.x1) - p.left) / p.width;
        var y = (Math.min(d.y0, d.y1) - p.top) / p.height;
        var w = Math.abs(d.x1 - d.x0) / p.width;
        var h = Math.abs(d.y1 - d.y0) / p.height;
        // A sliver is a slip, not a mark.
        if (w < 0.02 || h < 0.02) return;
        if (!window.webkit || !window.webkit.messageHandlers.pageMark) return;
        // Stands at once (user: «the box lags»): the reader's answer
        // replaces it with the mark itself.
        _pageMarks = _pageMarks.concat([{ id: '_pending', page: d.page, x: x, y: y, w: w, h: h, color: window._crMarkColor || 2 }]);
        renderPageMarks();
        window.webkit.messageHandlers.pageMark.postMessage({
            kind: 'new', page: d.page, image: d.img.getAttribute('src') || '',
            x: x, y: y, w: w, h: h, progress: markProgress(d.img), label: markPageLabel(d.img, d.page)
        });
    }

    function markShowBounds(rect, color) {
        ensureMarkStyle();
        var b = document.getElementById('_cr_markbounds');
        if (!b) {
            b = document.createElement('div');
            b.id = '_cr_markbounds';
            b.className = '_cr_markbounds';
            b.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' +
                '<rect x="0" y="0" width="100%" height="100%" fill="none" stroke="rgba(0,0,0,0.4)" stroke-width="3"/>' +
                '<rect x="0" y="0" width="100%" height="100%" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="1"' +
                ' stroke-dasharray="10 4 2 4"/></svg>';
            document.body.appendChild(b);
        }
        b.style.setProperty('--cr-mark', markColor(color));
        b.style.left = rect.left + 'px';
        b.style.top = rect.top + 'px';
        b.style.width = rect.width + 'px';
        b.style.height = rect.height + 'px';
    }

    function markHideBounds() {
        var b = document.getElementById('_cr_markbounds');
        if (b) b.remove();
    }

    function markPost(body) {
        if (window.webkit && window.webkit.messageHandlers.pageMark) window.webkit.messageHandlers.pageMark.postMessage(body);
    }

    /// ⎋ while a box is being drawn (user): no mark, and the release
    /// that follows turns nothing.
    function markCancelDraw() {
        var d = _markDraw;
        _markDraw = null;
        if (!d) return false;
        if (d.box) d.box.remove();
        markHideBounds();
        _markSuppressClick = true;
        setTimeout(function () { _markSuppressClick = false; }, 400);
        return true;
    }

    /// The focused box by the keys: a step of the picture's own size.
    function markNudge(dx, dy) {
        var mark = null;
        for (var i = 0; i < _pageMarks.length; i++) if (_pageMarks[i].id === _markActiveId) mark = _pageMarks[i];
        if (!mark) return;
        mark.x = Math.max(0, Math.min(1 - mark.w, mark.x + dx));
        mark.y = Math.max(0, Math.min(1 - mark.h, mark.y + dy));
        renderPageMarks();
        markPost({ kind: 'update', id: mark.id, x: mark.x, y: mark.y, w: mark.w, h: mark.h });
    }

    /// The page's number as the reader's counter says it (user: «Page 31»
    /// beside «p.33»): its column in reading order — blanks and wide
    /// spreads counted — on a turned page; the picture's own number in
    /// the strip, which has no columns.
    function markPageLabel(img, page) {
        if (!isPaged()) return page;
        return rectPage(img.getBoundingClientRect()) + 1;
    }

    /// Where a picture stands in the book, the way scrollToImage counts.
    function markProgress(img) {
        if (isPaged()) {
            computeTotalPages();
            var page = rectPage(img.getBoundingClientRect());
            return totalPages > 1 ? Math.max(0, Math.min(1, page / (totalPages - 1))) : 0;
        }
        var total = document.body.scrollHeight - window.innerHeight;
        return total > 0 ? Math.max(0, Math.min(1, (img.getBoundingClientRect().top + window.scrollY) / total)) : 0;
    }

    // A box changed by hand (user: «I want to move it and size it»): its
    // body moves it, its corners size it — on the Mac under the pointer,
    // on touch after a long press makes it the active one.
    function markEditBegin(el, x, y) {
        var box = el.closest('._cr_mark');
        if (!box) return false;
        var id = box.getAttribute('data-mark');
        var mark = null;
        for (var i = 0; i < _pageMarks.length; i++) if (_pageMarks[i].id === id) mark = _pageMarks[i];
        if (!mark || id === '_pending') return false;
        var handle = el.closest('._cr_markhandle');
        var frame = box.parentNode.getBoundingClientRect();
        _markEdit = { box: box, mark: mark, mode: handle ? handle.getAttribute('data-corner') : 'move',
                      x0: x, y0: y, frame: frame, orig: { x: mark.x, y: mark.y, w: mark.w, h: mark.h }, moved: false };
        return true;
    }

    function markEditMove(x, y) {
        var e = _markEdit;
        if (!e) return;
        if (!e.moved && Math.abs(x - e.x0) < 3 && Math.abs(y - e.y0) < 3) return;
        if (!e.moved) markShowBounds(e.frame, e.mark.color);
        e.moved = true;
        var dx = (x - e.x0) / e.frame.width, dy = (y - e.y0) / e.frame.height, o = e.orig, MIN = 0.02;
        var left = o.x, top = o.y, right = o.x + o.w, bottom = o.y + o.h;
        if (e.mode === 'move') {
            left = Math.max(0, Math.min(1 - o.w, o.x + dx));
            top = Math.max(0, Math.min(1 - o.h, o.y + dy));
            right = left + o.w; bottom = top + o.h;
        } else {
            if (e.mode.indexOf('w') >= 0) left = Math.max(0, Math.min(right - MIN, o.x + dx));
            if (e.mode.indexOf('e') >= 0) right = Math.min(1, Math.max(left + MIN, o.x + o.w + dx));
            if (e.mode.indexOf('n') >= 0) top = Math.max(0, Math.min(bottom - MIN, o.y + dy));
            if (e.mode.indexOf('s') >= 0) bottom = Math.min(1, Math.max(top + MIN, o.y + o.h + dy));
        }
        e.mark.x = left; e.mark.y = top; e.mark.w = right - left; e.mark.h = bottom - top;
        e.box.style.left = (e.mark.x * 100) + '%';
        e.box.style.top = (e.mark.y * 100) + '%';
        e.box.style.width = (e.mark.w * 100) + '%';
        e.box.style.height = (e.mark.h * 100) + '%';
    }

    function markEditEnd() {
        var e = _markEdit;
        _markEdit = null;
        if (!e) return;
        markHideBounds();
        if (e.moved || e.viaLong) {
            _markSuppressClick = true;
            setTimeout(function () { _markSuppressClick = false; }, 400);
        }
        if (!e.moved) return;
        if (window.webkit && window.webkit.messageHandlers.pageMark) {
            window.webkit.messageHandlers.pageMark.postMessage({ kind: 'update', id: e.mark.id,
                x: e.mark.x, y: e.mark.y, w: e.mark.w, h: e.mark.h });
        }
    }

    function markSetActive(id) {
        if (_markActiveId === id) return;
        _markActiveId = id;
        // The reader keeps the keys for it: Return, ⌫, the arrows, ⎋.
        markPost({ kind: 'focus', id: id });
        var boxes = document.querySelectorAll('._cr_mark');
        for (var i = 0; i < boxes.length; i++) {
            boxes[i].classList.toggle('_cr_mark_active', boxes[i].getAttribute('data-mark') === id);
        }
    }

    document.addEventListener('contextmenu', function (e) {
        var box = e.target.closest ? e.target.closest('._cr_mark') : null;
        if (!box) return;
        e.preventDefault();
        markSetActive(box.getAttribute('data-mark'));
        markPost({ kind: 'menu', id: box.getAttribute('data-mark'), x: e.clientX, y: e.clientY });
    });

    document.addEventListener('mousedown', function (e) {
        if (!_pages || ('ontouchstart' in window) || e.button !== 0 || selectionMode) return;
        // The press is ours (user: a box dragged on to the left turned
        // the page): no selection drag, so no WebKit autoscroll at the
        // window's edge.
        if (e.target.closest && e.target.closest('._cr_mark')) {
            if (markEditBegin(e.target, e.clientX, e.clientY)) e.preventDefault();
            return;
        }
        var img = pageImageAt(e.clientX, e.clientY);
        if (img) {
            markBegin(img, e.clientX, e.clientY, false);
            if (_markDraw) e.preventDefault();
        }
    }, { passive: false });
    document.addEventListener('mousemove', function (e) {
        if (_markDraw) markMove(e.clientX, e.clientY);
        else if (_markEdit) markEditMove(e.clientX, e.clientY);
    }, { passive: true });
    document.addEventListener('mouseup', function () {
        if (_markDraw) markEnd();
        else if (_markEdit) markEditEnd();
    }, { passive: true });

    document.addEventListener('touchstart', function (e) {
        if (!_pages || e.touches.length !== 1 || selectionMode) return;
        var onMark = e.target.closest ? e.target.closest('._cr_mark') : null;
        if (onMark) {
            var t1 = e.touches[0], target = e.target;
            // The box taken: its body moves it, a corner sizes it, no hold
            // first; a touch that does not move is the tap on its note.
            if (onMark.getAttribute('data-mark') === _markActiveId) {
                markEditBegin(target, t1.clientX, t1.clientY);
                return;
            }
            var mx = t1.clientX, my = t1.clientY;
            _markLongStart = { x: mx, y: my };
            clearTimeout(_markEditTimer);
            _markEditTimer = setTimeout(function () {
                _markEditTimer = null;
                markSetActive(onMark.getAttribute('data-mark'));
                // The press that woke it is not a tap on its note.
                if (markEditBegin(onMark, mx, my)) _markEdit.viaLong = true;
            }, 450);
            return;
        }
        var t = e.touches[0];
        var img = pageImageAt(t.clientX, t.clientY);
        if (!img) return;
        var sx = t.clientX, sy = t.clientY;
        _markLongStart = { x: sx, y: sy };
        clearTimeout(_markLongTimer);
        _markLongTimer = setTimeout(function () {
            _markLongTimer = null;
            markBegin(img, sx, sy, true);
        }, 450);
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
        if (_markEditTimer) {
            var te = e.touches[0];
            if (!te || Math.abs(te.clientX - _markLongStart.x) > 10 || Math.abs(te.clientY - _markLongStart.y) > 10) {
                clearTimeout(_markEditTimer);
                _markEditTimer = null;
            }
            return;
        }
        if (_markEdit) {
            e.preventDefault();
            var tm = e.touches[0];
            if (tm) markEditMove(tm.clientX, tm.clientY);
            return;
        }
        if (_markLongTimer) {
            var t0 = e.touches[0];
            // Moved before the press held: a swipe or a scroll, not a mark.
            if (!t0 || Math.abs(t0.clientX - _markLongStart.x) > 10 || Math.abs(t0.clientY - _markLongStart.y) > 10) {
                clearTimeout(_markLongTimer);
                _markLongTimer = null;
            }
            return;
        }
        if (_markDraw && _markDraw.touch) {
            e.preventDefault();
            var t = e.touches[0];
            if (t) markMove(t.clientX, t.clientY);
        }
    }, { passive: false });
    document.addEventListener('touchend', function () {
        if (_markEditTimer) { clearTimeout(_markEditTimer); _markEditTimer = null; }
        if (_markEdit) { markEditEnd(); return; }
        if (_markLongTimer) { clearTimeout(_markLongTimer); _markLongTimer = null; }
        if (_markDraw && _markDraw.touch) markEnd();
    }, { passive: true });
    document.addEventListener('touchcancel', function () {
        if (_markLongTimer) { clearTimeout(_markLongTimer); _markLongTimer = null; }
        if (_markDraw && _markDraw.box) _markDraw.box.remove();
        _markDraw = null;
        _markEdit = null;
        markHideBounds();
    }, { passive: true });

    // --- Search ---

    var searchMarks = [];
    var searchCurrentIndex = -1;
    var scrollbarMarkers = null;

    function searchClear() {
        searchMarks.forEach(function(mark) {
            var parent = mark.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(mark.textContent), mark);
                parent.normalize();
            }
        });
        searchMarks = [];
        searchCurrentIndex = -1;

        // Remove scrollbar markers
        if (scrollbarMarkers) {
            scrollbarMarkers.remove();
            scrollbarMarkers = null;
        }
    }

    // Unicode-aware "is this a word character" for whole-word search
    // (#610 r6). \p{L}/\p{N} so Cyrillic words bound correctly; the \w
    // fallback covers engines without unicode property escapes.
    function isWordChar(ch) {
        if (!ch) return false;
        try { return /[\p{L}\p{N}_]/u.test(ch); } catch (e) { return /\w/.test(ch); }
    }

    function searchFind(query, caseSensitive, skipNavigate, wholeWord) {
        searchClear();
        if (!query || query.length < 2) return 0;

        var normalizedQuery = caseSensitive ? query : query.toLowerCase();
        var walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null
        );

        var textNodes = [];
        var node;
        while (node = walker.nextNode()) {
            var haystack = caseSensitive ? node.textContent : node.textContent.toLowerCase();
            if (haystack.indexOf(normalizedQuery) !== -1) {
                textNodes.push(node);
            }
        }

        // Wrap matches in <mark> tags.
        // Forward iteration is required for correct navigation order.
        // Earlier version used `for (i = length-1; i >= 0; i--)` + a final
        // `searchMarks.reverse()` — the intent was top-down across text
        // nodes, but the global `.reverse()` ALSO flipped the order
        // within each node (pushes within a node are left-to-right, so
        // global reverse makes them right-to-left). Symptom: a paragraph
        // with N matches navigated last → first inside the paragraph,
        // looking like jumps "down then back up" each time the user
        // crossed paragraph boundaries. Forward iteration here, with no
        // final reverse, gives the correct top-down + left-to-right
        // order. (DOM mutations don't invalidate cached `textNode`
        // references — replaceChild only affects the target node, not
        // its siblings — so there's no traversal-safety reason to
        // process bottom-up.)
        for (var i = 0; i < textNodes.length; i++) {
            var textNode = textNodes[i];
            var text = textNode.textContent;
            var normalizedText = caseSensitive ? text : text.toLowerCase();
            var parent = textNode.parentNode;
            if (!parent) continue;

            var frag = document.createDocumentFragment();
            var lastIdx = 0;
            var pos = normalizedText.indexOf(normalizedQuery);

            while (pos !== -1) {
                // Whole-word mode: skip a hit glued to a letter/digit on
                // either side (charAt(-1) is '' and '' is not a word char).
                if (wholeWord && (isWordChar(normalizedText.charAt(pos - 1)) ||
                                  isWordChar(normalizedText.charAt(pos + normalizedQuery.length)))) {
                    pos = normalizedText.indexOf(normalizedQuery, pos + 1);
                    continue;
                }
                if (pos > lastIdx) {
                    frag.appendChild(document.createTextNode(text.substring(lastIdx, pos)));
                }
                var mark = document.createElement('mark');
                mark.className = '_cr_search_match';
                // `pos` is an index into normalizedText (lowercased); slice with
                // the NORMALIZED query length so a query char whose lowercase
                // changes length can't misalign the highlight slice (#215).
                mark.textContent = text.substring(pos, pos + normalizedQuery.length);
                frag.appendChild(mark);
                searchMarks.push(mark);
                lastIdx = pos + normalizedQuery.length;
                pos = normalizedText.indexOf(normalizedQuery, lastIdx);
            }

            if (lastIdx < text.length) {
                frag.appendChild(document.createTextNode(text.substring(lastIdx)));
            }

            parent.replaceChild(frag, textNode);
        }

        // Inject highlight styles
        var style = document.getElementById('_cr_search_style');
        if (!style) {
            style = document.createElement('style');
            style.id = '_cr_search_style';
            document.head.appendChild(style);
        }
        // Norton's own palette for the hits (#784, user: "bright yellow,
        // in its standard colours"): the NC yellow on the frame's blue,
        // the current one inverted to blue on yellow. The translucent
        // amber of the other themes went brown on the deep blue.
        var nortonHits = !!document.getElementById('_norton_border');
        style.textContent = nortonHits
            ? ('._cr_search_match { background: transparent; color: ' + _nortonColors.hit + ' !important; font-weight: bold; border-radius: 0; }' +
               '._cr_search_current { background: ' + _nortonColors.hit + '; color: ' + _nortonColors.hitInk + ' !important; }')
            : ('._cr_search_match { background: rgba(255, 200, 0, 0.45); color: inherit; border-radius: 2px; }' +
               '._cr_search_current { background: rgba(255, 140, 0, 0.75); }');

        // Build scrollbar markers
        buildScrollbarMarkers();

        if (searchMarks.length > 0) {
            // The library's global search drives its own landing (#317 r7):
            // it re-marks and then jumps to a SPECIFIC hit, and this built-in
            // scroll-to-first raced that jump — two smooth scrolls in one JS
            // turn resolve nondeterministically in WebKit, which read as
            // "sometimes lands on the first hit instead".
            if (skipNavigate) {
                searchCurrentIndex = -1;
                return searchMarks.length;
            }
            searchCurrentIndex = 0;
            searchMarks[0].classList.add('_cr_search_current');
            if (isPaged()) {
                goToPage(rectPage(searchMarks[0].getBoundingClientRect()));
            } else {
                searchMarks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        return searchMarks.length;
    }

    function searchNavigate(delta) {
        if (searchMarks.length === 0) return -1;

        if (searchCurrentIndex >= 0 && searchCurrentIndex < searchMarks.length) {
            searchMarks[searchCurrentIndex].classList.remove('_cr_search_current');
        }

        searchCurrentIndex = (searchCurrentIndex + delta + searchMarks.length) % searchMarks.length;
        searchMarks[searchCurrentIndex].classList.add('_cr_search_current');

        if (isPaged()) {
            goToPage(rectPage(searchMarks[searchCurrentIndex].getBoundingClientRect()));
        } else {
            searchMarks[searchCurrentIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        return searchCurrentIndex;
    }

    // Absolute variant of searchNavigate for the library's global search
    // (#317): it knows WHICH occurrence it wants, and stepping there with
    // navigate(1) N times would animate N jumps.
    function searchGoTo(index) {
        if (searchMarks.length === 0) return -1;
        if (index < 0 || index >= searchMarks.length) index = 0;

        if (searchCurrentIndex >= 0 && searchCurrentIndex < searchMarks.length) {
            searchMarks[searchCurrentIndex].classList.remove('_cr_search_current');
        }
        searchCurrentIndex = index;
        searchMarks[searchCurrentIndex].classList.add('_cr_search_current');

        if (isPaged()) {
            goToPage(rectPage(searchMarks[searchCurrentIndex].getBoundingClientRect()));
        } else {
            searchMarks[searchCurrentIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return searchCurrentIndex;
    }

    function buildScrollbarMarkers() {
        if (scrollbarMarkers) {
            scrollbarMarkers.remove();
        }

        var container = document.createElement('div');
        container.id = '_cr_scrollbar_markers';
        container.style.cssText =
            'position: fixed; top: 0; right: 2px; width: 6px; height: 100vh;' +
            ' pointer-events: none; z-index: 99999;';

        var docHeight = document.body.scrollHeight;
        if (docHeight <= 0) return;

        for (var i = 0; i < searchMarks.length; i++) {
            var rect = searchMarks[i].getBoundingClientRect();
            var absTop = rect.top + window.scrollY;
            var fraction = absTop / docHeight;

            var pip = document.createElement('div');
            pip.style.cssText =
                'position: absolute; right: 0; width: 6px; height: 3px;' +
                ' background: rgba(255, 160, 0, 0.7); border-radius: 1px;' +
                ' top: ' + (fraction * 100) + '%;';
            container.appendChild(pip);
        }

        document.body.appendChild(container);
        scrollbarMarkers = container;
    }

    // --- Public API ---

    /// A JUMP — the progress bars, their scrubs, the position card — lands
    /// at once, near or far (user, 2026-11-08: a click on the ruler slid
    /// when the place was on the next spread and jumped when farther, and
    /// read as random). The slide is the page turn's alone.
    function scrollToProgress(fraction) {
        clearPendingAnchor();
        if (isPaged()) {
            computeTotalPages();
            // `fraction` is in the SAME basis as reading progress
            // (page/(totalPages-1)) — chapter positions are now stored that way
            // (see getChapterPositions) — so this maps back to the exact page. (#140)
            var page = Math.round(fraction * (totalPages - 1));
            goToPage(Math.max(0, Math.min(page, totalPages - 1)), true);
            return;
        }
        const total = document.body.scrollHeight - window.innerHeight;
        if (total <= 0) return;
        var targetY = Math.round(total * Math.min(1.0, Math.max(0.0, fraction)));
        // A strip of pictures lands on the TOP of the page the fraction
        // falls in, the one the lens showed (user, 2026-10-26: the jump
        // stopped mid-page, near its foot).
        if (_pages) {
            var at = stripPageIndexAt(targetY);
            var page = at >= 0 ? document.querySelectorAll('._cr_page')[at] : null;
            if (page) targetY = Math.min(total, Math.max(0, Math.round(page.getBoundingClientRect().top + window.scrollY)));
        }
        window.scrollTo({ top: targetY, behavior: 'instant' });
    }

    /// A picture by itself (user, 2026-10-24: "Go to image" landed four
    /// pages off). Its marker's progress was measured at one layout, and a
    /// dock opening, the window resizing or a settings change re-flows the
    /// book under it; the page is read off the picture at the moment of the
    /// jump instead. A picture the book shows twice: the copy nearest the
    /// marker. Not on the page at all (pictures hidden): the progress.
    function scrollToImage(src, fallbackProgress) {
        var want = fallbackProgress || 0;
        var paged = isPaged();
        // A stale layout repaired BEFORE the picture is measured — goToPage
        // would repair it after, under a page counted in the old one.
        if (paged) { healPagedLayoutIfStale(); computeTotalPages(); }
        var scrollLeft = document.documentElement.scrollLeft;
        var total = paged ? 0 : document.body.scrollHeight - window.innerHeight;
        var imgs = document.querySelectorAll('img');
        var best = null, bestDist = Infinity;
        for (var i = 0; i < imgs.length; i++) {
            var img = imgs[i];
            if (img.getAttribute('src') !== src || img.offsetParent === null) continue;
            var rect = img.getBoundingClientRect();
            var at;
            if (paged) {
                var page = xToPageFloor(rect.left + scrollLeft);
                at = { page: page, progress: totalPages > 1 ? page / (totalPages - 1) : 0 };
            } else {
                var top = rect.top + window.scrollY;
                at = { top: top, progress: total > 0 ? top / total : 0 };
            }
            var dist = Math.abs(at.progress - want);
            if (dist < bestDist) { bestDist = dist; best = at; }
        }
        if (!best) { scrollToProgress(want); return; }
        clearPendingAnchor();
        // A jump: at once (see scrollToProgress).
        if (paged) {
            goToPage(Math.max(0, Math.min(best.page, totalPages - 1)), true);
        } else {
            // Where the marker's progress put it: the picture's top at the
            // window's.
            window.scrollTo({ top: Math.max(0, Math.min(total, Math.round(best.top))), behavior: 'instant' });
        }
    }

    var scrollTopOffset = 50; // clearance for toolbar overlay

    function scrollToElementId(id, fallbackProgress) {
        var el = document.getElementById(id);
        if (!el) return;
        // Deliberate travel, like scrollToProgress / scrollToXPath (#831):
        // whatever anchor a reflow would return to is now behind us.
        clearPendingAnchor();
        invalidateStickyAnchor();
        if (isPaged()) {
            // In paged mode, navigate by the chapter's stored progress rather
            // than a click-time `getBoundingClientRect().left +
            // documentElement.scrollLeft` read. That live read is unreliable once
            // the reader is scrolled — the horizontal scroll isn't reflected on
            // documentElement here, so `scrollLeft` comes back stale and the
            // chapter jumped to the wrong page. `scrollToProgress` is the same
            // progress→page path the (correct) progress-bar markers use. (#140)
            if (typeof fallbackProgress === 'number' && fallbackProgress >= 0) {
                scrollToProgress(fallbackProgress);
                return;
            }
            goToPage(rectPage(el.getBoundingClientRect()), true);
        } else {
            // A jump: at once (see scrollToProgress).
            var top = el.getBoundingClientRect().top + window.scrollY - scrollTopOffset;
            window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
            // Stamp the arrival once the scroll has settled: the
            // throttled scroll reports can leave the last word with a
            // frame from MID-flight, and anything that restores from the
            // stamped position in the next seconds — a settings apply, a
            // content-process reload — would land there instead of on the
            // chapter (user, 2026-09-08: a day/night switch after a chapter
            // jump lost the place).
            clearTimeout(scrollTrailingTimer);
            scrollTrailingTimer = null;
            setTimeout(function() {
                if (isResizing || document.hidden) return;
                fireScrollReport();
            }, 450);
        }
    }

    /// - Parameter instant: a jump the reader asked for (a bookmark) lands
    ///   at once; a follower's step after its master's turn still slides.
    function scrollToXPath(xpath, fallbackProgress, instant) {
        clearPendingAnchor();
        var node = getNodeByXPath(xpath);
        if (!node || node === document.body) {
            scrollToProgress(fallbackProgress);
            return;
        }
        var el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
        if (isPaged()) {
            // Elements (typically paragraphs) can span several column
            // fragments. getBoundingClientRect().left points at the
            // FIRST fragment's left edge — its starting page. Using
            // that visibly slides the reader backward by 1+ pages when
            // the saved xpath's element extends across columns:
            //   master at page N → reports xpath whose element starts
            //   on N-1 → slave's scrollToXPath goes to N-1.
            // Same fix shape as restorePositionPaged: iterate
            // getClientRects (one rect per column fragment) and pick
            // the fragment whose page is closest to fallbackProgress —
            // the page where the user was actually reading.
            computeTotalPages();
            var colW = getPageWidth();
            var scrollLeft = document.documentElement.scrollLeft;
            var rects = (el.getClientRects && el.getClientRects().length > 0)
                ? Array.from(el.getClientRects())
                : [el.getBoundingClientRect()];
            var totalForProgress = Math.max(1, totalPages - 1);
            var progressPage = Math.round((fallbackProgress || 0) * totalForProgress);
            var bestPage = -1;
            var bestDist = Infinity;
            for (var i = 0; i < rects.length; i++) {
                var r = rects[i];
                if (!r.width && !r.height) continue;
                // rect.left is viewport-relative; convert to document
                // coords by adding the current horizontal scroll.
                var p = rectPage(r, scrollLeft);
                if (p < 0 || p >= totalPages) continue;
                var dist = Math.abs(p - progressPage);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestPage = p;
                }
            }
            if (bestPage >= 0) {
                goToPage(bestPage, !!instant);
            } else if (totalPages > 1) {
                // Fallback: progress-based page index, clamped.
                var page = Math.round((fallbackProgress || 0) * (totalPages - 1));
                goToPage(Math.max(0, Math.min(page, totalPages - 1)), !!instant);
            }
        } else {
            var top = el.getBoundingClientRect().top + window.scrollY - scrollTopOffset;
            window.scrollTo({ top: Math.max(0, top), behavior: instant ? 'instant' : 'smooth' });
        }
    }

    function getVisibleText() {
        // Collect text from elements visible in the viewport
        var text = '';
        var paragraphs = document.body.querySelectorAll('p, h1, h2, h3, h4, div.verse');

        if (isPaged()) {
            // Paged mode: check horizontal position against current page
            var scrollX = document.documentElement.scrollLeft;
            var pageW = getPageWidth();
            var viewportLeft = scrollX;
            var viewportRight = scrollX + pageW;
            for (var i = 0; i < paragraphs.length && text.length < 150; i++) {
                var rect = paragraphs[i].getBoundingClientRect();
                var absLeft = rect.left + scrollX;
                var absRight = rect.right + scrollX;
                if (absRight > viewportLeft && absLeft < viewportRight) {
                    var chunk = paragraphs[i].innerText.trim();
                    if (chunk) {
                        if (text) text += ' ';
                        text += chunk;
                    }
                }
                // Past the page's far side: the right of an ltr page, the
                // left of an rtl one (#1094).
                if (nativeRTL() ? absRight < viewportLeft : absLeft > viewportRight) break;
            }
        } else {
            // Scroll mode: check vertical position
            var viewportTop = window.scrollY;
            var viewportBottom = viewportTop + window.innerHeight;
            for (var i = 0; i < paragraphs.length && text.length < 150; i++) {
                var rect = paragraphs[i].getBoundingClientRect();
                var absTop = rect.top + window.scrollY;
                var absBottom = rect.bottom + window.scrollY;
                if (absBottom > viewportTop && absTop < viewportBottom) {
                    var chunk = paragraphs[i].innerText.trim();
                    if (chunk) {
                        if (text) text += ' ';
                        text += chunk;
                    }
                }
                if (absTop > viewportBottom) break;
            }
        }
        return text.substring(0, 150);
    }

    function getSelectedText() {
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return '';
        // Check if selection start is within the visible viewport
        var range = sel.getRangeAt(0);
        var startRect = range.startContainer.nodeType === Node.TEXT_NODE
            ? (function() { var r = document.createRange(); r.selectNode(range.startContainer); return r.getBoundingClientRect(); })()
            : range.startContainer.getBoundingClientRect();
        var viewportTop = 0;
        var viewportBottom = window.innerHeight;
        // If selection anchor is outside visible area, ignore it
        if (startRect.bottom < viewportTop || startRect.top > viewportBottom) {
            return '';
        }
        return sel.toString().substring(0, 5000);
    }

    function getSelectionPosition() {
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
        var range = sel.getRangeAt(0);
        var node = range.startContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        var xpath = node ? getXPath(node) : '/html/body';
        var rect = range.getBoundingClientRect();
        if (isPaged()) {
            var absLeft = rectStartX(rect);
            var scrollW = document.body.scrollWidth - getPageWidth();
            var progress = scrollW > 0 ? absLeft / scrollW : 0;
            return {
                xpath: xpath,
                charOffset: 0,
                scrollY: document.documentElement.scrollLeft,
                progress: Math.min(1.0, Math.max(0.0, progress))
            };
        }
        var absTop = rect.top + window.scrollY;
        var total = document.body.scrollHeight - window.innerHeight;
        var progress = total > 0 ? absTop / total : 0;
        return {
            xpath: xpath,
            charOffset: 0,
            scrollY: window.scrollY,
            progress: Math.min(1.0, Math.max(0.0, progress))
        };
    }

    // --- Bookmark highlights ---

    function ensureBookmarkStyle() {
        if (document.getElementById('_cr_bookmark_style')) return;
        var style = document.createElement('style');
        style.id = '_cr_bookmark_style';
        style.textContent =
            '._cr_bookmarked_0 { background: rgba(255,59,48, 0.10); border-radius: 3px; }' +
            '._cr_bookmarked_1 { background: rgba(255,149,0, 0.10); border-radius: 3px; }' +
            '._cr_bookmarked_2 { background: rgba(255,204,0, 0.12); border-radius: 3px; }' +
            '._cr_bookmarked_3 { background: rgba(52,199,89, 0.10); border-radius: 3px; }' +
            '._cr_bookmarked_4 { background: rgba(59,130,246, 0.10); border-radius: 3px; }' +
            '._cr_bookmarked_5 { background: rgba(175,82,222, 0.10); border-radius: 3px; }' +
            '._cr_bookmarked_6 { background: rgba(142,142,147, 0.10); border-radius: 3px; }' +
            '._cr_bm_text_0 { background: rgba(255,59,48, 0.15); border-radius: 2px; }' +
            '._cr_bm_text_1 { background: rgba(255,149,0, 0.15); border-radius: 2px; }' +
            '._cr_bm_text_2 { background: rgba(255,204,0, 0.18); border-radius: 2px; }' +
            '._cr_bm_text_3 { background: rgba(52,199,89, 0.15); border-radius: 2px; }' +
            '._cr_bm_text_4 { background: rgba(59,130,246, 0.15); border-radius: 2px; }' +
            '._cr_bm_text_5 { background: rgba(175,82,222, 0.15); border-radius: 2px; }' +
            '._cr_bm_text_6 { background: rgba(142,142,147, 0.15); border-radius: 2px; }';
        document.head.appendChild(style);
    }

    function highlightBookmarks(bookmarks) {
        ensureBookmarkStyle();
        // Clear existing highlights (all color variants)
        var existing = document.querySelectorAll('[class*="_cr_bookmarked_"]');
        for (var i = 0; i < existing.length; i++) {
            var cl = existing[i].classList;
            for (var c = 0; c <= 6; c++) cl.remove('_cr_bookmarked_' + c);
        }
        // The marks' ids on what they tint (user, 2026-11-06): a selection
        // inside one offers its editor.
        var named = document.querySelectorAll('[data-crbm], [data-crbmw]');
        for (var n = 0; n < named.length; n++) {
            named[n].removeAttribute('data-crbm');
            named[n].removeAttribute('data-crbmw');
        }
        // Clear text-level highlights (all color variants)
        var textMarks = document.querySelectorAll('[class*="_cr_bm_text_"]');
        for (var i = textMarks.length - 1; i >= 0; i--) {
            var mark = textMarks[i];
            var parent = mark.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(mark.textContent), mark);
                parent.normalize();
            }
        }
        if (!bookmarks || bookmarks.length === 0) return;

        var paragraphs = document.body.querySelectorAll('p, h1, h2, h3, h4, blockquote, div.verse');

        for (var j = 0; j < bookmarks.length; j++) {
            var bm = bookmarks[j];
            var preview = bm.preview || '';
            var fullText = preview.trim();
            var matchText = fullText.substring(0, 80);

            // Strategy 1: find by xpath → get the element or its nearest paragraph child/parent
            var target = null;
            if (bm.xpath && bm.xpath !== '/html/body') {
                try {
                    var result = document.evaluate(bm.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    var node = result.singleNodeValue;
                    if (node && node !== document.body) {
                        // If node is a paragraph-level element, use it directly
                        if (node.matches && node.matches('p, h1, h2, h3, h4, blockquote, div.verse')) {
                            target = node;
                        } else {
                            // Find first paragraph inside, or walk up to find parent paragraph
                            target = node.querySelector('p, h1, h2, h3, h4, blockquote, div.verse');
                            if (!target) {
                                var up = node.closest('p, h1, h2, h3, h4, blockquote, div.verse, section');
                                if (up) target = up;
                            }
                        }
                    }
                } catch(e) { /* skip */ }
            }

            // Strategy 2: if xpath didn't work, search all paragraphs for preview text
            if (!target && matchText.length >= 6) {
                var lowerMatch = matchText.toLowerCase();
                for (var k = 0; k < paragraphs.length; k++) {
                    if (paragraphs[k].textContent.toLowerCase().indexOf(lowerMatch) !== -1) {
                        target = paragraphs[k];
                        break;
                    }
                }
            }

            if (!target) continue;

            var colorIdx = (bm.colorIndex != null && bm.colorIndex >= 0 && bm.colorIndex <= 6) ? bm.colorIndex : 4;
            // One mark's colour on a paragraph, never a pile of classes the
            // stylesheet's order chose between (user, 2026-11-06: a long
            // mark recoloured stayed blue — a three-letter mark in the same
            // paragraph had tinted it whole, and blue's rule came later).
            // Weight 2 is a mark that covers the paragraph, 1 the fallback
            // of one whose words were not found or too short to look for;
            // the heavier keeps it, the newer on a tie (the list is in the
            // order the marks were made).
            var tint = function(el, weight) {
                var had = parseInt(el.getAttribute('data-crbmw') || '0', 10);
                if (had > weight) return;
                for (var c = 0; c <= 6; c++) el.classList.remove('_cr_bookmarked_' + c);
                el.classList.add('_cr_bookmarked_' + colorIdx);
                el.setAttribute('data-crbmw', String(weight));
                if (bm.id) el.setAttribute('data-crbm', bm.id);
            };

            // Multi-paragraph highlight: if text is long (>150 chars), tint all consecutive
            // paragraphs whose text appears in the selection
            if (fullText.length > 150) {
                var lowerFull = fullText.toLowerCase();
                // Start from target, also check siblings
                var container = target.parentNode;
                var siblings = container ? container.querySelectorAll('p, h1, h2, h3, h4, blockquote, div.verse') : [target];
                var started = false;
                for (var s = 0; s < siblings.length; s++) {
                    var sibText = siblings[s].textContent.trim();
                    if (!sibText) continue;
                    // Check if this paragraph's text appears in the full selection
                    if (lowerFull.indexOf(sibText.substring(0, 40).toLowerCase()) !== -1) {
                        if (!started && siblings[s] === target) started = true;
                        if (started) tint(siblings[s], 2);
                    } else if (started) {
                        break; // stop at first non-matching sibling after target
                    }
                }
                // Ensure at least target is highlighted
                if (!target.classList.contains('_cr_bookmarked_' + colorIdx)) tint(target, 2);
                continue;
            }

            // Short text: try to highlight exact text within the element
            if (matchText.length >= 6 && highlightTextInElement(target, fullText, colorIdx, bm.id)) {
                continue;
            }
            // Fallback: tint the whole element
            tint(target, 1);
        }
    }

    function highlightTextInElement(element, text, colorIdx, markId) {
        var lowerText = text.toLowerCase();
        var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
        var node;
        // Try to find the text within a single text node first
        while (node = walker.nextNode()) {
            var content = node.textContent;
            var idx = content.toLowerCase().indexOf(lowerText);
            if (idx !== -1) {
                var before = content.substring(0, idx);
                var match = content.substring(idx, idx + text.length);
                var after = content.substring(idx + text.length);
                var parent = node.parentNode;
                var frag = document.createDocumentFragment();
                if (before) frag.appendChild(document.createTextNode(before));
                var span = document.createElement('span');
                span.className = '_cr_bm_text_' + colorIdx;
                if (markId) span.setAttribute('data-crbm', markId);
                span.textContent = match;
                frag.appendChild(span);
                if (after) frag.appendChild(document.createTextNode(after));
                parent.replaceChild(frag, node);
                return true;
            }
        }
        return false;
    }

    // --- Extracted: Image display mode ---

    function applyImageDisplay(settings) {
        var imgMode = settings.imageDisplay || 'show';
        var imgSheet = document.getElementById('_images_override');
        if (!imgSheet) {
            imgSheet = document.createElement('style');
            imgSheet.id = '_images_override';
            document.head.appendChild(imgSheet);
        }
        if (imgMode === 'hide') {
            imgSheet.textContent = 'img, picture, figure img, svg { display: none !important; }';
        } else if (imgMode === 'mask') {
            var tc = settings.textColor || '#000000';
            var tcRgb = parseColorToRGB(tc);
            var borderColor = 'rgba(' + tcRgb + ',0.35)';
            var placeholderBg = 'rgba(' + tcRgb + ',0.06)';
            var wrapCSS = 'display:inline-block; position:relative; border-radius:6px; border:2px dashed ' + borderColor + '; background:' + placeholderBg + '; transition: border-color 0.3s ease, background 0.3s ease;';
            document.querySelectorAll('img, svg').forEach(function(el) {
                var existing = el.closest('._img-wrap');
                if (existing) {
                    existing.style.cssText = wrapCSS;
                    return;
                }
                var wrap = document.createElement('span');
                wrap.className = '_img-wrap';
                wrap.style.cssText = wrapCSS;
                el.parentNode.insertBefore(wrap, el);
                wrap.appendChild(el);
            });
            imgSheet.textContent =
                '._img-wrap > img, ._img-wrap > svg {' +
                '  opacity: 0 !important;' +
                '  transition: opacity 0.3s ease !important;' +
                '  display: block !important;' +
                '  min-height: 40px !important;' +
                '}' +
                ' ._img-wrap:hover > img, ._img-wrap:hover > svg {' +
                '  opacity: 1 !important;' +
                '}' +
                ' ._img-wrap:hover {' +
                '  border-color: transparent !important;' +
                '  background: transparent !important;' +
                '}';
        } else {
            imgSheet.textContent = '';
            document.querySelectorAll('._img-wrap').forEach(function(wrap) {
                while (wrap.firstChild) wrap.parentNode.insertBefore(wrap.firstChild, wrap);
                wrap.remove();
            });
        }
    }

    // --- Extracted: Norton Commander frame ---

    // Re-assert the Norton rim on the SETTLED layout after the LAST of a burst
    // of mode switches / resizes. Rapid scroll↔page↔twoPage cycling can leave
    // the rim gone or mispositioned: the scroll-mode reflow toggles
    // body.display, and overlapping applySettings/onResize calls race so an
    // intermediate rebuild loses to a stale one. A single debounced trailing
    // rebuild restores it the way a fullscreen toggle's onResize used to (#94).
    /// What a style adds to the bare box (#866). Notched: no CSS border —
    /// an SVG rectangle whose corners curve inward (the ticket frame),
    /// drawn to the box's own size, twice, a hair apart. Vintage: a
    /// flourish in each corner, one drawing mirrored four ways, over the
    /// double rule.
    function dressFrame(boxes, style, inkRGB) {
        if (style === 'notched') {
            boxes.forEach(function (box) {
                var r = box.getBoundingClientRect();
                var w = Math.max(40, Math.round(r.width)), h = Math.max(40, Math.round(r.height));
                function ticket(i, n) {
                    return 'M ' + (i + n) + ' ' + i +
                        ' L ' + (w - i - n) + ' ' + i + ' A ' + n + ' ' + n + ' 0 0 0 ' + (w - i) + ' ' + (i + n) +
                        ' L ' + (w - i) + ' ' + (h - i - n) + ' A ' + n + ' ' + n + ' 0 0 0 ' + (w - i - n) + ' ' + (h - i) +
                        ' L ' + (i + n) + ' ' + (h - i) + ' A ' + n + ' ' + n + ' 0 0 0 ' + i + ' ' + (h - i - n) +
                        ' L ' + i + ' ' + (i + n) + ' A ' + n + ' ' + n + ' 0 0 0 ' + (i + n) + ' ' + i + ' Z';
                }
                box.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" ' +
                    'preserveAspectRatio="none" style="position:absolute;left:0;top:0;width:' + w + 'px;height:' + h + 'px;display:block;overflow:visible;">' +
                    '<path d="' + ticket(1.5, 14) + '" fill="none" stroke="rgba(' + inkRGB + ',0.6)" stroke-width="1.5"/>' +
                    '<path d="' + ticket(5.5, 11) + '" fill="none" stroke="rgba(' + inkRGB + ',0.45)" stroke-width="1"/>' +
                    '</svg>';
            });
        } else if (style === 'perforated') {
            // Tractor-feed paper (#880): a strip of sprocket holes down
            // each side with the tear line inside it, the top and bottom
            // edges perforated — one sheet of fan-fold per column. The
            // holes are rings with a faint fill: nothing shows through a
            // page, so the ring is what says "hole".
            boxes.forEach(function (box) {
                var r = box.getBoundingClientRect();
                var w = Math.max(60, Math.round(r.width)), h = Math.max(60, Math.round(r.height));
                var strip = 20, hole = 4.6, pitch = 24;
                var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" ' +
                    'style="position:absolute;left:0;top:0;width:' + w + 'px;height:' + h + 'px;display:block;overflow:visible;">';
                // The sheet's edges: solid down the sides, perforated top
                // and bottom, where the fold was.
                // Faint, all of it (user, 2026-09-14): the paper's edge
                // is a cut, not a rule — the solid sides faintest of all.
                svg += '<path d="M 0.5 0.5 V ' + (h - 0.5) + ' M ' + (w - 0.5) + ' 0.5 V ' + (h - 0.5) + '" fill="none" stroke="rgba(' + inkRGB + ',0.22)" stroke-width="1"/>';
                svg += '<path d="M 0.5 0.5 H ' + (w - 0.5) + ' M 0.5 ' + (h - 0.5) + ' H ' + (w - 0.5) + '" fill="none" stroke="rgba(' + inkRGB + ',0.34)" stroke-width="1" stroke-dasharray="7 4"/>';
                // The tear lines, inside the strips.
                svg += '<path d="M ' + (strip + 0.5) + ' 2 V ' + (h - 2) + ' M ' + (w - strip - 0.5) + ' 2 V ' + (h - 2) + '" fill="none" stroke="rgba(' + inkRGB + ',0.24)" stroke-width="1" stroke-dasharray="3 3"/>';
                // The holes, centred on the strips, from the top edge down
                // at the paper's own pitch — the last one no nearer the
                // bottom than half a pitch.
                var holes = '';
                var count = Math.max(1, Math.floor((h - pitch) / pitch) + 1);
                var y0 = (h - (count - 1) * pitch) / 2;
                for (var i = 0; i < count; i++) {
                    var y = (y0 + i * pitch).toFixed(1);
                    holes += '<circle cx="' + (strip / 2 + 0.5) + '" cy="' + y + '" r="' + hole + '"/>' +
                             '<circle cx="' + (w - strip / 2 - 0.5) + '" cy="' + y + '" r="' + hole + '"/>';
                }
                svg += '<g fill="rgba(' + inkRGB + ',0.09)" stroke="rgba(' + inkRGB + ',0.42)" stroke-width="1">' + holes + '</g>';
                box.innerHTML = svg + '</svg>';
            });
        } else if (style === 'vintage') {
            // The corner: a stem along each rule curling into a spiral, a
            // leaf between, a dot at the eye — the vignette frames' corner,
            // simplified to what a 48-point square can carry.
            var S = 48;
            var curl = '<path d="M 46 4 C 30 4, 20 8, 15 16 C 11 22, 14 30, 21 30 C 27 30, 28 24, 23 22 C 19 21, 17 25, 20 27" fill="none" stroke="rgba(' + inkRGB + ',0.7)" stroke-width="1.4" stroke-linecap="round"/>' +
                '<path d="M 4 46 C 4 30, 8 20, 16 15 C 22 11, 30 14, 30 21 C 30 27, 24 28, 22 23 C 21 19, 25 17, 27 20" fill="none" stroke="rgba(' + inkRGB + ',0.7)" stroke-width="1.4" stroke-linecap="round"/>' +
                '<path d="M 9 9 C 14 6, 18 8, 20 12 C 16 13, 12 12, 9 9 Z" fill="rgba(' + inkRGB + ',0.55)"/>' +
                '<circle cx="24" cy="24" r="1.6" fill="rgba(' + inkRGB + ',0.7)"/>';
            var corners = [['left:-2px;top:-2px;', ''], ['right:-2px;top:-2px;', 'scale(-1,1)'],
                           ['left:-2px;bottom:-2px;', 'scale(1,-1)'], ['right:-2px;bottom:-2px;', 'scale(-1,-1)']];
            boxes.forEach(function (box) {
                var html = '';
                corners.forEach(function (c) {
                    html += '<svg xmlns="http://www.w3.org/2000/svg" width="' + S + '" height="' + S + '" viewBox="0 0 ' + S + ' ' + S + '" ' +
                        'style="position:absolute;' + c[0] + 'overflow:visible;' + (c[1] ? 'transform:' + c[1] + ';' : '') + '">' + curl + '</svg>';
                });
                box.innerHTML = html;
            });
        }
    }

    /// True while the frame wears Norton's legends (#866) — the paged
    /// insets keep room for them; a plain frame keeps `_frameTextGap`
    /// between its rule and the text instead, on every side, and stands
    /// `_frameSideInset` in from the page's edge.
    var _frameLegends = false;
    var _frameTextGap = 0;
    var _frameSideInset = 10;
    /// The gutters the last paged layout laid (#866): the frame's boxes
    /// seam on them, so the seam and the reading line standing in the
    /// first gutter are the same number — split at thirds of the
    /// viewport the seams stood a pixel off the columns (user: "a little
    /// left of centre on three and four").
    var _pagedGutters = [];

    var _nortonRebuildTimer = null;
    function scheduleNortonRebuild() {
        clearTimeout(_nortonRebuildTimer);
        _nortonRebuildTimer = setTimeout(function() {
            if (lastAppliedSettings && frameIsOn(lastAppliedSettings, !!lastAppliedSettings.nortonFrame)) {
                applyNortonFrame(lastAppliedSettings, !!lastAppliedSettings.nortonFrame);
                applyScrollMasks(true);
            }
        }, 240);
    }

    // The box's inks (#784): CGA on the blue Terminal, dimmed on the grey
    // one — handed over with the settings, defaults for an old payload.
    var _nortonColors = { ink: '#00FFFF', plate: '#00AAAA', hit: '#FFFF55', hitInk: '#0000AA' };

    /// Which frame the settings ask for (#866): Norton's own box under
    /// the Terminal theme, or the theme-independent one — a rule around
    /// the text in the theme's ink, with the docks left free.
    function frameStyleFor(settings, nortonActive) {
        if (nortonActive) return 'norton';
        var f = settings && settings.textFrame;
        return (f && f !== 'none') ? f : 'none';
    }
    function frameIsOn(settings, nortonActive) {
        return frameStyleFor(settings, nortonActive) !== 'none';
    }

    /// The text frame (#866): Norton's box — 3px double lines, the title
    /// and the clock on island legends, the Terminal palette — or one of
    /// the theme-independent styles in the theme's own ink: single,
    /// double, notched (inward-curved corners) and vintage (double rules
    /// with a flourish in each corner). One box per column, ten points
    /// in from the page's edges; the legends and the clock are Norton's
    /// alone. The ids stay `_norton_*` — everything that asks "is there a
    /// frame" (the paged insets, the separators, the scroll masks) asks
    /// by them.
    function applyNortonFrame(settings, nortonActive) {
        var nortonSheet = document.getElementById('_norton_frame');
        if (!nortonSheet) {
            nortonSheet = document.createElement('style');
            nortonSheet.id = '_norton_frame';
            document.head.appendChild(nortonSheet);
        }
        var nortonEl = document.getElementById('_norton_border');
        if (nortonEl) nortonEl.remove();
        var oldLegend = document.getElementById('_norton_legend');
        if (oldLegend) oldLegend.remove();
        // The boxes past the first are numbered (#864); '_r' is what a
        // 1.5 frame called its second one.
        var oldRight = document.getElementById('_norton_border_r');
        if (oldRight) oldRight.remove();
        for (var oi = 1; oi < 4; oi++) {
            var oldBox = document.getElementById('_norton_border_' + oi);
            if (oldBox) oldBox.remove();
        }
        var oldLegendR = document.getElementById('_norton_legend_r');
        if (oldLegendR) oldLegendR.remove();

        if (window._nortonClockTimer) {
            clearInterval(window._nortonClockTimer);
            window._nortonClockTimer = null;
        }

        var style = frameStyleFor(settings, nortonActive);
        if (style === 'none') {
            nortonSheet.textContent = '';
            _nortonTopInset = 0;
            _nortonBottomInset = 0;
            _frameLegends = false;
            return;
        }
        var legends = style === 'norton';
        _frameLegends = legends;
        // The air between the frame and the text (#866, user): the same
        // on every side, and more for the vintage flourishes, which reach
        // some forty points into the box from each corner. Norton keeps
        // its own measures.
        _frameTextGap = legends ? 0 : ((style === 'vintage' || style === 'perforated') ? 36 : 24);

        // One NC box per column (#864): the count the page settled on
        // in applyPagingCSS; the trailing rebuild re-asserts it once the
        // columns are laid.
        var nortonColumns = isPaged() ? pagingColumns : 1;
        // #283 — independent composition: the WebView frame already excludes
        // the control strip (incl. the Norton C:\> line + F-key bar), the
        // safe areas, and the FS clock pill; the Swift layer owns all of
        // that. The rim insets are now pure aesthetics: a uniform 10pt from
        // every frame edge. The historical per-platform/per-mode branches
        // (ti=56 island clearance, bt=48+bsa/84/… bar reserves, the +20
        // command-line strip) compensated for chrome the frame no longer
        // sits under.
        var ti = 10;
        var bt = 10;
        var fi = 10;
        if (!legends) {
            // The frame follows the margin (user, 2026-09-13: "it relates
            // to the padding"): it stands the text gap outside the text,
            // never nearer the edge than ten — and clear of a shut rail
            // that reaches over the page (`frameRail`, from the reader),
            // which Norton never meets since its docks stay below.
            var userPad = parseInt(document.body.style.paddingLeft) || 0;
            var rail = (typeof settings.frameRail === 'number') ? settings.frameRail : 0;
            fi = Math.max(10, userPad - _frameTextGap, rail > 0 ? rail + 8 : 0);
        }
        _frameSideInset = fi;
        // Publish the active insets so applyPagingCSS (paged columns)
        // and the scroll-mode body-padding line below both fit inside
        // the same frame.
        _nortonTopInset = ti;
        _nortonBottomInset = bt;
        var labelTop = ti - 6;
        // The rule itself. Norton's ink is its palette's; the others take
        // the text colour, a little lifted, so the frame is the book's own
        // ink and not a stroke laid on top of it.
        var inkRGB = parseColorToRGB(settings.textColor || '#000000');
        var border;
        if (style === 'norton') border = '3px double ' + _nortonColors.ink;
        else if (style === 'single') border = '1px solid rgba(' + inkRGB + ',0.55)';
        else if (style === 'notched' || style === 'perforated') border = 'none';
        else border = '3px double rgba(' + inkRGB + ',0.6)';
        var frameCSS =
            '._norton_panel {' +
            '  position: fixed;' +
            '  border: ' + border + ';' +
            '  pointer-events: none;' +
            '  z-index: 9990;' +
            '  -webkit-backface-visibility: hidden;' +
            '  backface-visibility: hidden;' +
            '  will-change: transform;' +
            '}' +
            '._norton_label {' +
            '  position: fixed;' +
            '  background: ' + _nortonColors.plate + ';' +
            '  color: #000000;' +
            '  font-family: Menlo, monospace;' +
            '  font-size: 12.5px;' +
            '  line-height: 16px;' +
            '  padding: 0 6px;' +
            '  z-index: 9991;' +
            '  pointer-events: none;' +
            '  white-space: nowrap;' +
            '  overflow: hidden;' +
            '  text-overflow: ellipsis;' +
            '  transform: translateX(-50%) translateZ(0);' +
            '  -webkit-backface-visibility: hidden;' +
            '  backface-visibility: hidden;' +
            '  will-change: transform;' +
            '}' +
            (isPaged() ? '' : legends
                ? 'body { padding-top: ' + (ti + 20) + 'px !important; padding-bottom: ' + (bt + 16) + 'px !important; }'
                : 'body { padding-top: ' + (ti + _frameTextGap) + 'px !important; padding-bottom: ' + (bt + _frameTextGap) + 'px !important;' +
                  ' padding-left: ' + Math.max(parseInt(document.body.style.paddingLeft) || 0, fi + _frameTextGap) + 'px !important;' +
                  ' padding-right: ' + Math.max(parseInt(document.body.style.paddingRight) || 0, fi + _frameTextGap) + 'px !important; }');
        nortonSheet.textContent = frameCSS;

        // The box (or boxes) themselves, then whatever the style adds.
        // On <html>, not in the body (#866): the body is the multi-column
        // container in Pages, and WebKit fragments even a fixed box's
        // CONTENT along its columns — the notched frame's drawing came
        // out a column's height, not the box's. The separators live on
        // <html> for the same reason.
        var boxes = [];
        function addBox(id, cssText) {
            var box = document.createElement('div');
            box.id = id;
            box.className = '_norton_panel';
            box.style.cssText = cssText;
            document.documentElement.appendChild(box);
            boxes.push(box);
            return box;
        }

        var titleEl = document.querySelector('title');
        var bookTitle = titleEl ? titleEl.textContent : '';
        var bookAuthor = settings.bookAuthor || '';
        var legendText = bookTitle;
        if (bookAuthor) legendText += ' \u2014 ' + bookAuthor;
        if (legendText.length > 50) legendText = legendText.substring(0, 50) + '\u2026';

        function nortonDateTimeStr() {
            var now = new Date();
            var time = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
            var date = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
            return date + ', ' + time;
        }

        function nortonCombinedStr() {
            var elapsed = window._nortonElapsedStr || '-:--';
            return elapsed + ' \u2502 ' + nortonDateTimeStr();
        }

        if (nortonColumns > 1) {
            // N boxes across the frame, each an equal share of the width
            // with a 3px seam between neighbours — the book's title on the
            // first, the clock on the last, as the two-page frame had them.
            var gap = 3;
            var N = nortonColumns;
            // On the columns' own gutters when the page has laid them
            // (#866) — the seam's centre IS the gutter, where the reading
            // line stands; until it has, an equal split of the width.
            var onGutters = _pagedGutters.length === N - 1;
            var W = window.innerWidth;
            for (var ci = 0; ci < N; ci++) {
                var leftCSS = ci === 0 ? (fi + 'px')
                    : onGutters ? ((_pagedGutters[ci - 1] + gap) + 'px')
                    : ('calc(' + (100 * ci / N) + '% + ' + gap + 'px)');
                var rightCSS = ci === N - 1 ? (fi + 'px')
                    : onGutters ? ((W - _pagedGutters[ci] + gap) + 'px')
                    : ('calc(' + (100 * (N - 1 - ci) / N) + '% + ' + gap + 'px)');
                addBox(ci === 0 ? '_norton_border' : ('_norton_border_' + ci),
                       'top:' + ti + 'px; left:' + leftCSS + '; right:' + rightCSS + '; bottom:' + bt + 'px; transform:translateZ(0);');
            }
            if (!legends) { dressFrame(boxes, style, inkRGB); return; }
            var legL = document.createElement('div');
            legL.id = '_norton_legend';
            legL.className = '_norton_label';
            legL.style.cssText = 'top:' + labelTop + 'px; left:' + (50 / N) + '%; max-width:calc(' + (25 / N) + 'vw);';
            legL.textContent = legendText;
            document.body.appendChild(legL);
            var legR = document.createElement('div');
            legR.id = '_norton_legend_r';
            legR.className = '_norton_label';
            legR.style.cssText = 'top:' + labelTop + 'px; left:' + (100 - 50 / N) + '%;';
            legR.textContent = nortonCombinedStr();
            document.body.appendChild(legR);
            window._nortonClockTimer = setInterval(function() {
                var el = document.getElementById('_norton_legend_r');
                if (el) el.textContent = nortonCombinedStr();
            }, 30000);
        } else if (settings.isPhone) {
            addBox('_norton_border', 'top:' + ti + 'px; left:' + fi + 'px; right:' + fi + 'px; bottom:' + bt + 'px; transform:translateZ(0);');
            if (!legends) { dressFrame(boxes, style, inkRGB); return; }
            var leg = document.createElement('div');
            leg.id = '_norton_legend';
            leg.className = '_norton_label';
            leg.style.cssText = 'top:' + labelTop + 'px; left:50%; max-width:70%;';
            leg.textContent = legendText;
            document.body.appendChild(leg);
            // Center the clock/date pill on the frame's bottom rim:
            // frame's bottom edge is at `bt` from viewport bottom;
            // label centre needs to sit at the same y. Label's CSS
            // `bottom` positions its lower edge, and the label is
            // ~16pt tall (line-height) — so `bottom: bt - 8` puts the
            // centre exactly on the rim. Prior `bt - 9` left the label
            // straddling the rim asymmetrically, leaning visibly below.
            var labelBot = bt - 8;
            var legR = document.createElement('div');
            legR.id = '_norton_legend_r';
            legR.className = '_norton_label';
            legR.style.cssText = 'bottom:' + labelBot + 'px; left:50%;';
            legR.textContent = nortonCombinedStr();
            document.body.appendChild(legR);
            window._nortonClockTimer = setInterval(function() {
                var el = document.getElementById('_norton_legend_r');
                if (el) el.textContent = nortonCombinedStr();
            }, 30000);
        } else {
            addBox('_norton_border', 'top:' + ti + 'px; left:' + fi + 'px; right:' + fi + 'px; bottom:' + bt + 'px; transform:translateZ(0);');
            if (!legends) { dressFrame(boxes, style, inkRGB); return; }
            var leg = document.createElement('div');
            leg.id = '_norton_legend';
            leg.className = '_norton_label';
            leg.style.cssText = 'top:' + labelTop + 'px; left:50%; max-width:25%;';
            leg.textContent = legendText;
            document.body.appendChild(leg);
            var legR = document.createElement('div');
            legR.id = '_norton_legend_r';
            legR.className = '_norton_label';
            legR.style.cssText = 'top:' + labelTop + 'px; right:' + (fi + 12) + 'px; transform:none;';
            legR.textContent = nortonCombinedStr();
            document.body.appendChild(legR);
            window._nortonClockTimer = setInterval(function() {
                var el = document.getElementById('_norton_legend_r');
                if (el) el.textContent = nortonCombinedStr();
            }, 30000);
        }
    }

    window.PositionTracker = {
        // The reader's word on the top rule's inset — moved in place, no
        // relayout: the lines are fixed overlays.
        /// Quiet (#887): the rule under the title fades with the rest of
        /// the chrome. A flag, not a removal — the next layout pass redraws
        /// the line and reads the flag.
        /// The page brightness alone (#1034): a slider's drag, without the
        /// whole fold — that re-lays the pages out on every step, and they
        /// blinked. Only the tint sheet is rewritten.
        setPagesBrightness: function(level) {
            if (!lastAppliedSettings) return;
            lastAppliedSettings.pagesBrightness = level;
            applyPagesTint(lastAppliedSettings);
        },
        setQuiet: function(on) {
            quietChrome = !!on;
            var topLine = document.getElementById('_cr_page_border_top');
            if (topLine) topLine.style.opacity = quietChrome ? '0' : '1';
        },
        /// The panel selector is up (iPad, #883): its keys are the reader's.
        setKeysToReader: function(on) {
            keysToReader = !!on;
        },
        /// A tap the reader forwards (#898): what the page would have
        /// done with it at that point — the same debounce as a click.
        tapAt: function(x, y) {
            if (selectionMode) return;
            var now = Date.now();
            if (now - lastTapTime < 350) return;
            lastTapTime = now;
            pageTapAt(x, y);
        },
        setTopRulePad: function(px) {
            topRulePad = px;
            var onSheet = !!(lastAppliedSettings && lastAppliedSettings.onSheet);
            var topLine = document.getElementById('_cr_page_border_top');
            if (topLine) topLine.style.top = px + 'px';
            var sep = document.getElementById('_cr_page_separator');
            if (sep && !onSheet) {
                sep.style.top = px + 'px';
                sep.style.height = 'calc(100vh - ' + px + 'px)';
            }
        },
        /// Lightweight FS toggle path: just sync the flags in lastAppliedSettings
        /// so the natural window.resize (which SwiftUI's safe-area animation
        /// drives ~180 ms later) sees the new isFullscreen / bottomSafeArea
        /// when onResize calls applyPagingCSS. Avoids the two-phase flash
        /// (Swift applySettings reflows first against the stale viewport,
        /// then the natural resize reflows against the new viewport).
        /// See `_resizeFrozen`.
        /// #837 — the reader is choosing text: hand the page's gestures
        /// back to iOS for the duration. Swift also freezes the layout
        /// (`setResizeFrozen`) so the bar that appears for the mode cannot
        /// reflow the column out from under the selection.
        setSelectionMode: function(on) {
            selectionMode = !!on;
            if (!selectionMode) {
                var sel = window.getSelection();
                if (sel) { sel.removeAllRanges(); }
            }
        },
        /// Travel to a position WITHOUT the opening protocol (#831/#832).
        /// `restorePosition` posts `positionRestored`, which raises the
        /// reader's "Restoring position..." overlay and re-applies the
        /// last reported position — which is why Cancel landed right and
        /// then jumped back to where the drag had left it (user,
        /// 2026-09-07). This one only travels, and drops the sticky anchor
        /// so a later resize cannot pull the page back to the peeks.
        setPosition: function(xpath, charOffset, scrollY, progress) {
            invalidateStickyAnchor();
            clearPendingAnchor();
            var node = xpath ? getNodeByXPath(xpath) : null;
            if (node && node !== document.body) {
                scrollToXPath(xpath, progress || 0);
            } else if (!isPaged() && scrollY > 0) {
                window.scrollTo({ top: scrollY, behavior: 'auto' });
            } else {
                scrollToProgress(progress || 0);
            }
            setTimeout(function() { reportPagePosition(true); }, 60);
        },
        setResizeFrozen: function(frozen) {
            _resizeFrozen = !!frozen;
            // Whatever the hold was keeping is the sheet's business; the
            // unfreeze below owns the place from here.
            clearFrozenHold();
            if (!_resizeFrozen &&
                (window.innerWidth !== _lastLaidW || window.innerHeight !== _lastLaidH)) {
                onResize();
            }
        },
        updateFullscreenFlag: function(isFS, bottomSafe, fullscreenClockMode, scrollTopPad, topZone) {
            if (!lastAppliedSettings) return;
            lastAppliedSettings.isFullscreen = !!isFS;
            // #842 - the selection strip belongs to fullscreen, and this
            // path is the only one a fullscreen toggle takes (applySettings
            // is deliberately skipped to save a reflow), so the reserved
            // zone travels with the flag.
            if (typeof topZone === 'number') {
                topReservedZone = topZone;
            }
            // #649 - the FS toggle path never runs applySettings, so the
            // scroll-mode housing clearance applies here; the natural
            // resize that follows re-anchors the position as usual.
            if (typeof scrollTopPad === 'number') {
                lastAppliedSettings.scrollTopPad = scrollTopPad;
                if (!isPaged()) {
                    var fsTop = _comfort ? Math.max(comfortTopPad(), scrollTopPad) : scrollTopPad;
                    document.body.style.paddingTop = fsTop > 0 ? fsTop + 'px' : '';
                }
            }
            if (typeof bottomSafe === 'number') {
                lastAppliedSettings.bottomSafeArea = bottomSafe;
            }
            if (typeof fullscreenClockMode === 'string' && fullscreenClockMode.length > 0) {
                lastAppliedSettings.fullscreenClockMode = fullscreenClockMode;
            }
        },
        /// Re-stamp the Norton (Terminal) frame against the CURRENT viewport
        /// without reflowing text or restoring position. The frame elements are
        /// position:fixed, and on iOS WKWebView a fixed element in a
        /// horizontally-scrolled (paged) document is mis-placed across a
        /// viewport resize — so after a fullscreen-exit animation the cyan rim
        /// can sit against an intermediate viewport. Swift calls this once the
        /// animation settles so the rim matches the final geometry.
        /// The paper the last apply painted — the reader checks it against
        /// the theme it shows after a resume or a mode switch, and applies
        /// again when the two disagree.
        appliedBgColor: function() {
            return lastAppliedSettings ? (lastAppliedSettings.bgColor || '') : '';
        },
        refreshNortonFrame: function() {
            if (lastAppliedSettings) {
                applyNortonFrame(lastAppliedSettings, !!lastAppliedSettings.nortonFrame);
            }
        },
        getPosition: function() {
            return getCurrentPosition();
        },
        restorePosition: function(xpath, charOffset, scrollY, progress) {
            restorePosition(xpath, charOffset, scrollY || 0, progress || 0);
        },
        scrollToProgress: function(fraction) {
            scrollToProgress(fraction);
        },
        scrollToImage: function(src, fraction) {
            scrollToImage(src, fraction);
        },
        nextPage: function(vertical) { nextPage(vertical); },
        scrollPage: function(direction) { scrollPage(direction); },
        prevPage: function(vertical) { prevPage(vertical); },
        turnPageInstant: function(direction) { turnPageInstant(direction); },
        /// The turn, resolved once the new spread is painted (#1045): a
        /// page of pictures decodes late, and the snapshot the turn draws
        /// with took the old frame — the new page arrived wearing the old
        /// one's picture, then changed. A text book resolves at once.
        /// The crumble's grid (#881), in the viewport's points: one cell a
        /// character — the text's width of one glyph (the Terminal's face
        /// is monospaced) by one line — laid from each column's left edge
        /// and the text's top, so a cell holds a letter, not two halves.
        /// The picture marks (#1057): [{id, page, x, y, w, h, color}] —
        /// drawn into their pages' slots, replacing the last set.
        showPageMarks: function(list) {
            _pageMarks = Array.isArray(list) ? list : [];
            renderPageMarks();
        },
        cancelMarkDraw: function() { return markCancelDraw(); },
        /// Where a picture stands, for a mark made on it zoomed (#1082):
        /// its slot, the counter's number, the progress — or null.
        markInfoForImage: function(src) {
            var imgs = document.querySelectorAll('._cr_page img');
            for (var i = 0; i < imgs.length; i++) {
                if ((imgs[i].getAttribute('src') || '') !== src) continue;
                var page = pageNumber(imgs[i].closest('._cr_page'));
                return { page: page, label: markPageLabel(imgs[i], page), progress: markProgress(imgs[i]) };
            }
            return null;
        },
        nudgeMark: function(dx, dy) { markNudge(dx, dy); },
        clearMarkFocus: function() { markSetActive(null); },
        /// The colour a box being drawn wears — the mark's to be.
        setMarkColor: function(index) { window._crMarkColor = index; },
        crumbleGrid: function() {
            var body = document.body;
            if (!body) return null;
            var cs = getComputedStyle(body);
            var host = document.querySelector('p') || body;
            var probe = document.createElement('span');
            probe.textContent = 'MMMMMMMMMMMMMMMMMMMM';
            probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;left:0;top:0;';
            host.appendChild(probe);
            var r = probe.getBoundingClientRect();
            host.removeChild(probe);
            var w = r.width / 20;
            var h = parseFloat(getComputedStyle(host).lineHeight);
            if (!isFinite(h) || h <= 0) h = r.height;
            if (!(w > 0) || !(h > 0)) return null;
            var padLeft = parseFloat(cs.paddingLeft) || 0;
            var top = parseFloat(cs.paddingTop) || 0;
            var colWidth = parseFloat(cs.columnWidth) || (window.innerWidth - 2 * padLeft);
            var gap = parseFloat(cs.columnGap) || 0;
            var n = Math.max(1, pagingColumns);
            var lefts = [];
            for (var i = 0; i < n; i++) lefts.push(padLeft + i * (colWidth + gap));
            var height = parseFloat(cs.height) || (window.innerHeight - top);
            return { cellW: w, cellH: h, lefts: lefts, colWidth: colWidth, top: top, height: height };
        },
        turnPageInstantPainted: function(direction) {
            turnPageInstant(direction);
            return new Promise(function (resolve) { whenPagePainted(function () { resolve(true); }); });
        },
        scrollByLine: function(direction) { scrollByLine(direction); },
        goToPage: function(idx) { goToPage(idx); },
        searchNoScroll: function(query, caseSensitive) {
            return searchFind(query, caseSensitive, true);
        },
        search: function(query, caseSensitive, wholeWord) {
            return searchFind(query, caseSensitive, false, wholeWord);
        },
        searchNavigate: function(delta) {
            return searchNavigate(delta);
        },
        searchGoTo: function(index) {
            return searchGoTo(index);
        },
        searchClear: function() {
            searchClear();
        },
        scrollToElementId: function(id, fallbackProgress) {
            return scrollToElementId(id, fallbackProgress);
        },
        scrollToXPath: function(xpath, fallbackProgress, instant) {
            scrollToXPath(xpath, fallbackProgress, instant);
        },
        scrollToParagraphWithText: function(prefix) {
            var elems = document.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6');
            for (var i = 0; i < elems.length; i++) {
                var t = elems[i].innerText.trim();
                if (t.length > 10 && t.substring(0, prefix.length) === prefix) {
                    if (isPaged()) {
                        var savedScroll = document.documentElement.scrollLeft;
                        window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
                        computeTotalPages();
                        var page = rectPage(elems[i].getBoundingClientRect(), 0);
                        if (page >= 0 && page < totalPages) {
                            goToPageInstant(page);
                        } else {
                            window.scrollTo({ left: savedScroll, top: 0, behavior: 'instant' });
                        }
                    } else {
                        elems[i].scrollIntoView({block: 'start'});
                        lastSavedScrollY = window.scrollY;
                    }
                    highlightVoiceReaderTarget(elems[i]);
                    return true;
                }
            }
            return false;
        },
        getVisibleText: function() {
            return getVisibleText();
        },
        getFirstVisibleParagraphText: function() {
            // In paged mode, snap to nearest page first in case trackpad
            // momentum left us between pages
            if (isPaged()) {
                var pageW = getPageWidth();
                if (pageW > 0) {
                    var scrollX = document.documentElement.scrollLeft;
                    var nearestPage = xToPage(scrollX);
                    if (Math.abs(scrollX - pageToX(nearestPage)) > 2) {
                        window.scrollTo({ left: pageToX(nearestPage), top: 0, behavior: 'instant' });
                        currentPage = nearestPage;
                    }
                }
            }
            // Return visible text from the top of the viewport.
            // Uses getVisibleText() which collects text from visible <p> elements
            // (not individual text nodes which may be too short for reliable matching).
            return getVisibleText();
        },
        getSelectedText: function() {
            return getSelectedText();
        },
        // The block the selection sits in (#783): the translate panel's
        // origin note wants the language of the PASSAGE, not of one word
        // — "управление" is Bulgarian on its own and Russian in its
        // paragraph.
        getSelectionContext: function() {
            var sel = window.getSelection();
            if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { return ''; }
            var node = sel.getRangeAt(0).commonAncestorContainer;
            var el = node.nodeType === 1 ? node : node.parentElement;
            while (el && el !== document.body) {
                var d = window.getComputedStyle(el).display;
                if (d === 'block' || d === 'list-item' || d === 'table-cell') { break; }
                el = el.parentElement;
            }
            var t = (el ? el.textContent : sel.toString()) || '';
            return t.replace(/\s+/g, ' ').trim().slice(0, 1200);
        },
        getSelectionPosition: function() {
            return getSelectionPosition();
        },
        highlightBookmarks: function(progressList) {
            highlightBookmarks(progressList);
        },
        /// The mark the selection stands in, asked when Bookmark is
        /// picked: a menu built before `selectionMark` arrived (a pointer's
        /// right click on the iPad) still names the mark, not a new one.
        markAtSelection: function() {
            var sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return '';
            return markIdAt(sel.anchorNode) || markIdAt(sel.focusNode);
        },
        /// A book of pictures (#945): the viewport width at which the
        /// spread on screen fills its columns exactly at the present
        /// column height — the window's "fit to page". A blank slot takes
        /// its partner's width, a wide picture is the whole spread. 0 when
        /// there is nothing to fit (a strip, a flow).
        pagesFitWidth: function() {
            if (!_pages || !isPaged()) return 0;
            var slots = Array.prototype.slice.call(document.querySelectorAll('._cr_page, ._cr_blank')).filter(function (p) {
                var r = p.getBoundingClientRect();
                return r.right > 1 && r.left < window.innerWidth - 1;
            });
            if (!slots.length) return 0;
            var colHeight = slots[0].getBoundingClientRect().height;
            var N = Math.max(1, parseInt(lastAppliedSettings.pageColumns, 10) || 1);
            var colGap = N > 1 ? 4 : 0;
            var widths = [];
            for (var i = 0; i < slots.length; i++) {
                var img = slots[i].querySelector('img');
                var w = img ? (parseInt(img.getAttribute('width'), 10) || 0) : 0;
                var h = img ? (parseInt(img.getAttribute('height'), 10) || 0) : 0;
                if (!w || !h) { widths.push(0); continue; }
                if (slots[i].classList.contains('_cr_wide')) return Math.round(colHeight * w / h);
                widths.push(colHeight * w / h);
            }
            var widest = Math.max.apply(null, widths);
            if (!(widest > 0)) return 0;
            var total = 0;
            for (var j = 0; j < N; j++) total += (widths[j] > 0 ? widths[j] : widest);
            return Math.round(total + (N - 1) * colGap);
        },
        /// A blink of a frame around a picture's page (#1010, user): the
        /// gallery's click on a page already on screen says where it is.
        /// The page slot carries the outline (the picture sits in it at
        /// its own aspect); a picture outside a slot wears it itself.
        pulseImage: function(src, color) {
            var imgs = document.querySelectorAll('img');
            var img = null;
            for (var i = 0; i < imgs.length; i++) {
                if (imgs[i].getAttribute('src') === src) { img = imgs[i]; break; }
            }
            if (!img) return;
            var box = img.closest('._cr_page') || img;
            // A soft frame, not a hard rule (user: "a bit crude"): a
            // thin line and an inner glow that fades into the page, on a
            // pseudo-element so the slot's own box is untouched. A bare
            // picture (no slot) cannot carry a pseudo-element; it keeps
            // the outline.
            if (!document.getElementById('_cr_pulse_style')) {
                var st = document.createElement('style');
                st.id = '_cr_pulse_style';
                st.textContent = '@keyframes _cr_pulse { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }' +
                    ' ._cr_pulse { position: relative; }' +
                    ' ._cr_pulse::after { content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: 3px;' +
                    ' box-shadow: inset 0 0 0 2px var(--cr-pulse), inset 0 0 28px 12px var(--cr-pulse-soft);' +
                    ' animation: _cr_pulse 0.3s ease-in-out 2; }' +
                    ' img._cr_pulse { outline: 3px solid var(--cr-pulse); outline-offset: -3px; animation: _cr_pulse 0.3s ease-in-out 2; }';
                document.head.appendChild(st);
            }
            var hex = (color || '#c08a3e').replace('#', '');
            var r = parseInt(hex.substr(0, 2), 16), g = parseInt(hex.substr(2, 2), 16), b = parseInt(hex.substr(4, 2), 16);
            box.style.setProperty('--cr-pulse', '#' + hex);
            box.style.setProperty('--cr-pulse-soft', 'rgba(' + r + ',' + g + ',' + b + ',0.4)');
            box.classList.remove('_cr_pulse');
            void box.offsetWidth;
            box.classList.add('_cr_pulse');
            setTimeout(function () { box.classList.remove('_cr_pulse'); }, 700);
        },
        getImagePositions: function() {
            var images = document.querySelectorAll('img');
            var results = [];
            if (isPaged()) {
                computeTotalPages();
                var pageW = getPageWidth();
                for (var i = 0; i < images.length; i++) {
                    var img = images[i];
                    if (img.offsetParent === null) continue;
                    var page = rectPage(img.getBoundingClientRect());
                    var progress = totalPages > 1 ? page / (totalPages - 1) : 0;
                    results.push({ index: i, progress: Math.min(1.0, Math.max(0.0, progress)), src: img.getAttribute('src') || '',
                                   page: _pages ? pageNumber(img.closest('._cr_page') || img) : 0 });
                }
                // A right-to-left book's DOM runs backwards (#945); the
                // list is in reading order. The two pages of a spread
                // share a progress, so the page's own number settles them:
                // the DOM's order there put the left page (read second)
                // first, and the strip paired them crosswise (#1025).
                if (_pages) results.sort(function (a, b) { return (a.progress - b.progress) || (a.page - b.page); });
            } else {
                var total = document.body.scrollHeight - window.innerHeight;
                for (var i = 0; i < images.length; i++) {
                    var img = images[i];
                    if (img.offsetParent === null) continue;
                    var top = img.getBoundingClientRect().top + window.scrollY;
                    var progress = total > 0 ? top / total : 0;
                    results.push({ index: i, progress: Math.min(1.0, Math.max(0.0, progress)), src: img.getAttribute('src') || '' });
                }
            }
            return JSON.stringify(results);
        },
        /// The hits WITH their words (#764 r-search, user: "list what
        /// was found in a strip"). Each hit's position, in the same basis
        /// every other marker uses,
        /// plus a snippet cut from the block the mark sits in — the
        /// reader's own list needs something to show besides a number.
        getSearchResults: function() {
            var results = [];
            if (searchMarks.length === 0) return JSON.stringify(results);
            var paged = isPaged();
            if (paged) { computeTotalPages(); }
            var pageW = paged ? getPageWidth() : 0;
            var scrollTotal = paged ? 0 : (document.body.scrollHeight - window.innerHeight);
            for (var i = 0; i < searchMarks.length; i++) {
                var mark = searchMarks[i];
                var progress;
                if (paged) {
                    var page = rectPage(mark.getBoundingClientRect());
                    progress = totalPages > 1 ? page / (totalPages - 1) : 0;
                } else {
                    var top = mark.getBoundingClientRect().top + window.scrollY;
                    progress = scrollTotal > 0 ? top / scrollTotal : 0;
                }
                var host = mark.parentNode;
                var text = (host && host.textContent) ? host.textContent : (mark.textContent || '');
                var needle = mark.textContent || '';
                var at = needle ? text.indexOf(needle) : -1;
                if (at < 0) at = 0;
                var from = Math.max(0, at - 40);
                var to = Math.min(text.length, at + needle.length + 70);
                var snippet = text.slice(from, to).replace(/\s+/g, ' ').trim();
                if (from > 0) snippet = '…' + snippet;
                if (to < text.length) snippet = snippet + '…';
                results.push({
                    progress: Math.min(1.0, Math.max(0.0, progress)),
                    text: snippet
                });
            }
            return JSON.stringify(results);
        },
        /// WHICH hits the reader can see right now — asked of the
        /// geometry rather than guessed from page numbers (user: "two
        /// are lit and they are on 85 and 87"). An estimate compares two
        /// approximations of the same thing and disagrees with itself by
        /// a page; a rect either intersects the viewport or it does not.
        getVisibleSearchIndices: function() {
            var out = [];
            var w = window.innerWidth, h = window.innerHeight;
            for (var i = 0; i < searchMarks.length; i++) {
                var r = searchMarks[i].getBoundingClientRect();
                if (r.right > 0 && r.left < w && r.bottom > 0 && r.top < h) out.push(i);
            }
            return JSON.stringify(out);
        },
        getBookmarkPositions: function(bookmarksJSON) {
            var bookmarks = typeof bookmarksJSON === 'string' ? JSON.parse(bookmarksJSON) : bookmarksJSON;
            var results = [];
            if (isPaged()) {
                // Page-based progress — the same `page / (totalPages - 1)`
                // basis the position reports and chapter ticks use. The old
                // `absLeft / scrollWidth` basis sat the bookmark markers
                // slightly off the progress dot for the same location (#180).
                computeTotalPages();
                var colW = getPageWidth();
                for (var i = 0; i < bookmarks.length; i++) {
                    var bm = bookmarks[i];
                    try {
                        var node = document.evaluate(bm.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                        if (!node || node === document.body) continue;
                        var el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
                        var rect = el.getBoundingClientRect();
                        var absLeft = rect.left + document.documentElement.scrollLeft;
                        // A book of pictures maps its slots through its own
                        // order — spreads, an rtl book (#1057: a mark's
                        // marker and its stored place came out mirrored).
                        var page = _pages ? xToPageFloor(absLeft + 1)
                            // An rtl text book counts from its own start (#1094).
                            : nativeRTL() ? rectPage(rect)
                            : (colW > 0 ? Math.round(absLeft / colW) : 0);
                        var progress = totalPages > 1 ? page / (totalPages - 1) : 0;
                        results.push({ id: bm.id, progress: Math.min(1.0, Math.max(0.0, progress)) });
                    } catch(e) {}
                }
            } else {
                var total = document.body.scrollHeight - window.innerHeight;
                for (var i = 0; i < bookmarks.length; i++) {
                    var bm = bookmarks[i];
                    try {
                        var node = document.evaluate(bm.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                        if (!node || node === document.body) continue;
                        var el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
                        var top = el.getBoundingClientRect().top + window.scrollY;
                        var progress = total > 0 ? top / total : 0;
                        results.push({ id: bm.id, progress: Math.min(1.0, Math.max(0.0, progress)) });
                    } catch(e) {}
                }
            }
            return JSON.stringify(results);
        },
        getChapterPositions: function(idsJSON) {
            var ids = typeof idsJSON === 'string' ? JSON.parse(idsJSON) : idsJSON;
            var results = [];
            if (isPaged()) {
                // Report each chapter's progress in the SAME basis as reading
                // progress — page/(totalPages-1) — so chapter ticks line up with
                // the position dot and scrollToProgress maps back to the exact
                // page. Use the KNOWN scroll (currentPage * pitch), not
                // document.documentElement.scrollLeft, which reads 0/stale while
                // scrolled and corrupted the measurement away from the start. (#140)
                computeTotalPages();
                var pitch = getPageWidth();
                var reliableScrollLeft = pageToX(currentPage);
                var denom = Math.max(1, totalPages - 1);
                for (var i = 0; i < ids.length; i++) {
                    var el = document.getElementById(ids[i]);
                    if (!el) continue;
                    var page = Math.max(0, Math.min(rectPage(el.getBoundingClientRect(), reliableScrollLeft), totalPages - 1));
                    results.push({ id: ids[i], progress: page / denom });
                }
            } else {
                var total = document.body.scrollHeight - window.innerHeight;
                for (var i = 0; i < ids.length; i++) {
                    var el = document.getElementById(ids[i]);
                    if (!el) continue;
                    var top = el.getBoundingClientRect().top + window.scrollY;
                    var progress = total > 0 ? top / total : 0;
                    results.push({ id: ids[i], progress: Math.min(1.0, Math.max(0.0, progress)) });
                }
            }
            return JSON.stringify(results);
        },
        // First and last prose line of each chapter, pulled live from the DOM
        // (no per-book storage). Used by the macOS chapter MAP to fill the
        // proportional free space, so a long chapter reads differently from a
        // short one. idsJSON is the ordered list of chapter element ids.
        /// #830 — the text at a position, without GOING there.
        ///
        /// The lenses (#831 / #832) show what a jump would land on while
        /// the reader is still deciding, so this may not move the page: it
        /// computes the window the position names — a column in paged
        /// mode, a screenful in scroll — and reads the blocks around its
        /// start. Geometry only; nothing is scrolled, nothing reflows.
        /// `getChapterSnippets` is the same trick for chapters.
        ///
        /// The place, not the tail after it (#863, user): the blocks
        /// BEFORE the target come first, then a `here` mark, then the
        /// blocks from the target on — each side up to its own budget of
        /// characters, so the lens can stand the mark in its middle and
        /// let the reader look both ways. A block that straddles the
        /// target's edge counts as the first after it: the page starts
        /// mid-paragraph, and that is what the mark says.
        ///
        /// Images come back as a MARK rather than a gap: a preview that
        /// silently drops an illustration is lying about the page. The
        /// index is the one `getImagePositions` uses, so the caller can
        /// name it.
        textAtProgress: function(fraction, maxChars, beforeChars) {
            // A book of pictures shows its pages, not the names of its
            // pictures (user, 2026-10-26: a list of "Picture 4, Picture 5…"
            // said nothing about where the slider would land).
            if (_pages) return JSON.stringify(spreadAtProgress(fraction));
            var afterLimit = maxChars || 900;
            var beforeLimit = (beforeChars === undefined || beforeChars === null) ? afterLimit : beforeChars;
            var f = Math.min(1, Math.max(0, Number(fraction) || 0));
            var imgs = document.querySelectorAll('img');
            var imgIndex = new Map();
            for (var k = 0; k < imgs.length; k++) { imgIndex.set(imgs[k], k); }

            var blocks = document.body.querySelectorAll('p, h1, h2, h3, h4, h5, div.verse, img');

            // One item for a block, cut to what is left of a budget; the
            // cut end is the one away from the mark, so the words nearest
            // the place are always whole.
            function item(el, budget, fromEnd) {
                if (el.tagName === 'IMG') {
                    var idx = imgIndex.has(el) ? imgIndex.get(el) : -1;
                    return { piece: { type: 'image', index: idx }, cost: 0 };
                }
                var text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                if (!text) return null;
                if (text.length > budget) {
                    // A stub of a few letters says nothing; stop short.
                    if (budget < 24) return null;
                    if (fromEnd) {
                        text = '…' + text.slice(text.length - Math.max(0, budget)).replace(/^\S*\s+/, '');
                    } else {
                        text = text.slice(0, Math.max(0, budget)).replace(/\s+\S*$/, '') + '…';
                    }
                }
                if (!text || text === '…') return null;
                return { piece: { type: 'text', text: text }, cost: text.length };
            }

            // Every visible block's span along the reading axis.
            var spans = [];
            var page = 0;
            var winStart;
            if (isPaged()) {
                computeTotalPages();
                var pageW = getPageWidth();
                page = Math.round(f * (totalPages - 1));
                var scrollX = document.documentElement.scrollLeft;
                winStart = page * pageW;
                for (var i = 0; i < blocks.length; i++) {
                    var el = blocks[i];
                    if (el.offsetParent === null) continue;
                    var r = el.getBoundingClientRect();
                    // Logical spans — from the book's start (#1094).
                    var st = rectStartX(r, scrollX);
                    spans.push({ el: el, start: st, end: st + r.width });
                }
            } else {
                var total = document.body.scrollHeight - window.innerHeight;
                winStart = total > 0 ? total * f : 0;
                for (var j = 0; j < blocks.length; j++) {
                    var node = blocks[j];
                    if (node.offsetParent === null) continue;
                    var rect = node.getBoundingClientRect();
                    spans.push({ el: node, start: rect.top + window.scrollY, end: rect.bottom + window.scrollY });
                }
            }

            // The first block that reaches past the target's edge.
            var first = spans.length;
            for (var s = 0; s < spans.length; s++) {
                if (spans[s].end > winStart + 1) { first = s; break; }
            }

            var before = [];
            var used = 0;
            for (var b = first - 1; b >= 0 && used < beforeLimit - 24; b--) {
                var it = item(spans[b].el, beforeLimit - used, true);
                if (!it) continue;
                before.unshift(it.piece);
                used += it.cost;
            }
            var after = [];
            used = 0;
            for (var a = first; a < spans.length && used < afterLimit - 24; a++) {
                var jt = item(spans[a].el, afterLimit - used, false);
                if (!jt) continue;
                after.push(jt.piece);
                used += jt.cost;
            }

            var items = before.concat([{ type: 'here' }], after);
            // The page numbers the reader's own read-out uses: columns, not
            // spreads (#864) — the lens said 6 of 33 under a bar saying 11/66.
            var cols = isPaged() ? pagingColumns : 1;
            return JSON.stringify({ page: page * cols + 1, total: totalPages * cols, items: items });
        },
        getChapterSnippets: function(idsJSON) {
            var ids = typeof idsJSON === 'string' ? JSON.parse(idsJSON) : idsJSON;
            var idSet = {};
            for (var k = 0; k < ids.length; k++) { idSet[ids[k]] = true; }

            function clean(s) {
                s = (s || '').replace(/\s+/g, ' ').trim();
                if (s.length > 160) s = s.slice(0, 159).replace(/\s+\S*$/, '').trim() + '…';
                return s;
            }
            function isPara(n) {
                var t = n.tagName;
                return t === 'P' || t === 'BLOCKQUOTE';
            }
            // First and last paragraph text strictly between startEl and the
            // next chapter (stopEl), walking the body in document order.
            function snippetFor(startEl, stopEl) {
                var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
                walker.currentNode = startEl;
                var first = '', last = '', n;
                while ((n = walker.nextNode())) {
                    if (stopEl && n === stopEl) break;
                    if (n !== startEl && n.id && idSet[n.id]) break; // defensive: ran into another chapter
                    if (isPara(n)) {
                        var txt = clean(n.textContent);
                        if (txt) { if (!first) first = txt; last = txt; }
                    }
                }
                return { first: first, last: last };
            }

            var results = [];
            for (var i = 0; i < ids.length; i++) {
                var el = document.getElementById(ids[i]);
                if (!el) continue;
                var stop = (i + 1 < ids.length) ? document.getElementById(ids[i + 1]) : null;
                var s = snippetFor(el, stop);
                if (!s.first && !s.last) continue;
                results.push({ id: ids[i], first: s.first, last: s.last });
            }
            return JSON.stringify(results);
        },
        showFootnotePopup: function(content, x, y) {
            showFootnotePopup(content, x, y);
        },
        hideFootnotePopup: function() {
            hideFootnotePopup();
        },
        /// Called by Swift on scene reactivation (#272): repair a paged
        /// layout whose CSS is stamped for a viewport size the window no
        /// longer has (app-switcher snapshot resizes racing suspension).
        /// The texture tile under the text (#865), as a data URL; '' takes
        /// it away. The strength and the theme's side come with applySettings.
        setPageTexture: function(src) { setPageTexture(src); },
        verifyLayout: function() {
            healPagedLayoutIfStale();
            // Swift calls this well after a transition settles — a dim
            // still up at this point is an orphan (#279 watchdog notes).
            if (!isResizing) liftStuckDim();
        },
        applySettings: function(settings) {
            // Nothing but how the page BEHAVES has changed (CR #1115): the
            // tap zones and their mirroring, the slide between pages, the
            // arrows' scrolling. These are variables read when a tap or a
            // key comes — and each of them used to go the whole road below
            // all the same: the page dimmed, four style sheets rewritten,
            // the paging laid again, the position restored. Set, and done.
            // An apply already in flight takes the whole road, as does a
            // payload that changes nothing (a caller asking for a re-lay).
            if (!isResizing && behaviourAloneChanged(lastAppliedSettings, settings)) {
                lastAppliedSettings = settings;
                if (settings.pageTransition !== undefined) pageTransition = settings.pageTransition;
                if (settings.pageTapZone) pageTapZone = settings.pageTapZone;
                if (typeof settings.invertTapZones === 'boolean') invertTapZones = settings.invertTapZones;
                if (typeof settings.scrollAnimation === 'boolean') scrollAnimation = settings.scrollAnimation;
                if (typeof settings.nativeLineKeys === 'boolean') nativeLineKeys = settings.nativeLineKeys;
                return;
            }
            try {
                this._applySettingsImpl(settings);
            } catch (e) {
                // A throw mid-apply used to leave the page dimmed at opacity
                // 0.3 with isResizing stuck true — onScroll early-returns on
                // it, so position tracking died silently for the rest of the
                // session (#180). Restore visibility and resume tracking; the
                // settings that DID apply before the throw remain in effect.
                document.body.style.transition = 'opacity 0.15s ease';
                document.body.style.opacity = '1';
                setTimeout(function() { document.body.style.transition = ''; }, 200);
                isResizing = false;
            }
        },
        _applySettingsImpl: function(settings) {
            // Where an apply spends its time, when it spends more than it
            // should — printed by the reader under DEBUG. (#864's stall was
            // not here at all: WebKit's event-region pass over off-grid
            // text boxes, in the rendering update after the apply.)
            var _perfT0 = performance.now();
            lastAppliedSettings = settings;
            _pages = settings.pages || null;
            _textRTL = settings.textRTL === true;
            // The page runs the book's way (#1094): the html's dir sets the
            // text's direction and the columns' flow; WebKit's own bidi does
            // the lines. Cleared for an ltr book, so a reused page forgets.
            if (nativeRTLText()) document.documentElement.setAttribute('dir', 'rtl');
            else if (document.documentElement.getAttribute('dir') === 'rtl') document.documentElement.removeAttribute('dir');
            // Capture current reading position before reflow.
            // If already resizing (rapid successive calls — theme+font change,
            // OR a window resize fired before applySettings finished), reuse
            // whichever anchor is already in flight. Otherwise read fresh
            // from current scroll state.
            var anchor, anchorProgress;
            if (_pendingAnchor) {
                anchor = _pendingAnchor;
                anchorProgress = _pendingAnchorProgress;
            } else if (_resizeAnchorXpath
                       && (Date.now() - _resizeAnchorFrozenAt) < _settingsAnchorTTL * 2
                       && Math.abs((_resizeAnchorProgress || 0) - (lastKnownProgress || 0)) < 0.02) {
                // onResize already captured before we got called (e.g. iOS
                // fullscreen toggle: viewport resize fires together with
                // applySettings). Reuse its anchor so we don't recapture
                // mid-reflow. Guarded (#291): a frozen anchor is only valid
                // moments after its capture and only if it still describes
                // the position the user is at — an ORPHAN (release timer
                // killed by open-time resize/visibility churn) pointing at
                // the pre-restore book top yanked the first tint toggle to
                // the start of the book. Genuine anchors are copied FROM
                // lastKnown* at freeze time, so the progress-agreement check
                // is a no-op for them.
                anchor = _resizeAnchorXpath;
                anchorProgress = _resizeAnchorProgress;
            } else if (isPaged() && lastKnownXpath && lastKnownXpath !== '/html/body') {
                // Paged mode (#272): position state is written only by
                // genuine user actions (restores never touch it), so it is
                // strictly more trustworthy than a live read of the
                // current layout — which, during app-switch churn or a
                // hidden snapshot pass, describes a geometry the user
                // never saw.
                anchor = lastKnownXpath;
                anchorProgress = lastKnownProgress;
            } else if (isPaged() && (lastKnownProgress || 0) > 0) {
                // Progress-authority window (#272/#284): goToPage and the
                // paged restore stamp lastKnownProgress and NULL the xpath
                // until the next stable report re-derives it. A mode switch
                // landing inside that window used to fall through to the
                // live read below, which mid-churn legitimately reads all
                // zeroes — the anchor became "progress 0" and the book
                // jumped to its start (seen switching into scroll right
                // after open). The stamped progress is the user's real
                // position; use it (restore paths handle a null xpath by
                // scrolling to the progress fraction).
                anchor = null;
                anchorProgress = lastKnownProgress;
            } else {
                var pos = getCurrentPosition();
                // Atomic snapshot — both fields must come from the same
                // source. On cold start (book just opened, paging CSS
                // not yet applied) window.scrollY is 0, so
                // getCurrentPosition() returns the first paragraph at
                // the top of the document with progress 0. The old
                // expression `pos.xpath || lastKnownXpath` would take
                // pos.xpath (truthy), but `pos.progress || lastKnownProgress`
                // would short-circuit past the falsy 0 to lastKnownProgress
                // (the saved-on-disk value, e.g. 0.42). The mixed pair
                // "first-paragraph-xpath + saved-progress-far-in" then
                // passed the hasLiveCapture gate below and called
                // restorePositionPaged with the first paragraph's xpath
                // — whose only client rects live on page 0 — so the
                // book opened at page 0 regardless of where the user
                // had been reading. Symptom: paged-mode book always
                // reopened at the very start after close-reopen or
                // app relaunch.
                if (pos.scrollY > 0 || pos.progress > 0) {
                    anchor = pos.xpath;
                    anchorProgress = pos.progress;
                } else if (lastKnownXpath) {
                    anchor = lastKnownXpath;
                    anchorProgress = lastKnownProgress || 0;
                } else if ((lastKnownProgress || 0) > 0) {
                    // Same progress-authority guard for the scroll-mode /
                    // cold paths — never prefer a zero live read over a
                    // stamped position (#284).
                    anchor = null;
                    anchorProgress = lastKnownProgress;
                } else {
                    anchor = pos.xpath;
                    anchorProgress = 0;
                }
            }
            _pendingAnchor = anchor;
            _pendingAnchorProgress = anchorProgress;
            // Mirror into the resize-handler's anchor slots so a window
            // resize event arriving mid-reflow (the typical fullscreen-toggle
            // pattern on iOS: SwiftUI animates the safe area for ~180ms after
            // applySettings was already called) will pick up the same anchor
            // instead of recapturing lastKnownXpath, which by then points to
            // wherever applySettings just scrolled to — visible as the page
            // drifting backwards by 1 after every fullscreen toggle.
            // ...but NEVER before the initial restore has landed (#649 r2):
            // in the cold-open ordering this runs with the viewport still at
            // the top, and the mirrored "anchor" is the book's TITLE — a
            // fullscreen tap inside the anchor TTL then re-anchored the
            // whole session to the start. Until the restore is done, a
            // resize freezes lastKnownXpath instead, which restorePosition
            // set from the SAVED position on entry.
            if (_initialRestoreDone) {
                _resizeAnchorXpath = anchor;
                _resizeAnchorProgress = anchorProgress;
                _resizeAnchorFraction = lastKnownElementFraction;
                _resizeAnchorFrozenAt = Date.now();
            }

            // Update paging mode. The reader never says 'twoPage' any
            // more (#864) — it says 'page' and asks for a column count —
            // but a payload from an older reader is read the old way.
            var newMode = settings.navigationMode || 'scroll';
            if (newMode === 'twoPage') { newMode = 'page'; settings.pageColumns = '2'; }
            var modeChanged = newMode !== pagingMode;
            // The column count asked for (#864) — settled against the
            // width in applyPagingCSS. A change of count while the mode
            // stays paged is a flip of the same kind as page↔twoPage was.
            var newColumns = settings.pageColumns !== undefined ? String(settings.pageColumns) : pagingColumnsWanted;
            var columnsChanged = newColumns !== pagingColumnsWanted;
            pagingColumnsWanted = newColumns;
            if (typeof settings.columnsMinChars === 'number') columnsMinChars = settings.columnsMinChars;
            if (typeof settings.columnsNeedLandscape === 'boolean') columnsNeedLandscape = settings.columnsNeedLandscape;
            // Whether this flip crossed the scroll↔paged boundary. A
            // change of column count keeps xpath anchors fully valid (both
            // are column layouts, progress is a comparable fraction of the
            // same book), so the frozen anchor must SURVIVE it — on iPad
            // rotation the count flips with the width and the trailing
            // onResize restore needs that anchor; re-capturing from the
            // page top after every hop walked the position backwards a
            // page+ per rotation (#272).
            var crossedScrollBoundary = modeChanged && (newMode === 'scroll' || pagingMode === 'scroll');
            if (modeChanged) _pagedFlipAnchorHold = !crossedScrollBoundary;
            else if (columnsChanged && newMode === 'page') _pagedFlipAnchorHold = true;
            pagingMode = newMode;
            if (settings.pageTransition !== undefined) {
                pageTransition = settings.pageTransition;
            }
            if (settings.pageFlip !== undefined) {
                pageFlip = !!settings.pageFlip;
            }
            if (settings.pageCarriage !== undefined) {
                pageCarriage = !!settings.pageCarriage;
            }
            if (settings.pageCards !== undefined) {
                pageCards = !!settings.pageCards;
            }
            if (settings.pageSink !== undefined) {
                pageSink = !!settings.pageSink;
            }
            if (settings.pageCrumble !== undefined) {
                pageCrumble = !!settings.pageCrumble;
            }
            if (settings.isPhone !== undefined) {
                phoneDevice = !!settings.isPhone;
            }
            if (settings.pageSeparator) {
                pageSeparatorMode = settings.pageSeparator;
            }
            if (settings.pageSeparatorRest) {
                pageSeparatorRestMode = settings.pageSeparatorRest;
            }
            if (settings.pageTapZone) {
                pageTapZone = settings.pageTapZone;
            }
            if (typeof settings.topReservedZone === 'number') {
                topReservedZone = settings.topReservedZone;
            }
            if (typeof settings.invertTapZones === 'boolean') {
                invertTapZones = settings.invertTapZones;
            }
            if (typeof settings.pageTextureOpacity === 'number') _pageTextureOpacity = settings.pageTextureOpacity;
            if (typeof settings.pageTextureDark === 'boolean') _pageTextureDark = settings.pageTextureDark;
            if (typeof settings.pageTextureOn === 'boolean') _pageTextureOn = settings.pageTextureOn;
            // The wash is applied below, AFTER the page colour it paints
            // under itself is taken from these settings — applied here it
            // kept the previous theme's colour (user, 2026-09-23: a theme
            // change left the textured page in the old colour until the
            // book was closed and reopened).
            if (typeof settings.scrollAnimation === 'boolean') {
                scrollAnimation = settings.scrollAnimation;
            }
            if (typeof settings.nativeLineKeys === 'boolean') {
                nativeLineKeys = settings.nativeLineKeys;
            }

            // Suppress scroll tracking during reflow
            isResizing = true;
            clearTimeout(scrollTimer);
            scrollTimer = null;
            clearTimeout(scrollTrailingTimer);
            scrollTrailingTimer = null;

            // Dim content instantly to hide reflow
            document.body.style.transition = 'none';
            document.body.style.opacity = '0.3';

            // The East (#524, #1019): the book's language, declared or
            // read off its text — and declared on the page when it was not,
            // so WebKit's line breaking and its font fallback know it too.
            var _bookLang = document.documentElement.lang || detectLanguage();
            var _east = /^(zh|ja|ko)/i.test(_bookLang) ? _bookLang.slice(0, 2).toLowerCase() : null;
            if (_east && !document.documentElement.lang) document.documentElement.lang = _bookLang;
            // A Latin face has no hanzi, and WebKit fell back to the
            // system's sans for every one — the serif choice meant nothing
            // in a Chinese book. The CJK face of the same kind goes in
            // before the generic family: Song or Mincho for a serif, the
            // system's Gothic for the rest.
            var fontFamily = settings.fontFamily;
            if (_east && fontFamily) {
                var _serif = /,\s*serif\s*$/.test(fontFamily);
                var _cjkFace = {
                    zh: _serif ? 'Songti SC, STSong' : 'PingFang SC',
                    ja: _serif ? 'Hiragino Mincho ProN' : 'Hiragino Sans',
                    ko: _serif ? 'AppleMyungjo' : 'Apple SD Gothic Neo'
                }[_east];
                fontFamily = fontFamily.replace(/,\s*(serif|sans-serif|monospace)\s*$/, ', ' + _cjkFace + ', $1');
            }

            // Apply CSS changes
            var root = document.documentElement.style;
            if (fontFamily) root.setProperty('--font-family', fontFamily);
            if (settings.fontSize) root.setProperty('--font-size', settings.fontSize + 'px');
            if (settings.lineHeight) root.setProperty('--line-height', String(settings.lineHeight));
            if (settings.maxWidth) root.setProperty('--max-width', settings.maxWidth);
            if (settings.bgColor) { root.setProperty('--bg-color', settings.bgColor); _pageBgColor = settings.bgColor; }
            if (settings.textColor) root.setProperty('--text-color', settings.textColor);
            applyPageTexture();

            // Text indent — override via injected stylesheet rule
            // to work with both old (hardcoded) and new (CSS variable) HTML
            // Chinese indents two characters, Japanese and Korean one; and
            // every paragraph, the first after a heading too (#524).
            var indentValue = settings.textIndent
                ? (_east === 'zh' ? '2em' : (_east ? '1em' : '1.5em')) : '0';
            root.setProperty('--text-indent', indentValue);
            var indentSheet = document.getElementById('_indent_override');
            if (!indentSheet) {
                indentSheet = document.createElement('style');
                indentSheet.id = '_indent_override';
                document.head.appendChild(indentSheet);
            }
            var alignValue = settings.textAlign || 'left';
            // The start of the line, not the left of the page (#1094): an
            // rtl book's "left" alignment is its right. Same in ltr.
            if (alignValue === 'left') alignValue = 'start';
            else if (alignValue === 'right') alignValue = 'end';
            // Comfort (#915, user): the face decides the alignment — the
            // serif book justified, the sans screen ragged — except that a
            // Cyrillic book is justified either way: that is how a book
            // is set in Russian and Ukrainian, and a reader there expects
            // it on the screen too.
            // A Chinese, Japanese or Korean page is set justified too.
            if (settings.comfort) {
                if (/^(ru|uk|be|bg|sr|mk|kk|zh|ja|ko)/i.test(_bookLang)) alignValue = 'justify';
            }
            var spacingValue = settings.paragraphSpacing || '0.6em';
            var hyphenValue = settings.hyphenation ? 'auto' : 'none';
            if (settings.hyphenation && !document.documentElement.lang) {
                document.documentElement.lang = detectLanguage();
            }
            // `line-break: strict`: the kinsoku rules in full — no line
            // opens on 。、」 or a small kana.
            indentSheet.textContent = 'p { text-indent: ' + indentValue + ' !important; text-align: ' + alignValue + ' !important; margin-bottom: ' + spacingValue + ' !important; -webkit-hyphens: ' + hyphenValue + ' !important; hyphens: ' + hyphenValue + ' !important;' + (_east ? ' line-break: strict !important;' : '') + ' }' + (_east === 'zh' || _east === 'ja' ? '' : ' p:first-of-type { text-indent: 0 !important; }') + ' h1, h2, h3, h4, h5, h6 { -webkit-hyphens: none !important; hyphens: none !important; }';

            // Font/size/line-height override for old books with hardcoded CSS
            var styleSheet = document.getElementById('_settings_override');
            if (!styleSheet) {
                styleSheet = document.createElement('style');
                styleSheet.id = '_settings_override';
                document.head.appendChild(styleSheet);
            }
            var fontWeightVal = settings.fontWeight || 400;
            var fontStretchVal = settings.fontStretch || 'normal';
            styleSheet.textContent =
                'html { background-color: ' + settings.bgColor + ' !important; overflow-x: hidden !important; }' +
                ' html, body { font-family: ' + fontFamily + ' !important;' +
                ' font-size: ' + settings.fontSize + 'px !important;' +
                ' line-height: ' + settings.lineHeight + ' !important;' +
                ' font-weight: ' + fontWeightVal + ' !important;' +
                ' font-stretch: ' + fontStretchVal + ' !important;' +
                ' color: ' + settings.textColor + ' !important; }' +
                ' body { background-color: transparent !important;' +
                ' -webkit-text-size-adjust: 100% !important; text-size-adjust: 100% !important;' +
                ' max-width: ' + (settings.maxWidth || 'none') + ' !important; margin-left: auto !important; margin-right: auto !important; }' +
                // #138: keep wide / unbreakable content inside the column so the
                // paged (two-page) right edge isn't clipped. `overflow-wrap:
                // break-word` only breaks a token that would otherwise overflow
                // (long URLs/tokens) — normal text still wraps at spaces. Media,
                // tables and <pre> are capped to the content width.
                ' html, body { overflow-wrap: break-word !important; }' +
                ' img, svg, picture, video, iframe { max-width: 100% !important; }' +
                ' table { max-width: 100% !important; table-layout: fixed !important; }' +
                // `word-break: normal` in tables (2026-09-17): the template's
                // `break-word` on the body let a cell's min-content shrink to
                // ONE letter, and the auto layout gave a drama table's
                // speaker column exactly that — "H / ar / ris" down the page
                // beside the lines. `overflow-wrap` still breaks a token that
                // cannot fit; it does not shrink the column's minimum.
                ' table { word-break: normal !important; }' +
                ' td, th { overflow-wrap: break-word !important; }' +
                // A play's speaker (Standard Ebooks' z3998:persona) stands at
                // the top of its line and keeps a breath from it.
                ' td[type~="z3998:persona"] { vertical-align: top !important; padding-right: 1em !important; -webkit-hyphens: none !important; hyphens: none !important; }' +
                ' pre, code { white-space: pre-wrap !important; overflow-wrap: break-word !important; max-width: 100% !important; }' +
                // Ruby (#1019): the reading over its kanji at half size, its
                // own line height so it does not open the line under it.
                ' ruby { ruby-position: over; } rt { font-size: 0.5em !important; line-height: 1 !important; text-indent: 0 !important; }' +
                // Illustrations stand centred (user, 2026-09-10): a book's
                // own stylesheet does not survive the import, and Gutenberg's
                // `.fig`, `.figcenter`, `figure` and their kin lost the
                // centring it gave them. A picture alone in its block is an
                // illustration; a picture inside a run of text stays put.
                ' figure, .fig, .figcenter, .figleft, .figright, .image, .illus, .illustration { text-align: center; margin: 1em 0; }' +
                ' div > img:only-child, p > img:only-child, section > img:only-child { display: block; margin: 1em auto; }' +
                // A wrapper whose picture was removed from the book (the
                // card's Remove All, 2026-09-20) stays in the DOM so the
                // tag-indexed xpaths around it hold — and folds away here.
                ' .book-image:empty, figure:empty, .image:empty, .illus:empty, .illustration:empty { display: none !important; margin: 0 !important; }' +
                monoImageCSS(settings) +
                pagesFlowCSS();
            applyPagesTint(settings);


            // Padding: always set explicitly (0 = no padding, overrides browser default 8px)
            var body = document.body.style;
            // Comfort (#915) settles the padding itself, from the measure.
            _comfort = settings.comfort || null;
            _comfortStrip = Number(settings.comfortStrip) || 0;
            var padPx = settings.padding;
            if (_comfort) {
                padPx = comfortPadding(settings.navigationMode === 'page', settings.pageColumns);
            }
            body.paddingLeft = padPx + 'px';
            body.paddingRight = padPx + 'px';
            // #649 - scroll mode's top clearance when the host full-bleeds
            // the frame under the sensor housing. Paged mode is untouched:
            // its stylesheet's !important padding-top wins over this inline
            // value, and the paged->scroll cleanup below re-asserts it.
            // Comfort's clearance is its own (#915): two lines, the same
            // above the strip.
            // The housing clearance still counts under Comfort (#919): the
            // phone's page runs under the sensor housing in fullscreen.
            if (!isPaged()) {
                var housingPad = settings.scrollTopPad > 0 ? settings.scrollTopPad : 0;
                var topPad = _comfort ? Math.max(comfortTopPad(), housingPad) : housingPad;
                body.paddingTop = topPad > 0 ? topPad + 'px' : '';
                body.paddingBottom = _comfort ? comfortTopPad() + 'px' : '';
            }

            // Link styles
            var linkColor = settings.linkColor || '';
            if (linkColor) {
                var linkSheet = document.getElementById('_link_override');
                if (!linkSheet) {
                    linkSheet = document.createElement('style');
                    linkSheet.id = '_link_override';
                    document.head.appendChild(linkSheet);
                }
                linkSheet.textContent =
                    'a { color: ' + linkColor + ' !important; text-decoration: underline !important; text-underline-offset: 2px; }' +
                    ' a:visited { color: ' + linkColor + ' !important; }' +
                    ' a.footnote-ref { text-decoration: none !important; border-bottom: none !important; font-size: 0.75em !important; vertical-align: super !important; line-height: 0 !important; opacity: 0.7; }';
            }

            // Footnote popup styles
            var fnSheet = document.getElementById('_footnote_override');
            if (!fnSheet) {
                fnSheet = document.createElement('style');
                fnSheet.id = '_footnote_override';
                document.head.appendChild(fnSheet);
            }
            fnSheet.textContent =
                ' ._cr_fn_content p { text-indent:0; margin:0 0 0.4em; text-align:left; }' +
                ' ._cr_fn_content p:last-child { margin-bottom:0; }' +
                ' ._cr_fn_content h1, ._cr_fn_content h2, ._cr_fn_content h3 { display:none; }';

            // Image display mode
            applyImageDisplay(settings);

            // Norton Commander frame (Terminal theme only)
            // Norton frame follows the user toggle directly — earlier
            // we suppressed it on `isPhone && isFullscreen`, but the
            // toggle is hidden from no setting page, so when the user
            // flips it on they expect to see the frame regardless of
            // FS state on iPhone. (The brand-name bottom bar styling
            // still hides itself in iPhone FS via Swift isNortonMode,
            // independently — that's a different surface.)
            var nortonActive = !!settings.nortonFrame;
            if (settings.nortonInk) {
                _nortonColors = { ink: settings.nortonInk, plate: settings.nortonPlate,
                                  hit: settings.nortonHit, hitInk: settings.nortonHitInk };
            }
            // First pass publishes _nortonTopInset/_nortonBottomInset that
            // applyPagingCSS reads for its column math.
            applyNortonFrame(settings, nortonActive);

            // Apply paging CSS (must be after padding is set)
            applyPagingCSS();
            // The column moved with the padding (#915) even where the
            // count did not — the strip on it has to know.
            if (_comfort) postPageLayout();

            // Rebuild the rim AFTER applyPagingCSS. Switching to scroll mode it
            // toggles `body.display:none` + forces a reflow to clear column
            // artifacts — which disrupts the rim panels (they're body children),
            // so on a scroll↔page flip the cyan frame vanished or slid into the
            // middle until a fullscreen toggle (its onResize) rebuilt it (#94).
            // Re-running it here recreates the rim on the settled layout.
            applyNortonFrame(settings, nortonActive);

            // Scroll-mode edge masks (stores bgColor for mask use)
            _scrollMaskBgColor = settings.bgColor || '#ffffff';
            applyScrollMasks(frameIsOn(settings, nortonActive));

            // Trailing re-assert so a rapid mode-switch burst can't leave the
            // rim disrupted (#94).
            scheduleNortonRebuild();

            // Restore position after reflow, then fade back in
            var isInitialPagedRestore = isInitialRestorePending && isPaged() && modeChanged;
            var restoreDelay = isPaged() ? 80 : 30;
            var _perfCall = performance.now() - _perfT0;
            // #720 - while this reflow's restore is pending, the plain
            // restore paths must not report 'restored'; this branch owns it.
            if (modeChanged) { _modeFlipInFlight = true; }
            setTimeout(function() {
                var _perfR0 = performance.now();
                if (isInitialPagedRestore) {
                    // Initial load: paging CSS just applied. Prefer the
                    // captured anchor when it actually reflects user
                    // position (covers the rapid scroll→paged→FS race
                    // on a cold start, where _initialRestoreXpath is
                    // stale or the saved-on-disk position from the
                    // previous session and the user has already moved
                    // past it in scroll mode — picking _initialRestore*
                    // there visibly jumps the page back to the saved /
                    // book-start position). Only fall back to the
                    // saved initial values when the captured anchor is
                    // empty (e.g. genuine open-book-in-paged path
                    // where the user hasn't yet scrolled).
                    var hasLiveCapture = anchor && anchor !== '/html/body' && (anchorProgress || 0) > 0;
                    var xp = hasLiveCapture ? anchor : (_initialRestoreXpath || anchor);
                    var pr = hasLiveCapture ? anchorProgress : (_initialRestoreProgress || anchorProgress);
                    computeTotalPages();
                    restorePositionPaged(xp, pr);
                    isInitialRestorePending = false;
                    _initialRestoreDone = true;
                    invalidateStickyAnchor();
                    _initialRestoreXpath = null;
                    var restoredAt = document.documentElement.scrollLeft;
                    whenPagePainted(function () {
                        if (window.webkit && window.webkit.messageHandlers.positionRestored) {
                            window.webkit.messageHandlers.positionRestored.postMessage({ scrollY: restoredAt });
                        }
                        reportIfWholeBookOnScreen();
                    });
                } else if (!isInitialRestorePending) {
                    if (isPaged()) {
                        computeTotalPages();
                        restorePositionPaged(anchor, anchorProgress);
                    } else if (anchor && anchor !== '/html/body') {
                        // Use xpath + element fraction for sub-element precision
                        var node = getNodeByXPath(anchor);
                        if (node) {
                            var rect = node.getBoundingClientRect();
                            var absTop = rect.top + window.scrollY;
                            var offset = lastKnownElementFraction * rect.height;
                            window.scrollTo(0, absTop + offset);
                        }
                    } else if (anchorProgress > 0) {
                        // Fallback: progress-based scroll
                        var total = document.body.scrollHeight - window.innerHeight;
                        if (total > 0) {
                            window.scrollTo(0, anchorProgress * total);
                        }
                    }
                }
                _modeFlipInFlight = false;
                // #720 safety, MODE FLIPS ONLY (r2 - the phone found the
                // hole day one): an initial post deferred by the flag while
                // this flip branch did not own the restore reports now,
                // post-reflow. WITHOUT the modeChanged gate this ran on
                // EVERY applySettings timeout - a plain settings apply
                // during a still-running scroll restore posted 'restored'
                // at scroll=0, revealed the book at its start, and the real
                // restore landed after the door had closed (visible jump,
                // and a tap in that window overwrote the position with 0).
                //
                // #1040: only a post that WAS deferred. Opening a book the
                // settings come first and flip it to paged; the paged restore
                // waits for the column width to settle (50 ms, then 100 ms
                // steps) and had not tried to post when this timeout (80 ms)
                // fired — the safety posted at scroll 0, the book showed its
                // first page, and the restore jumped it ~70 ms later.
                if (modeChanged) {
                    if (_initialPostDeferred && isInitialRestorePending && !isInitialPagedRestore) {
                        postInitialRestored(isPaged() ? document.documentElement.scrollLeft : window.scrollY);
                    }
                }
                isResizing = false;
                _pendingAnchor = null;
                _pendingAnchorProgress = 0;
                clearTimeout(_resizeAnchorCleanup);
                if (modeChanged && crossedScrollBoundary) {
                    // After a scroll ↔ paged flip the captured anchor's
                    // progress is in the OLD mode's terms and means
                    // nothing in the new one. If we leave the
                    // anchor around for the usual 500ms grace window
                    // and the user rapid-fires another event (e.g.
                    // toggles fullscreen right after switching paged),
                    // onResize would re-use the stale scroll-mode
                    // progress to pick a paged page — visible as
                    // "position jumps to the start of the book".
                    // A column-count flip deliberately KEEPS the anchor
                    // (see crossedScrollBoundary above) so the rotation's
                    // trailing onResize restores to the same element (#272).
                    _resizeAnchorXpath = null;
                    _resizeAnchorProgress = 0;
                    _resizeAnchorFraction = 0;
                } else {
                    // Keep the frozen anchor alive across the whole settings
                    // adjustment burst (#82): the next change within the window
                    // reuses THIS anchor instead of re-capturing the (already
                    // reflow-shifted) top paragraph, so repeated slider nudges
                    // don't creep the position. Also covers a follow-up
                    // window.resize still on its way (iOS fullscreen animation
                    // finishes ~180ms after the state change). Cleared sooner by
                    // invalidateStickyAnchor on a genuine page-turn / scroll.
                    scheduleAnchorRelease(_settingsAnchorTTL);
                }

                var _perfRestore = performance.now() - _perfR0;
                if (_perfCall > 150 || _perfRestore > 150) {
                    jsLog('[perf] applySettings: call ' + Math.round(_perfCall) + ' ms, restore ' + Math.round(_perfRestore)
                          + ' ms, columns ' + pagingColumns + ', spreads ' + totalPages + ', mode ' + pagingMode);
                }

                // Fade back in
                document.body.style.transition = 'opacity 0.15s ease';
                document.body.style.opacity = '1';
                setTimeout(function() {
                    document.body.style.transition = '';
                }, 200);
            }, restoreDelay);

            // Safety: guarantee fade-back after max 400ms. Tracked so a
            // resize burst / visibility return can cancel it — a stale
            // safety firing into a LIVE later burst revealed mid-reflow
            // content and force-cleared isResizing, letting reflow scrolls
            // kill the frozen anchor (#272 audit; same orphaned-timer
            // class scheduleAnchorRelease fixed for the anchor release).
            clearTimeout(_applySafetyTimer);
            _applySafetyTimer = setTimeout(function() {
                if (document.body.style.opacity !== '1') {
                    document.body.style.transition = 'opacity 0.15s ease';
                    document.body.style.opacity = '1';
                    setTimeout(function() { document.body.style.transition = ''; }, 200);
                }
                isResizing = false;
            }, 400);
        }
    };

    // --- Activity tracking for interaction-based reading time ---

    window._lastActivityTime = Date.now();
    var _activityDebounceTimer = null;

    function notifyActivity() {
        window._lastActivityTime = Date.now();
        if (_activityDebounceTimer) return;
        _activityDebounceTimer = setTimeout(function() {
            _activityDebounceTimer = null;
            if (window.webkit && window.webkit.messageHandlers.userActivity) {
                window.webkit.messageHandlers.userActivity.postMessage({});
            }
        }, 30000); // max every 30s
        // Send immediately on first interaction
        if (window.webkit && window.webkit.messageHandlers.userActivity) {
            window.webkit.messageHandlers.userActivity.postMessage({});
        }
    }

    // Hook activity detection into user interaction events
    window.addEventListener('scroll', function() { notifyActivity(); }, { passive: true });
    document.addEventListener('keydown', function() { notifyActivity(); }, { passive: true });
    document.addEventListener('touchstart', function() { notifyActivity(); }, { passive: true });
    document.addEventListener('wheel', function() { notifyActivity(); }, { passive: true });
    document.addEventListener('dblclick', function() { notifyActivity(); }, { passive: true });

    // Background/foreground layout guard (#272). Position state
    // (lastKnownXpath/Progress) is written ONLY by genuine user actions —
    // restores and snapshot churn never touch it (see reportPagePosition,
    // plus the document.hidden guards in onScroll / onResize /
    // fireScrollReport and the isResizing guard in the page-snap
    // listener). So on return the job is purely mechanical: repair the
    // paged layout if its CSS is stamped for a geometry the window no
    // longer has, put the (trustworthy) anchor back on screen, reveal.
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) return;
        // Cancel resize machinery left over from a hide-time burst — its
        // timers would run against post-resume geometry with a pre-hide
        // anchor lifecycle.
        clearTimeout(resizeTimer);
        clearTimeout(resizeSafetyTimer);
        clearTimeout(scrollTrailingTimer);
        scrollTrailingTimer = null;
        // The drift-snap timer too (#272 audit): hidden-time snapshot
        // scrolls arm it, and if the process suspends before its 120ms
        // elapse, it fires on resume BEFORE our repair rAF — snapping
        // (and anchor-stamping) against the not-yet-repaired geometry.
        clearTimeout(pageSnapTimer);
        // And the applySettings 400ms fade-back safety — it force-clears
        // isResizing, which must not fire into the post-resume window.
        clearTimeout(_applySafetyTimer);
        isResizing = false;
        // The frozen resize anchor's release timer regime is being torn
        // down with the rest of the burst — drop the anchor itself too
        // (#291): the return pass restores from lastKnown* (post-#272
        // design), and a surviving orphan poisons the next applySettings.
        invalidateStickyAnchor();
        // If the layout on file is a snapshot-pass one, make sure the body
        // is hidden BEFORE the first post-resume paint — otherwise the
        // stale layout flashes scaled to the real window ("huge text").
        // Usually already done by onResize's hidden branch; this covers a
        // hidden-time relayout whose resize event never got delivered.
        if (isPaged() && (_appliedPagingW !== window.innerWidth || _appliedPagingH !== window.innerHeight)) {
            document.body.style.transition = 'none';
            document.body.style.opacity = '0';
        }
        // One frame for WebKit to settle the resumed viewport size before
        // reading innerWidth/innerHeight.
        requestAnimationFrame(function() {
            // Re-hidden before the frame ran (fast switcher bounce): leave
            // everything frozen/hidden — the next visible pass handles it.
            if (document.hidden) return;
            if (isPaged()) {
                if (_appliedPagingW !== window.innerWidth || _appliedPagingH !== window.innerHeight) {
                    // Column CSS is stamped for a size the window no longer
                    // has (four narrow columns / half-width top rule).
                    applyPagingCSS();
                    restorePositionPaged(lastKnownXpath, lastKnownProgress);
                } else if (Math.abs(document.documentElement.scrollLeft - pageToX(currentPage)) > 2) {
                    // Geometry intact but the scroll drifted (WebKit offset
                    // restoration quirks / an interim bounce restore) —
                    // put the anchor back on screen. With an untouched
                    // layout this lands on the spread the user left.
                    restorePositionPaged(lastKnownXpath, lastKnownProgress);
                }
            }
            // Reveal — also clears the hide applied when a snapshot-pass
            // resize was seen while hidden / a dim left by a resize burst.
            _hiddenResizeSeen = false;
            document.body.style.transition = '';
            document.body.style.opacity = '1';
            document.body.style.filter = '';
        });
    });

    // Page Visibility API — sends hidden/visible transitions to Swift
    // so the reading-time ticker has a second-layer signal alongside
    // SwiftUI's scenePhase. Covers iOS edge cases where scenePhase
    // reports .active while the WebView's `document.visibilityState`
    // is `hidden` (system overlays, picture-in-picture, certain
    // split-screen / Standby modes). Fires once immediately so the
    // Swift side starts with a known value rather than the default.
    function notifyVisibility() {
        if (window.webkit && window.webkit.messageHandlers.visibilityChanged) {
            window.webkit.messageHandlers.visibilityChanged.postMessage({
                hidden: document.hidden === true
            });
        }
    }
    document.addEventListener('visibilitychange', notifyVisibility);
    notifyVisibility();

    // --- Norton elapsed label ---

    window._nortonElapsedStr = '-:--';

    // --- Elapsed time API (called from Swift) ---

    window.PositionTracker.updateElapsedTime = function(seconds, paused) {
        if (paused || seconds < 30) {
            window._nortonElapsedStr = '-:--';
        } else {
            var h = Math.floor(seconds / 3600);
            var m = Math.floor((seconds % 3600) / 60);
            var s = seconds % 60;
            if (h > 0) {
                window._nortonElapsedStr = h + ':' + m.toString().padStart(2,'0') + ':' + s.toString().padStart(2,'0');
            } else {
                window._nortonElapsedStr = m + ':' + s.toString().padStart(2,'0');
            }
        }
        // Update combined Norton label (elapsed is part of the right-side legend)
        var el = document.getElementById('_norton_legend_r');
        if (el && document.getElementById('_norton_border')) {
            var now = new Date();
            var time = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
            var date = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
            el.textContent = window._nortonElapsedStr + ' \u2502 ' + date + ', ' + time;
        }
    };

    // --- Selection change listener for auto-translate ---

    document.addEventListener('selectionchange', function() {
        notifyActivity();
        clearTimeout(window._selectionTimer);
        window._selectionTimer = setTimeout(function() {
            var text = (window.getSelection() || '').toString().trim();
            if (!window.webkit || !window.webkit.messageHandlers.selectionChanged) { return; }
            if (text.length > 0) {
                window._lastSelNonEmpty = true;
                window.webkit.messageHandlers.selectionChanged.postMessage(text);
            } else if (window._lastSelNonEmpty) {
                // #610 r39 — report the CLEAR too (once, on the edge): the
                // reader's ⌘B capture preview kept showing the last
                // selection because nobody ever said it was gone.
                window._lastSelNonEmpty = false;
                window.webkit.messageHandlers.selectionChanged.postMessage('');
            }
        }, 500);
    });

    // --- The mark a selection stands in (user, 2026-11-06) ---
    // Told at once, not after the translate pause: the selection menu is
    // built the moment it comes up and asks for it then. On the Mac a
    // right click names the mark under the pointer too.

    function markIdAt(node) {
        var el = node && (node.nodeType === 1 ? node : node.parentElement);
        var mark = el && el.closest ? el.closest('[data-crbm]') : null;
        return mark ? mark.getAttribute('data-crbm') : '';
    }
    function reportSelectionMark(id) {
        if (id === window._lastSelMark) return;
        window._lastSelMark = id;
        if (window.webkit && window.webkit.messageHandlers.selectionMark) {
            window.webkit.messageHandlers.selectionMark.postMessage(id);
        }
    }
    document.addEventListener('selectionchange', function() {
        var sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { reportSelectionMark(''); return; }
        reportSelectionMark(markIdAt(sel.anchorNode) || markIdAt(sel.focusNode));
    });
    document.addEventListener('contextmenu', function(e) {
        reportSelectionMark(markIdAt(e.target));
    }, true);

    // --- srcset left by an older import (2026-11-12) ---
    // The converter drops `srcset` now; a book imported before still
    // carries the EPUB's own candidates — paths that never existed in the
    // book's folder — and WebKit takes them over the `src` the importer
    // rewrote: a broken picture. Without them the picture loads its `src`.
    (function () {
        var withSet = document.querySelectorAll('img[srcset], source[srcset]');
        for (var i = 0; i < withSet.length; i++) withSet[i].removeAttribute('srcset');
    })();

    jsLog('PositionTracker initialized');
})();
