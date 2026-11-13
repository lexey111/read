// The home's band: a lattice drawn anew from a seed — eight-pointed stars
// with their crosses, six-pointed stars, the hemp leaf, or Truchet's arcs —
// each with its own size, strap and stones. The same seed gives the same
// tile; the shell changes the seed when another book is opened.

/// A small, fair generator from a 32-bit seed (mulberry32).
function generator(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const f = (v) => +v.toFixed(2);
const polygon = (points) => 'M' + points.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
const ring = (cx, cy, r, n, turn = 0) => polygon(Array.from({ length: n }, (_, i) => {
    const angle = turn + (i * 2 * Math.PI) / n;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}));
const circle = (cx, cy, r) => `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;

/// Every motif drawn at the tile's corners and middle too, so the tile
/// meets its neighbours without a seam.
const around = (W, H, draw) => [-W, 0, W].flatMap((dx) => [-H, 0, H].map((dy) => draw(dx, dy))).join('');

const families = {
    /// Two squares crossed into a star, its tips meeting the neighbours'
    /// or joined to them by a strap; crosses open between.
    stars8(rand, pick) {
        const S = pick([150, 170, 190, 210]);
        const d = S * (rand() < 0.5 ? 0.5 : 0.36 + rand() * 0.1);
        const h = d / Math.SQRT2;
        const links = d < S * 0.49;
        const diagonal = rand() < 0.4;
        const stone = pick(['diamond', 'octagon', 'square', 'none']);
        const corner = pick(['square', 'diamond', 'star', 'none']);
        const lines = around(S, S, (dx, dy) => {
            const c = S / 2 + dx, m = S / 2 + dy;
            let p = `M${f(c - h)} ${f(m - h)}H${f(c + h)}V${f(m + h)}H${f(c - h)}Z` + ring(c, m, d, 4, -Math.PI / 2);
            if (links) p += `M${f(c)} ${f(m - d)}V${f(m - S / 2)}M${f(c)} ${f(m + d)}V${f(m + S / 2)}M${f(c - d)} ${f(m)}H${f(c - S / 2)}M${f(c + d)} ${f(m)}H${f(c + S / 2)}`;
            if (diagonal) p += [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, y]) => `M${f(c + x * h)} ${f(m + y * h)}L${f(c + x * S / 2)} ${f(m + y * S / 2)}`).join('');
            return p;
        });
        const stones = around(S, S, (dx, dy) => {
            const c = S / 2 + dx, m = S / 2 + dy;
            let p = { diamond: ring(c, m, d * 0.28, 4), octagon: ring(c, m, d * 0.3, 8, Math.PI / 8), square: ring(c, m, d * 0.24, 4, Math.PI / 4), none: '' }[stone];
            p += { square: ring(dx, dy, S * 0.07, 4, Math.PI / 4), diamond: ring(dx, dy, S * 0.09, 4), star: ring(dx, dy, S * 0.08, 4, Math.PI / 4) + ring(dx, dy, S * 0.08, 4), none: '' }[corner];
            return p;
        });
        return { W: S, H: S, lines, stones, strap: S / 28 };
    },

    /// Six-pointed stars on a triangular lattice, pointing at each other.
    stars6(rand, pick) {
        const S = pick([130, 150, 170]);
        const H = S * Math.sqrt(3);
        const r = S * (rand() < 0.4 ? 0.5 : 0.36 + rand() * 0.1);
        const links = r < S * 0.49;
        const stone = pick(['hexagon', 'circle', 'none']);
        const gaps = rand() < 0.5;
        const centres = (dx, dy) => [[dx, dy], [dx + S / 2, dy + H / 2]];
        const lines = around(S, H, (dx, dy) => centres(dx, dy).map(([x, y]) => {
            let p = ring(x, y, r, 3) + ring(x, y, r, 3, Math.PI / 3);
            if (links) p += Array.from({ length: 6 }, (_, i) => {
                const a = (i * Math.PI) / 3;
                return `M${f(x + r * Math.cos(a))} ${f(y + r * Math.sin(a))}L${f(x + (S / 2) * Math.cos(a))} ${f(y + (S / 2) * Math.sin(a))}`;
            }).join('');
            return p;
        }).join(''));
        const stones = around(S, H, (dx, dy) => centres(dx, dy).map(([x, y]) => {
            let p = { hexagon: ring(x, y, r * 0.3, 6, Math.PI / 6), circle: circle(x, y, r * 0.22), none: '' }[stone];
            if (gaps) p += circle(x + S / 2, y + H / 6, S * 0.04) + circle(x, y + H / 3, S * 0.04);
            return p;
        }).join(''));
        return { W: S, H, lines, stones, strap: S / 30 };
    },

    /// The hemp leaf: a triangular grid, every triangle's corners joined
    /// to its middle; some triangles tinted.
    asanoha(rand, pick) {
        const S = pick([90, 110, 130]);
        const H = S * Math.sqrt(3);
        const tint = pick(['up', 'down', 'none']);
        const point = (i, j) => [i * S + (j * S) / 2, (j * H) / 2];
        let lines = '', stones = '';
        for (let j = -2; j <= 3; j++) {
            for (let i = -3; i <= 3; i++) {
                const up = [point(i, j), point(i + 1, j), point(i, j + 1)];
                const down = [point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)];
                for (const [kind, t] of [['up', up], ['down', down]]) {
                    const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3;
                    lines += polygon(t) + t.map(([x, y]) => `M${f(x)} ${f(y)}L${f(cx)} ${f(cy)}`).join('');
                    if (tint === kind) stones += polygon(t.map(([x, y]) => [cx + (x - cx) * 0.42, cy + (y - cy) * 0.42]));
                }
            }
        }
        return { W: S, H, lines, stones, strap: S / 32 };
    },

    /// Truchet's quarter circles: each cell turned at random, the arcs
    /// running on as one endless strap.
    truchet(rand, pick) {
        const n = pick([4, 5, 6]);
        const cell = pick([40, 48, 56]);
        const rings = rand() < 0.5 ? [0.5] : [1 / 3, 2 / 3];
        const dots = rand() < 0.5;
        const W = n * cell;
        let lines = '', stones = '';
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                const turned = rand() < 0.5;
                const x0 = x * cell, y0 = y * cell;
                const corners = turned ? [[x0 + cell, y0], [x0, y0 + cell]] : [[x0, y0], [x0 + cell, y0 + cell]];
                for (const [cx, cy] of corners) {
                    for (const k of rings) {
                        const r = cell * k;
                        // The quarter that lies inside the cell.
                        const sx = cx === x0 ? 1 : -1, sy = cy === y0 ? 1 : -1;
                        const sweep = sx * sy > 0 ? 1 : 0;
                        lines += `M${f(cx + sx * r)} ${f(cy)}A${f(r)} ${f(r)} 0 0 ${sweep} ${f(cx)} ${f(cy + sy * r)}`;
                    }
                }
                if (dots) stones += circle(x0, y0, cell * 0.07);
            }
        }
        return { W, H: W, lines, stones, strap: cell / 11 };
    },
};

export const familyNames = Object.keys(families);

/// The tile for a seed, in the colours given: { svg, width, height }.
export function ornament(seed, { ground, strap, stone }, only) {
    const rand = generator(seed);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const name = only || pick(familyNames);
    const { W, H, lines, stones, strap: width } = families[name](rand, pick);
    const woven = rand() < 0.45;
    const w = width * (woven ? 2.2 : 1);
    let body = `<rect width="${f(W)}" height="${f(H)}" fill="${ground}"/>`;
    if (stones) body += `<path d="${stones}" fill="${stone}"/>`;
    body += `<path d="${lines}" fill="none" stroke="${strap}" stroke-width="${f(w)}" stroke-linejoin="miter" stroke-linecap="round"/>`;
    // A woven strap: drawn wide, the ground run down its middle.
    if (woven) body += `<path d="${lines}" fill="none" stroke="${ground}" stroke-width="${f(w * 0.36)}" stroke-linejoin="miter" stroke-linecap="round"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}" height="${f(H)}" viewBox="0 0 ${f(W)} ${f(H)}">${body}</svg>`;
    return { svg, width: W, height: H, name };
}
