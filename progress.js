// Comfort's position bar: rectangles only, no frame. Under the pointer a
// marker runs along the bar with a bubble — the per cent and the page that
// spot would open; a press or a drag scrubs, the release goes there. A
// book that reads right to left fills its bar from the right.

import { pageLabel } from './i18n.js';

export function progressBar(host, { onGo, pageAt }) {
    const bar = document.createElement('div');
    bar.className = 'progress';
    bar.setAttribute('role', 'slider');
    bar.setAttribute('aria-label', 'Position in the book');
    bar.tabIndex = -1;
    const cells = document.createElement('div');
    cells.className = 'cells';
    const marker = document.createElement('div');
    marker.className = 'marker';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    marker.appendChild(bubble);
    bar.append(cells, marker);
    host.appendChild(bar);

    let value = 0, rtl = false, scrub = null, target = null, hover = null, count = 0;

    const fractionAt = (x) => {
        const box = cells.getBoundingClientRect();
        const f = Math.min(1, Math.max(0, (x - box.left) / Math.max(1, box.width)));
        return rtl ? 1 - f : f;
    };

    function layout() {
        const n = Math.max(8, Math.floor(cells.clientWidth / 9));
        if (n !== count) {
            count = n;
            cells.replaceChildren(...Array.from({ length: n }, () => document.createElement('i')));
        }
        draw();
    }

    function draw() {
        const shown = scrub ?? target ?? value;
        const n = cells.children.length;
        for (let i = 0; i < n; i++) {
            const k = rtl ? n - 1 - i : i;
            cells.children[i].classList.toggle('on', (k + 1) / n <= shown + 0.5 / n);
        }
        bar.setAttribute('aria-valuenow', String(Math.round(value * 100)));
        const pointed = scrub ?? hover;
        marker.hidden = pointed === null;
        if (pointed === null) return;
        const width = cells.clientWidth;
        const x = (rtl ? 1 - pointed : pointed) * width;
        marker.style.transform = `translateX(${x}px)`;
        const page = pageAt(pointed);
        bubble.textContent = `${Math.round(pointed * 100)}%` + (page ? ` · ${pageLabel(page)}` : '');
        // Kept inside the bar's width.
        const half = bubble.offsetWidth / 2;
        bubble.style.transform = `translateX(${Math.min(Math.max(-half, -x), width - x - 2 * half)}px)`;
    }

    bar.addEventListener('pointermove', (event) => { hover = fractionAt(event.clientX); if (scrub !== null) scrub = hover; draw(); });
    bar.addEventListener('pointerleave', () => { if (scrub === null) { hover = null; draw(); } });
    bar.addEventListener('pointerdown', (event) => {
        bar.setPointerCapture(event.pointerId);
        scrub = hover = fractionAt(event.clientX);
        draw();
    });
    const release = (event) => {
        if (scrub === null) return;
        const f = fractionAt(event.clientX);
        scrub = null;
        target = f;
        if (event.pointerType !== 'mouse') hover = null;
        draw();
        onGo(f);
        // The page will report; if it never does, the bar follows the page
        // again after a while.
        setTimeout(() => { if (target === f) { target = null; draw(); } }, 1500);
    };
    bar.addEventListener('pointerup', release);
    bar.addEventListener('pointercancel', () => { scrub = null; hover = null; draw(); });

    new ResizeObserver(layout).observe(cells);

    return {
        set(progress, rightToLeft) {
            value = progress;
            if (rtl !== rightToLeft) rtl = rightToLeft;
            if (target !== null && Math.abs(progress - target) < 0.02) target = null;
            draw();
        },
        get value() { return value; },
    };
}
